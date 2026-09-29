---
name: app-store-release-notes
description: Translate, preview, and update localized App Store “What’s New” release notes or full app descriptions for the app in the current project. Use when the user provides one language as the source, wants all existing locales translated, or wants only specified locales updated; do not use for screenshots, keywords, subtitles, binaries, review submission, or release control.
---

# App Store Localized Metadata

Update either `whatsNew` or `description` on existing App Store version localizations. Use the bundled helper instead of rebuilding App Store Connect authentication or API calls.

## Choose the field and mode

- “版本更新内容”, “更新说明”, or “What's New” means `--field whatsNew`.
- “App 描述”, “商店描述”, or “description” means `--field description`.
- To translate an existing App Store locale into every other existing locale, add `--source-locale LOCALE`. The helper reads that locale's current field value and selects every other locale.
- To update the source locale too, add `--include-source` and replace `source.text` with the user's new source text.
- To update only named locales, add `--target-locales ja,ko-KR` (comma-separated). Only selected locales are validated and uploaded; all others remain untouched.
- If the user supplies text in a language that is not an existing locale, omit `--source-locale`, record that language in `source.locale`, and translate it into the selected existing locales.

## Workflow

1. Locate this skill directory and set `HELPER` to `scripts/app-store-release-notes.mjs` inside it. Run commands from the user's app project, not from the skill directory.
2. Run `node "$HELPER" scan --project-dir .`. If it finds zero or multiple plausible app bundle IDs, resolve the target with the user or an explicit `--bundle-id`/`--app-id`; never guess between apps.
3. Check that the App Store Connect environment variables are available. If setup is missing, read [references/auth-and-targeting.md](references/auth-and-targeting.md). Never ask the user to paste a private key into chat.
4. Pull a fresh private snapshot. Examples:
   - New release notes supplied by the user: `node "$HELPER" pull --field whatsNew --project-dir . --output "$DRAFT"`
   - Translate the existing English description into every other locale: `node "$HELPER" pull --field description --source-locale en-US --project-dir . --output "$DRAFT"`
   - Update only Japanese and Korean descriptions: `node "$HELPER" pull --field description --target-locales ja,ko-KR --project-dir . --output "$DRAFT"`
   Add `--platform`, `--version`, `--bundle-id`, or `--app-id` only when discovery is ambiguous or the user specified a target.
5. Inspect the exact app, version, platform, state, field, source locale, and selected target locales. Stop before mutation if any target conflicts with the request.
6. Fill `source.text` and each selected localization's `value`. Leave unselected locales unmodified. Read [references/draft-format.md](references/draft-format.md) for the schema and translation rules.
7. Translate regional variants separately, preserve factual claims, and adapt wording naturally. Never invent features, supported platforms, awards, performance claims, or other marketing assertions.
8. Run `node "$HELPER" validate --file "$DRAFT"`. Fix every error and re-run until it passes. Every selected value must be non-empty and within the 4,000-character safety limit.
9. Show a concise preview containing the exact app/version/platform, field, source language, selected locale list, character counts, and material adaptations. Do not expose credentials or resource IDs.
10. Authorization boundary:
    - If the user explicitly asked to **update/upload** App Store content, that authorizes this one previewed metadata update: `node "$HELPER" upload --file "$DRAFT" --yes`.
    - If the user asked only to translate, draft, inspect, or preview, run `node "$HELPER" upload --file "$DRAFT"` for a dry run and do not add `--yes`.
11. Report updated, unchanged, unselected, and failed locales. On a partial failure, pull a fresh snapshot before retrying and preserve already-correct values.

## Essential constraints

- Update only existing localizations attached to the selected App Store version. Never create, delete, rename, or merge locales implicitly.
- Patch only the draft's selected field: `whatsNew` or `description`. Do not alter other metadata.
- The current project identifies the app, but App Store Connect is the source of truth for versions, locales, and existing source text.
- Never submit for review, change release settings, upload builds, or release the version.
- Both supported fields use a conservative 4,000-character Unicode/UTF-16 check.
- If the user's source wording is ambiguous, ask one concise clarification rather than inventing content.
- Keep temporary drafts outside the repository when practical and delete them after a successful upload unless the user requests an audit copy.
