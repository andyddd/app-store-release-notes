# Draft format and translation rules

The helper's `pull` command creates a schema version 2 JSON document. Keep app, version, localization IDs, locale names, `field`, and `currentValue` unchanged. Fill `source` and the `value` of selected localizations.

```json
{
  "schemaVersion": 2,
  "field": "description",
  "generatedAt": "2026-09-29T00:00:00.000Z",
  "app": {
    "id": "123456789",
    "bundleId": "com.example.app",
    "name": "Example"
  },
  "version": {
    "id": "version-resource-id",
    "versionString": "2.4.0",
    "platform": "IOS",
    "state": "READY_FOR_REVIEW",
    "createdDate": "2026-09-28T00:00:00Z"
  },
  "source": {
    "locale": "en-US",
    "text": "The current English App Store description.",
    "origin": "app-store-connect"
  },
  "localizations": [
    {
      "id": "english-localization-id",
      "locale": "en-US",
      "currentValue": "The current English App Store description.",
      "value": "",
      "selected": false
    },
    {
      "id": "japanese-localization-id",
      "locale": "ja",
      "currentValue": "現在の日本語の説明。",
      "value": "自然に翻訳された日本語の説明。",
      "selected": true
    }
  ]
}
```

`field` must be one of:

- `whatsNew`: version update notes.
- `description`: full App Store product description.

The helper still accepts old schema version 1 release-note drafts and treats them as `whatsNew`, but new pulls always use schema version 2.

## Selection behavior

- Without `--source-locale` or `--target-locales`, every existing locale is selected.
- With `--source-locale`, the helper copies that locale's current field into `source.text` and selects every other locale.
- Add `--include-source` when the source locale itself should also be updated.
- `--target-locales ja,ko-KR` selects exactly those locales, regardless of source locale.
- `selected: false` means the upload must leave that locale untouched. Its `value` may remain empty.
- Do not remove unselected localization objects from the draft. Their IDs are part of the pre-upload consistency check.

## Translation requirements

- Treat each locale as regional. Localize `en-US` and `en-GB`, `pt-BR` and `pt-PT`, or `zh-Hans` and `zh-Hant` separately when present.
- Preserve product names, feature names, version numbers, limitations, and all factual meaning. Never add unsupported capabilities or marketing claims.
- Write naturally for the destination locale rather than translating word-for-word.
- `whatsNew` should be concise release-note text. Short bullets and line breaks are allowed.
- `description` may preserve headings, paragraphs, bullets, calls to action, and the source's overall information hierarchy, but must remain plain text suitable for App Store Connect.
- Avoid Markdown link syntax, translator commentary, and accidental notes such as “translated from English.”
- Each selected `value` must be non-empty and at most 4,000 characters. The helper conservatively checks both Unicode code points and UTF-16 units.
- If a translation exceeds the limit, shorten repetition and phrasing while retaining user-visible facts and the most important benefits. Never silently drop a limitation, price condition, subscription disclosure, or compatibility statement.
