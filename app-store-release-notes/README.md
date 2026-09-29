# App Store Localized Metadata Skill

> 中文说明 / English documentation
> Last updated / 最后更新：2026-09-29

A Codex skill that translates, previews, validates, and updates localized App Store **What's New** release notes and **App descriptions**.

这是一个供 Codex/AI Agent 使用的 Skill，可以自动翻译、预览、校验并更新 App Store 中多语言的**版本更新内容**和 **App 描述**。

---

## 中文说明

### 功能

这个 Skill 可以：

- 从当前项目自动识别 App 的 Bundle ID。
- 从 App Store Connect 获取当前可编辑版本和已经存在的语言。
- 使用用户提供的一种语言作为源文本，自动翻译所有已有语言。
- 使用 App Store 中某个已有语言的描述作为源文本，翻译其他语言。
- 只更新用户指定的一个或多个语言。
- 更新版本更新内容 `whatsNew`。
- 更新 App 完整描述 `description`。
- 对每种语言执行 4,000 字符安全检查。
- 上传前重新检查 App、版本、状态和语言列表。
- 默认支持只预览、不上传。

翻译由 AI Agent 完成；附带的 Node.js 脚本负责识别项目、读取 App Store Connect、校验字符数以及执行上传。

### 系统要求

- Codex，或其他能够加载 `SKILL.md` 并执行本地命令的 AI Agent。
- Node.js 18 或更高版本。
- App Store Connect API Key。
- API Key 必须有权限编辑目标 App 的版本元数据。

检查 Node.js：

```sh
node --version
```

### 安装

#### 方法一：复制 Skill 文件夹

将整个 `app-store-release-notes` 文件夹复制到 Codex Skills 目录：

```sh
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R app-store-release-notes "${CODEX_HOME:-$HOME/.codex}/skills/"
```

安装后的主要文件应该位于：

```text
~/.codex/skills/app-store-release-notes/SKILL.md
```

#### 方法二：从 ZIP 安装

这个项目提供的 ZIP 包含顶层 Skill 文件夹：

```sh
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
unzip app-store-release-notes.zip -d "${CODEX_HOME:-$HOME/.codex}/skills"
```

如果同名目录已经存在，请先备份旧版本，再替换整个文件夹，避免新旧脚本混合。

安装后，在下一条 Codex 消息或新的任务中显式使用：

```text
$app-store-release-notes
```

也可以检查脚本是否可运行：

```sh
node "${CODEX_HOME:-$HOME/.codex}/skills/app-store-release-notes/scripts/app-store-release-notes.mjs" --help
```

### 配置 App Store Connect API Key

不要把 `.p8` 私钥内容粘贴到聊天、提交到 Git，或写入翻译草稿。

#### 团队 API Key

必须设置：

```sh
export ASC_KEY_ID="ABC123DEFG"
export ASC_ISSUER_ID="00000000-0000-0000-0000-000000000000"
export ASC_PRIVATE_KEY_PATH="$HOME/private_keys/AuthKey_ABC123DEFG.p8"
```

#### 个人 API Key

个人 API Key 不需要 `ASC_ISSUER_ID`：

```sh
export ASC_KEY_ID="ABC123DEFG"
export ASC_PRIVATE_KEY_PATH="$HOME/private_keys/AuthKey_ABC123DEFG.p8"
unset ASC_ISSUER_ID
```

#### 环境变量说明

| 环境变量 | 是否必需 | 说明 |
|---|---:|---|
| `ASC_KEY_ID` | 是 | App Store Connect API Key ID。 |
| `ASC_ISSUER_ID` | 团队 Key 必需 | 团队 API Key 的 Issuer ID；个人 Key 不设置。 |
| `ASC_PRIVATE_KEY_PATH` | 推荐 | `.p8` 私钥文件的完整路径。 |
| `ASC_PRIVATE_KEY` | 可选 | 直接通过安全运行环境提供 PEM 私钥；不建议手动写进 Shell 历史。 |

如果没有设置 `ASC_PRIVATE_KEY_PATH`，脚本还会依次检查：

