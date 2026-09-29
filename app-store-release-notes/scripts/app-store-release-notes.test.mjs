import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildLocalizationDraft,
  createAppStoreConnectToken,
  discoverBundleIds,
  parseMetadataField,
  parseArgs,
  selectVersion,
  unicodeCounts,
  validateDraft,
} from "./app-store-release-notes.mjs";

test("parseArgs converts hyphenated flags", () => {
  assert.deepEqual(parseArgs(["pull", "--project-dir", "/tmp/app", "--bundle-id", "com.example.app"]), {
    command: "pull",
    options: { projectDir: "/tmp/app", bundleId: "com.example.app" },
  });
});

test("discoverBundleIds finds Xcode, Fastlane, Expo, and Unity identifiers", async () => {
  const root = await mkdtemp(join(tmpdir(), "asc-release-notes-"));
  await mkdir(join(root, "Demo.xcodeproj"));
  await mkdir(join(root, "fastlane"));
  await mkdir(join(root, "ProjectSettings"));
  await writeFile(
    join(root, "Demo.xcodeproj", "project.pbxproj"),
    "PRODUCT_BUNDLE_IDENTIFIER = com.example.shared;\nPRODUCT_BUNDLE_IDENTIFIER = com.example.shared;\n",
  );
  await writeFile(join(root, "fastlane", "Appfile"), 'app_identifier("com.example.shared")\n');
  await writeFile(join(root, "app.json"), JSON.stringify({ expo: { ios: { bundleIdentifier: "com.example.expo" } } }));
  await writeFile(
    join(root, "ProjectSettings", "ProjectSettings.asset"),
    "applicationIdentifier:\n  Android: com.example.android\n  iPhone: com.example.unity\n",
  );

  const found = await discoverBundleIds(root);
  assert.deepEqual(
    found.map((item) => item.bundleId),
    ["com.example.shared", "com.example.expo", "com.example.unity"],
  );
  assert.equal(found.find((item) => item.bundleId === "com.example.shared").sources.length, 2);
  assert.equal(found.find((item) => item.bundleId === "com.example.shared").recommended, true);
});

test("discoverBundleIds deprioritizes obvious extension and test targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "asc-release-notes-targets-"));
  await mkdir(join(root, "Demo.xcodeproj"));
  await writeFile(
    join(root, "Demo.xcodeproj", "project.pbxproj"),
    [
      "PRODUCT_BUNDLE_IDENTIFIER = com.example.main;",
      "PRODUCT_BUNDLE_IDENTIFIER = com.example.main.widget;",
      "PRODUCT_BUNDLE_IDENTIFIER = com.example.mainTests;",
    ].join("\n"),
  );
  const found = await discoverBundleIds(root);
  assert.equal(found[0].bundleId, "com.example.main");
  assert.equal(found[0].recommended, true);
});

test("selectVersion chooses newest editable version on one platform", () => {
  const versions = [
    {
      id: "old",
      attributes: {
        versionString: "1.0",
        platform: "IOS",
        appVersionState: "READY_FOR_SALE",
        createdDate: "2025-01-01T00:00:00Z",
      },
    },
    {
      id: "new",
      attributes: {
        versionString: "1.1",
        platform: "IOS",
        appVersionState: "READY_FOR_REVIEW",
        createdDate: "2025-02-01T00:00:00Z",
      },
    },
  ];
  assert.equal(selectVersion(versions, {}).id, "new");
});

test("selectVersion requires platform when editable targets span platforms", () => {
  const versions = [
    { id: "ios", attributes: { versionString: "2.0", platform: "IOS", appStoreState: "PREPARE_FOR_SUBMISSION" } },
    { id: "mac", attributes: { versionString: "2.0", platform: "MAC_OS", appStoreState: "PREPARE_FOR_SUBMISSION" } },
  ];
  assert.throws(() => selectVersion(versions, {}), /multiple platforms/i);
});

