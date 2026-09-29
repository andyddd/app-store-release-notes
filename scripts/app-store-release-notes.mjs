#!/usr/bin/env node

import { createSign } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, readFile, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const API_ORIGIN = "https://api.appstoreconnect.apple.com";
const MAX_LOCALIZED_TEXT = 4000;
const METADATA_FIELDS = new Map([
  ["whatsNew", { label: "What's New", aliases: ["whatsnew", "whats-new", "release-notes", "release_notes"] }],
  ["description", { label: "Description", aliases: ["description", "app-description", "app_description"] }],
]);
const SKIP_DIRS = new Set([
  ".git",
  ".svn",
  ".hg",
  ".dart_tool",
  ".gradle",
  ".idea",
  ".swiftpm",
  ".build",
  "build",
  "Build",
  "DerivedData",
  "node_modules",
  "Pods",
  "vendor",
]);
const AUTO_TARGET_STATES = new Set([
  "PREPARE_FOR_SUBMISSION",
  "READY_FOR_REVIEW",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "INVALID_BINARY",
]);

function usage() {
  return `App Store localized metadata helper

Usage:
  node scripts/app-store-release-notes.mjs scan [--project-dir DIR] [--json]
  node scripts/app-store-release-notes.mjs pull [options] [--output FILE]
  node scripts/app-store-release-notes.mjs validate --file FILE
  node scripts/app-store-release-notes.mjs upload --file FILE [--yes]

Content options:
  --field FIELD          whatsNew (default) or description
  --source-locale LOCALE Read source text from an existing App Store locale
  --target-locales LIST  Comma-separated locales to update; default is every locale
  --include-source       Also update --source-locale when translating to all locales

Target options:
  --project-dir DIR     Project to inspect (default: current directory)
  --bundle-id ID        Override local bundle identifier discovery
  --app-id ID           Override app lookup with an App Store Connect app ID
  --platform PLATFORM   IOS, MAC_OS, TV_OS, or VISION_OS
  --version VERSION     Exact App Store version string

Credentials (environment variables):
  ASC_KEY_ID            App Store Connect API key ID
  ASC_ISSUER_ID         Issuer ID for a team API key; omit for an individual key
  ASC_PRIVATE_KEY_PATH  Path to AuthKey_<KEY_ID>.p8
  ASC_PRIVATE_KEY       Inline PEM private key (alternative to a path)

Safety:
  upload without --yes performs a dry run. It only patches the selected metadata
  field of selected existing localizations; it never submits an app for review,
  changes release controls, or creates/deletes localizations.
`;
}