```text
./private_keys/AuthKey_<KEY_ID>.p8
~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8
~/private_keys/AuthKey_<KEY_ID>.p8
```

如需长期使用，可以将非敏感的 Key ID、Issuer ID 和私钥路径写入 Shell 配置文件，但不要把私钥正文写入项目仓库：

```sh
# ~/.zshrc 示例
export ASC_KEY_ID="ABC123DEFG"
export ASC_ISSUER_ID="00000000-0000-0000-0000-000000000000"
export ASC_PRIVATE_KEY_PATH="$HOME/private_keys/AuthKey_ABC123DEFG.p8"
```

然后重新打开终端，或执行：

```sh
source ~/.zshrc
```

### 使用方法

请在目标 App 项目的根目录中启动 Codex。Skill 会尝试从 Xcode、Fastlane、Expo、Capacitor、Flutter/Xcode 或 Unity 项目文件中查找 Bundle ID。

#### 1. 先执行只读测试

```text
使用 $app-store-release-notes，读取当前项目对应的 App、可编辑版本和已有语言，只预览，不要上传。
```

#### 2. 将新的版本更新内容翻译为所有已有语言

```text
使用 $app-store-release-notes，把下面的简体中文作为版本更新内容，翻译并更新所有已有语言：

新增批量导出功能，并修复部分情况下的数据同步问题。
```

#### 3. 使用已有英语描述翻译其他语言

```text
使用 $app-store-release-notes，以 App Store 当前 en-US 描述为源，翻译并更新其他所有已有语言，不修改 en-US。
```

#### 4. 使用新描述更新源语言和其他所有语言

```text
使用 $app-store-release-notes，把下面的简体中文作为新的 App 描述，同时更新 zh-Hans，并翻译更新其他所有已有语言：

这是一款帮助你记录、整理并快速查找重要内容的应用。
```

#### 5. 只更新指定语言

```text
使用 $app-store-release-notes，用下面的中文描述作为源，只翻译并更新 en-US、ja 和 ko-KR：

这是一款简单、快速且注重隐私的记录工具。
```

#### 6. 只设置一个语言的描述

```text
使用 $app-store-release-notes，只把 ja 的 App 描述更新为：

シンプルで高速、プライバシーを重視した記録アプリです。
```

#### 7. 只生成草稿，不上传

```text
使用 $app-store-release-notes，生成所有语言的 App 描述翻译草稿并检查字符数，但不要上传。
```

### App Store 字符限制

当前 Skill 支持的字段：

| 字段 | 用途 | Skill 使用的安全上限 |
|---|---|---:|
| `whatsNew` | 版本更新内容 | 4,000 字符 |
| `description` | App 完整描述 | 4,000 字符 |

脚本同时检查 Unicode 码点数量和 UTF-16 长度。包含 Emoji 或扩展字符时，会采用更保守的结果。

如果翻译超出限制，AI 应优先删除重复表达和冗余营销措辞，但不能静默删除价格条件、订阅说明、兼容性信息、功能限制或其他重要事实。

### 高级命令行用法

通常只需要通过自然语言调用 Skill。下面的命令用于调试或手动检查；命令行脚本本身不会调用翻译模型。

```sh
HELPER="${CODEX_HOME:-$HOME/.codex}/skills/app-store-release-notes/scripts/app-store-release-notes.mjs"
```

扫描当前项目：

```sh
node "$HELPER" scan --project-dir .
```

拉取版本更新内容草稿：

```sh
node "$HELPER" pull \
  --field whatsNew \
  --project-dir . \
  --output /tmp/app-store-whats-new.json
```

以现有 `en-US` 描述为源，选择其他语言：

```sh
node "$HELPER" pull \
  --field description \
  --source-locale en-US \
  --project-dir . \
  --output /tmp/app-store-description.json
```

只选择指定语言：

```sh
node "$HELPER" pull \
  --field description \
  --target-locales en-US,ja,ko-KR \
  --project-dir . \
  --output /tmp/app-store-description.json
```