test("validateDraft uses a conservative 4000-character limit", () => {
  const base = {
    schemaVersion: 1,
    app: { id: "app" },
    version: { id: "version" },
    localizations: [{ id: "loc", locale: "zh-Hans", whatsNew: "更".repeat(4000) }],
  };
  assert.equal(validateDraft(base).errors.length, 0);
  const emoji = structuredClone(base);
  emoji.localizations[0].whatsNew = "😀".repeat(2001);
  assert.match(validateDraft(emoji).errors.join("\n"), /exceeds/);
  assert.deepEqual(unicodeCounts("A😀中"), { codePoints: 3, utf16Units: 4 });
});


test("buildLocalizationDraft reads one description locale and selects the others", () => {
  const app = { id: "app", attributes: { bundleId: "com.example.app", name: "Example" } };
  const version = {
    id: "version",
    attributes: {
      versionString: "3.0",
      platform: "IOS",
      appVersionState: "READY_FOR_REVIEW",
      createdDate: "2026-09-29T00:00:00Z",
    },
  };
  const resources = [
    { id: "en", attributes: { locale: "en-US", description: "English description" } },
    { id: "ja", attributes: { locale: "ja", description: "Japanese description" } },
    { id: "zh", attributes: { locale: "zh-Hans", description: "中文描述" } },
  ];
  const draft = buildLocalizationDraft(app, version, resources, {
    field: "description",
    sourceLocale: "en-us",
  });
  assert.equal(draft.schemaVersion, 2);
  assert.equal(draft.field, "description");
  assert.deepEqual(draft.source, {
    locale: "en-US",
    text: "English description",
    origin: "app-store-connect",
  });
  assert.equal(draft.localizations.find((item) => item.locale === "en-US").selected, false);
  assert.equal(draft.localizations.find((item) => item.locale === "ja").selected, true);
  assert.equal(draft.localizations.find((item) => item.locale === "zh-Hans").selected, true);
});

test("buildLocalizationDraft can select only specified description locales", () => {
  const draft = buildLocalizationDraft(
    { id: "app", attributes: { bundleId: "com.example.app" } },
    { id: "version", attributes: { versionString: "1.0", platform: "IOS", appStoreState: "PREPARE_FOR_SUBMISSION" } },
    [
      { id: "en", attributes: { locale: "en-US", description: "English" } },
      { id: "fr", attributes: { locale: "fr-FR", description: "French" } },
    ],
    { field: "app-description", targetLocales: "fr-fr" },
  );
  assert.equal(parseMetadataField("app-description"), "description");
  assert.deepEqual(
    draft.localizations.filter((item) => item.selected).map((item) => item.locale),
    ["fr-FR"],
  );
});

test("validateDraft allows blank unselected descriptions and enforces 4000 on selected locales", () => {
  const draft = {
    schemaVersion: 2,
    field: "description",
    app: { id: "app" },
    version: { id: "version" },
    localizations: [
      { id: "en", locale: "en-US", currentValue: "Source", value: "", selected: false },
      { id: "zh", locale: "zh-Hans", currentValue: "", value: "描".repeat(4000), selected: true },
    ],
  };
  assert.equal(validateDraft(draft).errors.length, 0);
  draft.localizations[1].value = "描".repeat(4001);
  assert.match(validateDraft(draft).errors.join("\n"), /exceeds/);
});


test("createAppStoreConnectToken emits an ES256 JWT with a raw 64-byte signature", () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const token = createAppStoreConnectToken(
    { keyId: "KEY123", issuerId: "issuer-123", privateKey: privateKey.export({ type: "pkcs8", format: "pem" }) },
    1_800_000_000,
  );
  const [headerPart, payloadPart, signaturePart] = token.split(".");
  const decode = (part) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  assert.deepEqual(decode(headerPart), { alg: "ES256", kid: "KEY123", typ: "JWT" });
  assert.equal(decode(payloadPart).aud, "appstoreconnect-v1");
  assert.equal(Buffer.from(signaturePart, "base64url").length, 64);
});