export function parseArgs(argv) {
  const args = [...argv];
  const command = args.shift() ?? "help";
  const options = {};
  const booleanFlags = new Set(["json", "yes", "help", "includeSource"]);
  while (args.length) {
    const raw = args.shift();
    if (!raw.startsWith("--")) throw new Error(`Unexpected argument: ${raw}`);
    const key = raw.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (booleanFlags.has(key)) {
      options[key] = true;
      continue;
    }
    const value = args.shift();
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${raw}`);
    }
    options[key] = value;
  }
  return { command, options };
}

function cleanBundleId(value) {
  return String(value ?? "")
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/;$/, "")
    .trim();
}

function looksLikeBundleId(value) {
  return (
    /^[A-Za-z0-9][A-Za-z0-9-]*(\.[A-Za-z0-9][A-Za-z0-9-]*)+$/.test(value) &&
    !value.includes("$(") &&
    !value.includes("${")
  );
}

function auxiliaryBundlePenalty(bundleId) {
  return /(?:tests?|uitests?|(?:^|\.)(?:widget|shareextension|notificationservice|clip|watchkitapp|watchkitextension))$/i.test(
    bundleId,
  )
    ? 35
    : 0;
}

function addCandidate(map, bundleId, source, score = 50) {
  const cleaned = cleanBundleId(bundleId);
  if (!looksLikeBundleId(cleaned)) return;
  const adjustedScore = Math.max(0, score - auxiliaryBundlePenalty(cleaned));
  if (!map.has(cleaned)) map.set(cleaned, { sources: new Set(), score: adjustedScore });
  const entry = map.get(cleaned);
  entry.sources.add(source);
  entry.score = Math.max(entry.score, adjustedScore);
}

async function walk(root, maxDepth = 8, maxFiles = 20000) {
  const files = [];
  async function visit(dir, depth) {
    if (depth > maxDepth || files.length >= maxFiles) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await visit(full, depth + 1);
      } else if (entry.isFile()) {
        files.push(full);
      }
    }
  }
  await visit(root, 0);
  return files;
}

function collectFromPbxproj(text, source, candidates) {
  for (const match of text.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;\n]+)\s*;/g)) {
    addCandidate(candidates, match[1], source, 50);
  }
}

function collectFromFastlaneAppfile(text, source, candidates) {
  for (const match of text.matchAll(/\bapp_identifier\s*\(?\s*["']([^"']+)["']/g)) {
    addCandidate(candidates, match[1], source, 100);
  }
}

function collectFromInfoPlist(text, source, candidates) {
  const match = text.match(
    /<key>\s*CFBundleIdentifier\s*<\/key>\s*<string>\s*([^<]+?)\s*<\/string>/s,
  );
  if (match) addCandidate(candidates, match[1], source, 70);
}

function collectFromUnity(text, source, candidates) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const scalar = lines[i].match(/^\s*applicationIdentifier:\s*(\S.*?)\s*$/);
    if (scalar?.[1]) addCandidate(candidates, scalar[1], `${source} [Apple]`, 85);
    if (/^\s*applicationIdentifier:\s*$/.test(lines[i])) {
      for (let j = i + 1; j < Math.min(lines.length, i + 14); j += 1) {
        if (!/^\s+/.test(lines[j])) break;
        const nested = lines[j].match(/^\s+([A-Za-z0-9_-]+):\s*(\S.*?)\s*$/);
        if (!nested) continue;
        const platform = nested[1];
        if (["iPhone", "tvOS", "visionOS", "Standalone"].includes(platform)) {
          addCandidate(candidates, nested[2], `${source} [${platform}]`, platform === "iPhone" ? 90 : 80);
        }
      }
    }
  }
}

function collectFromJson(text, source, candidates) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return;
  }
  const possible = [
    value?.expo?.ios?.bundleIdentifier,
    value?.ios?.bundleIdentifier,
    value?.bundleIdentifier,
    value?.appId,
  ];
  for (const item of possible) addCandidate(candidates, item, source, 90);
}

export async function discoverBundleIds(projectDir) {
  const root = resolve(projectDir);
  const candidates = new Map();
  const files = await walk(root);
  for (const file of files) {
    const name = basename(file);
    const extension = extname(name).toLowerCase();
    const relative = file.slice(root.length + 1);
    const isInteresting =
      name === "project.pbxproj" ||
      (name === "Appfile" && relative.split("/").includes("fastlane")) ||
      name === "Info.plist" ||
      name === "ProjectSettings.asset" ||
      name === "app.json" ||
      name === "app.config.json" ||
      name === "capacitor.config.json" ||
      extension === ".plist";
    if (!isInteresting) continue;
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    if (name === "project.pbxproj") collectFromPbxproj(text, relative, candidates);
    if (name === "Appfile") collectFromFastlaneAppfile(text, relative, candidates);
    if (extension === ".plist") collectFromInfoPlist(text, relative, candidates);
    if (name === "ProjectSettings.asset") collectFromUnity(text, relative, candidates);
    if (["app.json", "app.config.json", "capacitor.config.json"].includes(name)) {
      collectFromJson(text, relative, candidates);
    }
  }
  const found = [...candidates.entries()]
    .map(([bundleId, entry]) => ({ bundleId, sources: [...entry.sources].sort(), score: entry.score }))
    .sort((a, b) => b.score - a.score || a.bundleId.localeCompare(b.bundleId));
  const topScore = found[0]?.score ?? null;
  const topCount = found.filter((item) => item.score === topScore).length;
  return found.map((item) => ({
    ...item,
    recommended: item.score === topScore && topCount === 1,
  }));
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function loadCredentials() {
  const keyId = process.env.ASC_KEY_ID?.trim();
  const issuerId = process.env.ASC_ISSUER_ID?.trim() || null;
  if (!keyId) throw new Error("ASC_KEY_ID is required.");

  let privateKey = process.env.ASC_PRIVATE_KEY;
  let privateKeyPath = process.env.ASC_PRIVATE_KEY_PATH;
  if (privateKey) privateKey = privateKey.replace(/\\n/g, "\n");

  if (!privateKey) {
    const paths = [
      privateKeyPath,
      join(process.cwd(), "private_keys", `AuthKey_${keyId}.p8`),
      join(homedir(), ".appstoreconnect", "private_keys", `AuthKey_${keyId}.p8`),
      join(homedir(), "private_keys", `AuthKey_${keyId}.p8`),
    ].filter(Boolean);
    privateKeyPath = paths.find((path) => existsSync(path));
    if (!privateKeyPath) {
      throw new Error(
        `Private key not found. Set ASC_PRIVATE_KEY_PATH or ASC_PRIVATE_KEY for key ${keyId}.`,
      );
    }
    privateKey = await readFile(privateKeyPath, "utf8");
  }

  return { keyId, issuerId, privateKey };
}

export function createAppStoreConnectToken(credentials, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = { alg: "ES256", kid: credentials.keyId, typ: "JWT" };
  const payload = credentials.issuerId
    ? {
        iss: credentials.issuerId,
        iat: nowSeconds - 5,
        exp: nowSeconds + 19 * 60,
        aud: "appstoreconnect-v1",
      }
    : {
        sub: "user",
        iat: nowSeconds - 5,
        exp: nowSeconds + 19 * 60,
        aud: "appstoreconnect-v1",
      };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign("SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign({ key: credentials.privateKey, dsaEncoding: "ieee-p1363" });
  return `${unsigned}.${base64url(signature)}`;
}

class AppStoreConnectClient {
  constructor(credentials) {
    this.credentials = credentials;
    this.token = null;
    this.tokenCreatedAt = 0;
  }

  getToken() {
    const now = Math.floor(Date.now() / 1000);
    if (!this.token || now - this.tokenCreatedAt > 15 * 60) {
      this.token = createAppStoreConnectToken(this.credentials, now);
      this.tokenCreatedAt = now;
    }
    return this.token;
  }

  async request(method, pathOrUrl, body) {
    const url = new URL(pathOrUrl, API_ORIGIN);
    if (url.origin !== API_ORIGIN) {
      throw new Error(`Refusing App Store Connect pagination URL on unexpected origin: ${url.origin}`);
    }
    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.getToken()}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!response.ok) {
      const apiErrors = Array.isArray(parsed?.errors)
        ? parsed.errors
            .map((error) => [error.code, error.title, error.detail].filter(Boolean).join(": "))
            .join(" | ")
        : typeof parsed === "string"
          ? parsed
          : JSON.stringify(parsed);
      throw new Error(`App Store Connect ${method} ${url.pathname} failed (${response.status}): ${apiErrors}`);
    }
    return parsed;
  }

  async getAll(pathOrUrl) {
    const data = [];
    let next = pathOrUrl;
    while (next) {
      const page = await this.request("GET", next);
      if (!Array.isArray(page?.data)) throw new Error("Expected a list response from App Store Connect.");
      data.push(...page.data);
      next = page.links?.next || null;
    }
    return data;
  }
}

function resourceState(resource) {
  return resource?.attributes?.appVersionState ?? resource?.attributes?.appStoreState ?? "UNKNOWN";
}

function resourceCreatedAt(resource) {
  const value = Date.parse(resource?.attributes?.createdDate ?? "");
  return Number.isNaN(value) ? 0 : value;
}

function summarizeVersion(resource) {
  return {
    id: resource.id,
    versionString: resource.attributes?.versionString ?? null,
    platform: resource.attributes?.platform ?? null,
    state: resourceState(resource),
    createdDate: resource.attributes?.createdDate ?? null,
  };
}

export function selectVersion(resources, { platform, version } = {}) {
  let matches = resources;
  if (platform) matches = matches.filter((item) => item.attributes?.platform === platform);
  if (version) matches = matches.filter((item) => item.attributes?.versionString === version);

  if (version) {
    if (matches.length === 0) throw new Error(`No App Store version matched version=${version}${platform ? ` platform=${platform}` : ""}.`);
    if (matches.length > 1) {
      throw new Error("More than one version matched. Add --platform to identify the target exactly.");
    }
    return matches[0];
  }

  const editable = matches.filter((item) => AUTO_TARGET_STATES.has(resourceState(item)));
  if (editable.length === 0) {
    const seen = matches
      .sort((a, b) => resourceCreatedAt(b) - resourceCreatedAt(a))
      .slice(0, 8)
      .map((item) => `${item.attributes?.versionString ?? "?"}/${item.attributes?.platform ?? "?"}/${resourceState(item)}`)
      .join(", ");
    throw new Error(
      `No automatically selectable editable version was found${seen ? `. Recent versions: ${seen}` : ""}. Use --version and usually --platform to target a version explicitly.`,
    );
  }

  const platforms = new Set(editable.map((item) => item.attributes?.platform ?? "UNKNOWN"));
  if (!platform && platforms.size > 1) {
    throw new Error(`Editable versions exist on multiple platforms (${[...platforms].join(", ")}). Add --platform.`);
  }
  return editable.sort((a, b) => resourceCreatedAt(b) - resourceCreatedAt(a))[0];
}

async function resolveApp(client, { appId, bundleId, projectDir }) {
  if (appId) {
    const response = await client.request("GET", `/v1/apps/${encodeURIComponent(appId)}`);
    return response.data;
  }

  let chosenBundleId = bundleId;
  if (!chosenBundleId) {
    const candidates = await discoverBundleIds(projectDir);
    if (candidates.length === 0) {
      throw new Error("No bundle identifier was found in the current project. Pass --bundle-id or --app-id.");
    }
    if (candidates.length > 1) {
      const recommended = candidates.filter((item) => item.recommended);
      if (recommended.length === 1) {
        chosenBundleId = recommended[0].bundleId;
      } else {
        const details = candidates.map((item) => `${item.bundleId} (${item.sources.join(", ")})`).join("; ");
        throw new Error(`Multiple bundle identifiers were found: ${details}. Pass --bundle-id.`);
      }
    } else {
      chosenBundleId = candidates[0].bundleId;
    }
  }

  const params = new URLSearchParams({ "filter[bundleId]": chosenBundleId, limit: "200" });
  const apps = await client.getAll(`/v1/apps?${params}`);
  if (apps.length === 0) throw new Error(`No App Store Connect app matched bundle ID ${chosenBundleId}.`);
  if (apps.length > 1) throw new Error(`Multiple App Store Connect apps matched bundle ID ${chosenBundleId}; pass --app-id.`);
  return apps[0];
}

export function parseMetadataField(value) {
  const requested = String(value ?? "whatsNew").trim();
  const lower = requested.toLowerCase();
  for (const [field, config] of METADATA_FIELDS) {
    if (field.toLowerCase() === lower || config.aliases.includes(lower)) return field;
  }
  throw new Error(`Unsupported field: ${requested}. Use whatsNew or description.`);
}

function resolveLocale(availableLocales, requested, optionName) {
  const match = availableLocales.find((locale) => locale.toLowerCase() === requested.toLowerCase());
  if (!match) {
    throw new Error(`${optionName} ${requested} is not an existing localization. Available: ${availableLocales.join(", ")}.`);
  }
  return match;
}

function parseTargetLocales(value, availableLocales) {
  if (!value) return null;
  const requested = [...new Set(String(value).split(",").map((item) => item.trim()).filter(Boolean))];
  if (requested.length === 0) throw new Error("--target-locales must contain at least one locale.");
  return requested.map((locale) => resolveLocale(availableLocales, locale, "Target locale"));
}

export function buildLocalizationDraft(app, version, resources, options = {}) {
  const field = parseMetadataField(options.field);
  const sorted = [...resources].sort((a, b) =>
    String(a.attributes?.locale).localeCompare(String(b.attributes?.locale)),
  );
  const availableLocales = sorted.map((item) => item.attributes?.locale).filter(Boolean);
  if (availableLocales.length === 0) {
    throw new Error("The selected App Store version has no existing localizations to update.");
  }

  const sourceLocale = options.sourceLocale
    ? resolveLocale(availableLocales, options.sourceLocale, "Source locale")
    : null;
  const explicitTargets = parseTargetLocales(options.targetLocales, availableLocales);
  const selectedLocales = explicitTargets
    ? new Set(explicitTargets)
    : new Set(
        availableLocales.filter((locale) => !sourceLocale || options.includeSource || locale !== sourceLocale),
      );
  if (selectedLocales.size === 0 && sourceLocale) selectedLocales.add(sourceLocale);

  const sourceResource = sourceLocale
    ? sorted.find((item) => item.attributes?.locale === sourceLocale)
    : null;
  return {
    schemaVersion: 2,
    field,
    generatedAt: new Date().toISOString(),
    app: {
      id: app.id,
      bundleId: app.attributes?.bundleId ?? options.bundleId ?? null,
      name: app.attributes?.name ?? null,
    },
    version: summarizeVersion(version),
    source: {
      locale: sourceLocale,
      text: sourceResource?.attributes?.[field] ?? "",
      origin: sourceLocale ? "app-store-connect" : "user",
    },
    localizations: sorted.map((item) => ({
      id: item.id,
      locale: item.attributes?.locale,
      currentValue: item.attributes?.[field] ?? "",
      value: "",
      selected: selectedLocales.has(item.attributes?.locale),
    })),
  };
}

async function pullDraft(options) {
  const credentials = await loadCredentials();
  const client = new AppStoreConnectClient(credentials);
  const projectDir = resolve(options.projectDir ?? process.cwd());
  const platform = options.platform?.toUpperCase();
  const app = await resolveApp(client, {
    appId: options.appId,
    bundleId: options.bundleId,
    projectDir,
  });
  const versions = await client.getAll(`/v1/apps/${encodeURIComponent(app.id)}/appStoreVersions?limit=200`);
  const version = selectVersion(versions, { platform, version: options.version });
  const localizations = await client.getAll(
    `/v1/appStoreVersions/${encodeURIComponent(version.id)}/appStoreVersionLocalizations?limit=200`,
  );
  return buildLocalizationDraft(app, version, localizations, options);
}

export function unicodeCounts(text) {
  return {
    codePoints: Array.from(text).length,
    utf16Units: text.length,
  };
}

export function normalizeDraft(draft) {
  if (draft?.schemaVersion === 1) {
    return {
      ...draft,
      field: "whatsNew",
      localizations: Array.isArray(draft.localizations)
        ? draft.localizations.map((item) => ({
            id: item.id,
            locale: item.locale,
            currentValue: item.currentWhatsNew ?? "",
            value: item.whatsNew,
            selected: true,
          }))
        : draft.localizations,
    };
  }
  if (draft?.schemaVersion === 2) {
    const field = parseMetadataField(draft.field);
    return {
      ...draft,
      field,
      localizations: Array.isArray(draft.localizations)
        ? draft.localizations.map((item) => ({
            ...item,
            currentValue: item.currentValue ?? "",
            value: item.value,
            selected: item.selected !== false,
          }))
        : draft.localizations,
    };
  }
  return draft;
}

export function validateDraft(inputDraft) {
  const errors = [];
  const warnings = [];
  let draft;
  try {
    draft = normalizeDraft(inputDraft);
  } catch (error) {
    return { errors: [error.message], warnings, rows: [], draft: inputDraft };
  }
  if (![1, 2].includes(inputDraft?.schemaVersion)) errors.push("schemaVersion must be 1 or 2.");
  if (!METADATA_FIELDS.has(draft?.field)) errors.push("field must be whatsNew or description.");
  if (!draft?.app?.id) errors.push("app.id is required.");
  if (!draft?.version?.id) errors.push("version.id is required.");
  if (!Array.isArray(draft?.localizations) || draft.localizations.length === 0) {
    errors.push("At least one localization is required.");
    return { errors, warnings, rows: [], draft };
  }

  const seenIds = new Set();
  const seenLocales = new Set();
  const rows = [];
  let selectedCount = 0;
  for (const [index, localization] of draft.localizations.entries()) {
    const label = localization?.locale || `localizations[${index}]`;
    if (!localization?.id) errors.push(`${label}: id is required.`);
    if (!localization?.locale) errors.push(`${label}: locale is required.`);
    if (seenIds.has(localization?.id)) errors.push(`${label}: duplicate localization id.`);
    if (seenLocales.has(localization?.locale)) errors.push(`${label}: duplicate locale.`);
    seenIds.add(localization?.id);
    seenLocales.add(localization?.locale);

    if (!localization.selected) {
      rows.push({ locale: localization.locale, selected: false, changed: false });
      continue;
    }
    selectedCount += 1;
    const text = localization?.value;
    if (typeof text !== "string" || text.trim().length === 0) {
      errors.push(`${label}: ${draft.field} value must be a non-empty string.`);
      continue;
    }
    if (text !== text.trim()) errors.push(`${label}: remove leading or trailing whitespace.`);
    if (text.includes("\u0000")) errors.push(`${label}: contains a NUL character.`);
    const counts = unicodeCounts(text);
    if (counts.codePoints > MAX_LOCALIZED_TEXT || counts.utf16Units > MAX_LOCALIZED_TEXT) {
      errors.push(
        `${label}: exceeds the ${MAX_LOCALIZED_TEXT}-character safety limit (${counts.codePoints} code points, ${counts.utf16Units} UTF-16 units).`,
      );
    }
    if (counts.codePoints > 3600 || counts.utf16Units > 3600) {
      warnings.push(`${label}: close to the ${MAX_LOCALIZED_TEXT}-character limit.`);
    }
    rows.push({
      locale: localization.locale,
      selected: true,
      ...counts,
      changed: text !== (localization.currentValue ?? ""),
    });
  }
  if (selectedCount === 0) errors.push("Select at least one localization to update.");
  return { errors, warnings, rows, draft };
}

function previewDraft(inputDraft, validation) {
  const draft = validation.draft ?? normalizeDraft(inputDraft);
  const selectedRows = validation.rows.filter((row) => row.selected);
  const lines = [
    `App: ${draft.app?.name ?? "?"} (${draft.app?.bundleId ?? "?"}, ${draft.app?.id ?? "?"})`,
    `Version: ${draft.version?.versionString ?? "?"} / ${draft.version?.platform ?? "?"} / ${draft.version?.state ?? "?"}`,
    `Field: ${METADATA_FIELDS.get(draft.field)?.label ?? draft.field ?? "?"}`,
    `Locales: ${draft.localizations?.length ?? 0}; selected: ${selectedRows.length}`,
  ];
  for (const row of validation.rows) {
    if (!row.selected) {
      lines.push(`  ${row.locale}: not selected`);
      continue;
    }
    lines.push(
      `  ${row.locale}: ${row.codePoints ?? 0} code points, ${row.utf16Units ?? 0} UTF-16 units${row.changed ? " (changed)" : " (unchanged)"}`,
    );
  }
  return lines.join("\n");
}

async function readDraft(file) {
  if (!file) throw new Error("--file is required.");
  return JSON.parse(await readFile(resolve(file), "utf8"));
}

function exactLocalizationSet(draft, remote) {
  const draftPairs = draft.localizations.map((item) => `${item.id}\u0000${item.locale}`).sort();
  const remotePairs = remote.map((item) => `${item.id}\u0000${item.attributes?.locale}`).sort();
  return draftPairs.length === remotePairs.length && draftPairs.every((value, index) => value === remotePairs[index]);
}

async function uploadDraft(inputDraft, options) {
  const validation = validateDraft(inputDraft);
  const draft = validation.draft ?? normalizeDraft(inputDraft);
  console.log(previewDraft(draft, validation));
  for (const warning of validation.warnings) console.warn(`Warning: ${warning}`);
  if (validation.errors.length) {
    for (const error of validation.errors) console.error(`Error: ${error}`);
    throw new Error("Draft validation failed; nothing was uploaded.");
  }
  const selected = draft.localizations.filter((item) => item.selected);
  if (!options.yes) {
    console.log("\nDry run only. Re-run with --yes after the target and translations are approved.");
    return { updated: [], unchanged: [], notSelected: draft.localizations.filter((item) => !item.selected).map((item) => item.locale), dryRun: true };
  }

  const credentials = await loadCredentials();
  const client = new AppStoreConnectClient(credentials);
  const [appResponse, versionResponse, remoteLocalizations] = await Promise.all([
    client.request("GET", `/v1/apps/${encodeURIComponent(draft.app.id)}`),
    client.request("GET", `/v1/appStoreVersions/${encodeURIComponent(draft.version.id)}`),
    client.getAll(
      `/v1/appStoreVersions/${encodeURIComponent(draft.version.id)}/appStoreVersionLocalizations?limit=200`,
    ),
  ]);

  const remoteApp = appResponse.data;
  const remoteVersion = versionResponse.data;
  const mismatches = [];
  if ((remoteApp.attributes?.bundleId ?? null) !== (draft.app.bundleId ?? null)) mismatches.push("app bundle ID");
  if ((remoteVersion.attributes?.versionString ?? null) !== (draft.version.versionString ?? null)) mismatches.push("version string");
  if ((remoteVersion.attributes?.platform ?? null) !== (draft.version.platform ?? null)) mismatches.push("platform");
  if (resourceState(remoteVersion) !== draft.version.state) mismatches.push("version state");
  if (!exactLocalizationSet(draft, remoteLocalizations)) mismatches.push("localization set");
  if (mismatches.length) {
    throw new Error(`Remote data changed since pull (${mismatches.join(", ")}). Pull a fresh draft; nothing was uploaded.`);
  }

  const remoteById = new Map(remoteLocalizations.map((item) => [item.id, item]));
  const changed = selected.filter(
    (item) => (remoteById.get(item.id)?.attributes?.[draft.field] ?? "") !== item.value,
  );
  const unchanged = selected
    .filter((item) => !changed.includes(item))
    .map((item) => item.locale);
  const notSelected = draft.localizations.filter((item) => !item.selected).map((item) => item.locale);
  if (changed.length === 0) {
    console.log("\nNo remote values need changing.");
    return { updated: [], unchanged, notSelected, dryRun: false };
  }

  const updated = [];
  try {
    for (const localization of changed) {
      await client.request("PATCH", `/v1/appStoreVersionLocalizations/${encodeURIComponent(localization.id)}`, {
        data: {
          type: "appStoreVersionLocalizations",
          id: localization.id,
          attributes: { [draft.field]: localization.value },
        },
      });
      updated.push(localization.locale);
      console.log(`Updated ${localization.locale} (${draft.field})`);
    }
  } catch (error) {
    const remaining = changed.map((item) => item.locale).filter((locale) => !updated.includes(locale));
    throw new Error(
      `${error.message}\nPartial update: ${updated.length ? updated.join(", ") : "none"}. Not updated: ${remaining.join(", ")}. Pull again before retrying.`,
    );
  }

  console.log(`\nUpload complete: ${updated.length} updated, ${unchanged.length} unchanged, ${notSelected.length} not selected.`);
  return { updated, unchanged, notSelected, dryRun: false };
}

async function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);
  if (options.help || ["help", "-h", "--help"].includes(command)) {
    console.log(usage());
    return;
  }

  if (command === "scan") {
    const projectDir = resolve(options.projectDir ?? process.cwd());
    const candidates = await discoverBundleIds(projectDir);
    if (options.json) {
      console.log(JSON.stringify({ projectDir, candidates }, null, 2));
    } else if (candidates.length === 0) {
      console.log(`No bundle identifiers found under ${projectDir}.`);
    } else {
      console.log(`Bundle identifiers found under ${projectDir}:`);
      for (const candidate of candidates) {
        console.log(`- ${candidate.bundleId}${candidate.recommended ? " (recommended)" : ""}\n  ${candidate.sources.join("\n  ")}`);
      }
    }
    return;
  }

  if (command === "pull") {
    const draft = await pullDraft(options);
    const output = `${JSON.stringify(draft, null, 2)}\n`;
    if (options.output) {
      const outputPath = resolve(options.output);
      await writeFile(outputPath, output, { mode: 0o600 });
      await chmod(outputPath, 0o600);
      console.log(
        `Pulled ${draft.localizations.length} locales for ${draft.app.name ?? draft.app.bundleId} ${draft.version.versionString} (${draft.field}) to ${outputPath}.`,
      );
    } else {
      process.stdout.write(output);
    }
    return;
  }

  if (command === "validate") {
    const draft = await readDraft(options.file);
    const validation = validateDraft(draft);
    console.log(previewDraft(draft, validation));
    for (const warning of validation.warnings) console.warn(`Warning: ${warning}`);
    if (validation.errors.length) {
      for (const error of validation.errors) console.error(`Error: ${error}`);
      process.exitCode = 1;
    } else {
      console.log("\nValidation passed.");
    }
    return;
  }

  if (command === "upload") {
    const draft = await readDraft(options.file);
    await uploadDraft(draft, options);
    return;
  }

  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