校验草稿：

```sh
node "$HELPER" validate --file /tmp/app-store-description.json
```

上传预演，不修改 App Store：

```sh
node "$HELPER" upload --file /tmp/app-store-description.json
```

实际上传：

```sh
node "$HELPER" upload --file /tmp/app-store-description.json --yes
```

`--yes` 会修改 App Store Connect。执行前应确认 App、版本、平台、字段、源语言和目标语言都正确。

### 可选目标参数

当自动识别不明确时，可以使用：

```text
--bundle-id com.example.app
--app-id 1234567890
--platform IOS
--version 2.4.0
```

如果项目中包含主 App、测试 Target、Widget 或多个 App，Skill 会优先识别主 App；仍有歧义时会停止并要求明确指定，不会猜测。

### 安全行为

- 默认上传命令是 dry run。
- 只有 `--yes` 才会执行 App Store Connect 修改。
- 只修改 `whatsNew` 或 `description` 中用户选择的一个字段。
- 只更新已经存在且被选择的语言。
- 不创建或删除语言。
- 不修改截图、关键词、副标题或其他元数据。
- 不上传构建、不提交审核、不改变发布方式。
- 上传前重新读取远端数据；App、版本、状态或语言集合变化时会停止。
- 多语言更新不是原子操作；部分失败时会报告已完成和未完成的语言，不会自动执行危险回滚。

### 常见问题

#### 找不到 Bundle ID

在提示中明确提供 Bundle ID：

```text
使用 $app-store-release-notes，目标 Bundle ID 是 com.example.app，只读取语言列表，不要上传。
```

#### 找到多个 App 或平台

明确指定版本和平台：

```text
使用 $app-store-release-notes，目标是 IOS 2.4.0，只预览描述翻译。
```

#### 返回 401 或认证失败

检查：

- `ASC_KEY_ID` 是否与 `.p8` 文件匹配。
- 团队 Key 是否设置了正确的 `ASC_ISSUER_ID`。
- 个人 Key 是否错误地设置了团队 Issuer ID。
- 私钥路径是否可读。
- API Key 是否仍然有效。

#### 返回 403

API Key 可能没有编辑目标 App 元数据的权限，或没有被授予目标 App 的访问权限。

#### 找不到指定语言

`--source-locale` 和 `--target-locales` 只能指定该版本已经存在的 App Store 本地化语言。Skill 不会自动创建新语言。

#### App Store 状态发生变化

重新拉取草稿。Skill 会拒绝上传基于旧版本状态或旧语言列表生成的草稿。

### 官方参考

- Codex Skills：https://developers.openai.com/codex/skills
- App Store Connect API Token：https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests
- 更新 App Store 版本本地化：https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstoreversionlocalizations-_id_
- 获取 App Store 版本本地化：https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-appstoreversionlocalizations

---

## English Documentation

### Features

This skill can:

- Discover the app's bundle identifier from the current project.
- Find the current editable App Store version and its existing locales.
- Translate one user-provided source language into every existing locale.
- Read an existing App Store locale and use it as the translation source.
- Update only one or more explicitly selected locales.
- Update `whatsNew` release notes.
- Update the full App Store `description`.
- Validate every selected value against a conservative 4,000-character limit.
- Re-check the app, version, state, and locale set immediately before upload.
- Produce a dry-run preview without changing App Store Connect.

The AI agent performs the translation. The bundled Node.js helper discovers the project, reads App Store Connect metadata, validates lengths, and performs the selected updates.

### Requirements

- Codex, or another AI agent that can load `SKILL.md` and run local commands.
- Node.js 18 or later.
- An App Store Connect API key.
- Permission to edit version metadata for the target app.

Check Node.js:

```sh
node --version
```

### Installation

#### Install the folder

Copy the complete skill folder into the Codex skills directory:

```sh
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
cp -R app-store-release-notes "${CODEX_HOME:-$HOME/.codex}/skills/"
```

The installed entry point should be:

```text
~/.codex/skills/app-store-release-notes/SKILL.md
```

#### Install from the ZIP archive

