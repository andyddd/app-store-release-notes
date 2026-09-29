# Authentication and target selection

The bundled helper requires Node.js 18 or newer so it can use the built-in `fetch` and cryptography APIs without third-party packages.

## App Store Connect API key

Use an App Store Connect API key that can edit the target app's version metadata. Provide credentials through the process environment; never paste private key contents into chat, the draft JSON, source control, or terminal output.

Required:

```sh
export ASC_KEY_ID="ABC123DEFG"
export ASC_PRIVATE_KEY_PATH="$HOME/private_keys/AuthKey_ABC123DEFG.p8"
```

For a team API key, also provide:

```sh
export ASC_ISSUER_ID="00000000-0000-0000-0000-000000000000"
```

For an individual API key, omit `ASC_ISSUER_ID`. `ASC_PRIVATE_KEY` may contain an inline PEM value when a secure environment already supplies it. The helper also checks `./private_keys`, `~/.appstoreconnect/private_keys`, and `~/private_keys` for `AuthKey_<KEY_ID>.p8`.

Official references:

- Token generation: https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests
- App Store version localization update: https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstoreversionlocalizations-_id_
- App Store version localizations list: https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-appstoreversionlocalizations

## How the target is chosen

1. `--app-id` wins when supplied.
2. Otherwise `--bundle-id` wins.
3. Otherwise the helper scans common Xcode, Fastlane, Expo, Capacitor, Flutter/Xcode, and Unity project files under `--project-dir`.
4. If zero or multiple bundle IDs remain, stop and ask the user which app to use.
5. `--version` and `--platform` pin an exact target. Without them, the helper selects the newest version in a conservative editable state and refuses to guess across multiple platforms.

`pull` records the app, version, state, and exact localization resource IDs. Immediately before upload, the helper fetches them again. It stops without uploading if the app identity, version, state, or set of existing localizations changed.

## Mutation boundary

The helper only patches the selected `whatsNew` or `description` attribute of selected existing App Store version localizations. It does not create/delete localizations, edit screenshots or unrelated metadata, upload a binary, submit for review, or release the version.

`upload` is a dry run unless `--yes` is present. A request that explicitly says to upload or update App Store Connect authorizes one upload of the previewed target. A request only to translate, draft, inspect, or preview does not authorize `--yes`.

App Store Connect updates are not atomic across locales. The helper validates everything before the first update and then updates sequentially. If Apple rejects a later locale, it reports the completed and remaining locales and tells the agent to pull fresh data before retrying; it does not attempt a risky rollback.