```sh
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
unzip app-store-release-notes.zip -d "${CODEX_HOME:-$HOME/.codex}/skills"
```

If a skill with the same name is already installed, back it up and replace the complete folder so old and new helper files are not mixed.

Invoke it on the next Codex turn or in a new task with:

```text
$app-store-release-notes
```

Verify the helper:

```sh
node "${CODEX_HOME:-$HOME/.codex}/skills/app-store-release-notes/scripts/app-store-release-notes.mjs" --help
```

### App Store Connect environment variables

Never paste the `.p8` private key into chat, commit it to Git, or place it in a translation draft.

#### Team API key

```sh
export ASC_KEY_ID="ABC123DEFG"
export ASC_ISSUER_ID="00000000-0000-0000-0000-000000000000"
export ASC_PRIVATE_KEY_PATH="$HOME/private_keys/AuthKey_ABC123DEFG.p8"
```

#### Individual API key

Individual keys do not use `ASC_ISSUER_ID`:

```sh
export ASC_KEY_ID="ABC123DEFG"
export ASC_PRIVATE_KEY_PATH="$HOME/private_keys/AuthKey_ABC123DEFG.p8"
unset ASC_ISSUER_ID
```

#### Variable reference

| Variable | Required | Purpose |
|---|---:|---|
| `ASC_KEY_ID` | Yes | App Store Connect API key ID. |
| `ASC_ISSUER_ID` | Team keys only | Issuer ID for a team API key; omit it for an individual key. |
| `ASC_PRIVATE_KEY_PATH` | Recommended | Absolute path to the `.p8` private key. |
| `ASC_PRIVATE_KEY` | Optional | Inline PEM supplied by a secure runtime; avoid entering it manually in shell history. |

When `ASC_PRIVATE_KEY_PATH` is not set, the helper also checks:

```text
./private_keys/AuthKey_<KEY_ID>.p8
~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8
~/private_keys/AuthKey_<KEY_ID>.p8
```

For persistent use, non-secret IDs and the private-key path can be placed in your shell configuration. Do not store the private-key contents in the repository:

```sh
# Example ~/.zshrc
export ASC_KEY_ID="ABC123DEFG"
export ASC_ISSUER_ID="00000000-0000-0000-0000-000000000000"
export ASC_PRIVATE_KEY_PATH="$HOME/private_keys/AuthKey_ABC123DEFG.p8"
```

Reload the shell configuration:

```sh
source ~/.zshrc
```

### Natural-language usage

Run Codex from the target app project's root directory. The skill can inspect common Xcode, Fastlane, Expo, Capacitor, Flutter/Xcode, and Unity files.

#### Read-only first test

```text
Use $app-store-release-notes to identify the current app, editable version, and existing locales. Preview only; do not upload anything.
```

#### Translate new release notes into every existing locale

```text
Use $app-store-release-notes to translate and upload the following Simplified Chinese What's New text to every existing locale:

新增批量导出功能，并修复部分情况下的数据同步问题。
```

#### Translate an existing English description into other locales

```text
Use $app-store-release-notes with the current en-US App Store description as the source. Translate and update every other existing locale, but do not modify en-US.
```

#### Replace the source description and translate all locales

```text
Use $app-store-release-notes to use the following text as the new zh-Hans App Store description. Update zh-Hans and translate it into every other existing locale:

这是一款帮助你记录、整理并快速查找重要内容的应用。
```

#### Update only selected locales

```text
Use $app-store-release-notes with the following Chinese text as the source, but update only en-US, ja, and ko-KR:

这是一款简单、快速且注重隐私的记录工具。
```

#### Set one locale directly

```text
Use $app-store-release-notes to update only the ja App Store description to:

シンプルで高速、プライバシーを重視した記録アプリです。
```

#### Draft without uploading

```text
Use $app-store-release-notes to draft all localized App descriptions and validate their lengths, but do not upload anything.
```

### Character limits

| Field | Purpose | Skill safety limit |
|---|---|---:|
| `whatsNew` | Version release notes | 4,000 characters |
| `description` | Full App Store description | 4,000 characters |

The helper checks both Unicode code points and UTF-16 units and uses the more conservative result for emoji and supplementary characters.

When a translation is too long, the AI should remove repetition and unnecessary marketing language first. It must not silently remove price conditions, subscription disclosures, compatibility information, limitations, or other material facts.

### Advanced CLI usage

Natural-language skill invocation is recommended. The helper commands below are intended for debugging and manual inspection; the helper itself does not call a translation model.

```sh
HELPER="${CODEX_HOME:-$HOME/.codex}/skills/app-store-release-notes/scripts/app-store-release-notes.mjs"
```

Scan the project:

```sh
node "$HELPER" scan --project-dir .
```

Pull a release-notes draft:

```sh
node "$HELPER" pull \
  --field whatsNew \
  --project-dir . \
  --output /tmp/app-store-whats-new.json
```

Use the current `en-US` description as the source:

```sh
node "$HELPER" pull \
  --field description \
  --source-locale en-US \
  --project-dir . \
  --output /tmp/app-store-description.json
```

Select only named locales:

```sh
node "$HELPER" pull \
  --field description \
  --target-locales en-US,ja,ko-KR \
  --project-dir . \
  --output /tmp/app-store-description.json
```

Validate a draft:

```sh
node "$HELPER" validate --file /tmp/app-store-description.json
```

Dry-run an upload:

```sh
node "$HELPER" upload --file /tmp/app-store-description.json
```

Perform the upload:

```sh
node "$HELPER" upload --file /tmp/app-store-description.json --yes
```

`--yes` modifies App Store Connect. Confirm the app, version, platform, field, source locale, and selected target locales first.

### Optional target arguments

Use these when automatic discovery is ambiguous:

```text
--bundle-id com.example.app
--app-id 1234567890
--platform IOS
--version 2.4.0
```

When a project contains an app, tests, widgets, or multiple app targets, the helper prioritizes likely main-app identifiers. It stops and asks for an explicit target if ambiguity remains.

### Safety behavior

- Upload is a dry run unless `--yes` is supplied.
- Only the selected `whatsNew` or `description` field is patched.
- Only selected existing locales are updated.
- Locales are never implicitly created or deleted.
- Screenshots, keywords, subtitles, and unrelated metadata are not changed.
- Builds are not uploaded, review is not submitted, and release controls are not changed.
- Remote data is checked again before mutation; the upload stops if the app, version, state, or locale set changed.
- Locale updates are not atomic. A partial failure reports completed and remaining locales without attempting a risky rollback.

### Troubleshooting

#### Bundle ID not found

Specify it explicitly in the prompt:

```text
Use $app-store-release-notes for bundle ID com.example.app. Read the locale list only and do not upload.
```

#### Multiple apps or platforms found

Specify the version and platform:

```text
Use $app-store-release-notes for IOS version 2.4.0 and preview the description translations only.
```

#### HTTP 401 or authentication failure

Check that:

- `ASC_KEY_ID` matches the `.p8` file.
- A team key has the correct `ASC_ISSUER_ID`.
- An individual key is not using a team issuer ID.
- The private-key path is readable.
- The API key is still active.

#### HTTP 403

The API key may not have permission to edit metadata for the target app, or it may not have access to that app.

#### Locale not found

`--source-locale` and `--target-locales` can only name localizations that already exist on the selected App Store version. This skill does not create locales automatically.

#### App Store state changed

Pull a new draft. The skill refuses to upload a draft based on stale version state or a stale locale set.

### Official references

- Codex Skills: https://developers.openai.com/codex/skills
- App Store Connect API token generation: https://developer.apple.com/documentation/appstoreconnectapi/generating-tokens-for-api-requests
- Update an App Store version localization: https://developer.apple.com/documentation/appstoreconnectapi/patch-v1-appstoreversionlocalizations-_id_
- List App Store version localizations: https://developer.apple.com/documentation/appstoreconnectapi/get-v1-appstoreversions-_id_-appstoreversionlocalizations
