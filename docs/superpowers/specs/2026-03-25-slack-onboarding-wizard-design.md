# Slack Onboarding Wizard Design

## Overview

Interactive CLI wizard for setting up the Slack adapter in OpenACP. Invoked via `openacp onboard slack` or selected during `openacp onboard` (platform picker). Uses the App Manifest approach to eliminate manual scope/event configuration on api.slack.com, and auto-creates the `#openacp-notifications` channel (private) after authentication.

## Motivation

The current Slack setup requires users to manually configure 15+ steps on api.slack.com (scopes, events, slash commands, interactivity, Socket Mode) before they can copy tokens into config. This is the highest-friction onboarding path in OpenACP. The wizard reduces this to: paste one JSON manifest → copy 3 tokens → done.

Additionally, when new features require new bot token scopes, users must reinstall the Slack app. The wizard provides a dedicated `--upgrade-scopes` path for this case.

## Approach

Extend `src/core/setup.ts` with two exported functions:
- `setupSlack(stepNum, totalSteps)` — main wizard, following the `setupTelegram()` / `setupDiscord()` pattern
- `upgradeSlackScopes()` — separate export for the `--upgrade-scopes` path, called directly from `commands.ts`

Add `generateSlackManifest()` as a helper. Wire `setupSlack()` into `runSetup()` as a selectable channel option. Subcommand routing (`openacp onboard slack` and `openacp onboard slack --upgrade-scopes`) is handled in `commands.ts` / `cmdOnboard()` as defined in `2026-03-24-cli-onboarding-v2-design.md`.

## Config Fields

| Field | Required | Source |
|---|---|---|
| `enabled` | — | Hardcoded `true` |
| `adapter` | — | Hardcoded `"slack"` |
| `botToken` | ✅ Required | User input → validated via `auth.test()` |
| `appToken` | ✅ Required | User input → format-validated (`xapp-1-` prefix) |
| `signingSecret` | ✅ Required | User input |
| `notificationChannelId` | Optional | Auto-created by wizard via Slack API (private channel) |
| `allowedUserIds` | Optional | User input — comma-separated Slack User IDs, empty = allow all |
| `channelPrefix` | Optional | User input — default `"openacp"` |
| `autoCreateSession` | Optional | Default `true` — not prompted, documented as post-onboarding config |
| `startupChannelId` | — | Not set by wizard — managed internally after first run |

## Wizard Flow

### Invocation

- `openacp onboard` → platform picker includes Slack → calls `setupSlack()`
- `openacp onboard slack` → calls `setupSlack()` directly, bypassing picker
- `openacp onboard slack --upgrade-scopes` → scope upgrade path (see below)

When Slack is already configured and `setupSlack()` is called, the wizard prompts:
```
Slack is already configured. Re-run setup? This will overwrite existing credentials.
  ● Yes, reconfigure
  ○ Cancel
```

### `setupSlack()` — main wizard

```
Step 1: App Manifest
  → generateSlackManifest()
  → Display manifest JSON in bordered box
  → Print instructions:
      1. Open https://api.slack.com/apps
      2. Create New App → From a manifest
      3. Select your workspace
      4. Paste the manifest → Next → Create → Install to Workspace
      5. After install: copy Bot Token from OAuth & Permissions
         copy App Token from Basic Information → App-Level Tokens
         copy Signing Secret from Basic Information → App Credentials
  → Press Enter when done...  [guardCancel — Ctrl+C exits without writing config]

Step 2: Credentials (required)
  → Prompt: Bot Token (xoxb-...)
  → Prompt: App Token (xapp-1-...)   [format-validated: must start with xapp-1-]
  → Prompt: Signing Secret
  → Warning shown immediately after collecting appToken and signingSecret:
    "⚠ App Token and Signing Secret cannot be validated until the adapter starts."
  → Spinner: "Validating Bot Token..." → call Slack auth.test() with botToken
  → On fail: show error + retry or skip options (same pattern as setupTelegram)
  → On success: show "✓ Authenticated as @<botUsername>"

Step 3: Optional config
  → Prompt: "Allowed Slack User IDs (comma-separated, or Enter to allow all):"
    → parse into string[] — empty input = []
  → Prompt: "Channel prefix:" initialValue="openacp"

Step 3.5: Voice setup (optional)
  → Prompt: "Do you want to enable voice support? (Speech-to-Text / Text-to-Speech)"
    → If No: skip
    → If Yes:
      STT setup:
        → Prompt: "Groq API key for Speech-to-Text (get free key at console.groq.com, or Enter to skip):"
        → If provided: write to config speech.stt.provider="groq" + speech.stt.providers.groq.apiKey
        → Note: files:read is already in the app manifest — no reinstall needed

      TTS setup:
        → Prompt: "Enable Text-to-Speech (Edge TTS, free, no API key needed)? [Y/n]"
        → If Yes: write to config speech.tts.provider="edge-tts"
        → Prompt: "Voice (Enter for default en-US-AriaNeural):"
          → Show examples: en-US-GuyNeural, vi-VN-HoaiMyNeural, ja-JP-NanamiNeural
        → If provided: write to config speech.tts.providers.edge-tts.voice
        → Note: files:write is already in the app manifest — no reinstall needed

Step 4: Auto-create notification channel
  → Spinner: "Creating #openacp-notifications..."
  → Call conversations.create({ name: "openacp-notifications", is_private: true })
  → Store channelId as notificationChannelId in config
  → Show "✓ Created #openacp-notifications (C0XXXXXXX)"
  → Note: bot cannot invite the human operator via API without their Slack User ID.
    After creation, print:
    "➜ Join the channel: open Slack → search for #openacp-notifications → Join"
  → On fail (name already taken):
    → Try to look up existing channel by name via conversations.list
      (call with types=private_channel; paginate until found or exhausted)
    → If found: reuse its ID, show "✓ Using existing #openacp-notifications"
    → If not found or lookup fails: warn + skip, print:
      "Set notificationChannelId manually in config after joining the channel"

Step 5: Save config
  → Write SlackChannelConfig to channels.slack in config file
  → Show "✓ Slack adapter configured"
  → Print: "Note: autoCreateSession is enabled by default.
    To disable, run: openacp config set channels.slack.autoCreateSession false"
```

Cancellation: Every prompt uses `guardCancel()` (same as `setupTelegram`). Ctrl+C at any step cancels with message "Setup cancelled." and exits without writing config.

### `--upgrade-scopes` path

Used when a new OpenACP version introduces features that require additional bot token scopes (which mandate reinstalling the Slack app). The wizard detects what scopes the current manifest version provided vs what the new version requires.

```
openacp onboard slack --upgrade-scopes

  → Load current config (requires existing channels.slack.botToken)
  → Show current manifest version vs latest:
      Current: v1 (core scopes)
      Latest:  v2 (adds: <new scopes listed here>)
  → If already on latest: print "Your Slack app scopes are up to date." and exit
  → Show diff of new scopes being added
  → Display updated manifest JSON
  → Print instructions:
      1. Open api.slack.com/apps → Your App → App Manifest
      2. Replace entire manifest with the one below
      3. Save Changes → Reinstall App → Install to Workspace
      4. Copy the new Bot Token from OAuth & Permissions
  → Press Enter when done...  [guardCancel — Ctrl+C exits without saving]
  → Prompt: New Bot Token (xoxb-...)
  → Validate via auth.test()
  → Save new botToken to config, update manifest version marker
  → Show "✓ Scope upgrade complete"
```

The manifest is versioned (e.g. `v1`, `v2`) so the wizard can detect when an upgrade is needed. The current version marker is stored in `~/.openacp/slack-manifest-version` (a plain text file, separate from the user-facing config) to avoid extending `SlackChannelConfig` with wizard state.

## Manifest Generation

`generateSlackManifest()` returns a JSON object. The manifest is versioned; future scope additions increment the version.

Note: `connections:write` is an **app-level token scope** required for Socket Mode. It cannot be declared in the manifest's `oauth_config` block — it is provisioned when the user creates an App-Level Token in the Slack dashboard after installing the app. The manifest's `socket_mode_enabled: true` triggers Slack to prompt for this automatically. No additional manifest entry is needed.

### v1 — Initial (deprecated, do not use)

v1 was missing three required fields discovered during live testing:
- `commands` bot scope — required by Slack when `slash_commands` is declared; without it the manifest is rejected with "Slash Commands requires `commands` bot scope"
- `message.im` event — required to receive DMs to the bot
- `app_home.messages_tab_enabled` — required to allow users to DM the bot; without it the Messages tab shows "Sending messages to this app has been turned off"

### v2 — Current manifest

```json
{
  "display_information": { "name": "OpenACP" },
  "features": {
    "app_home": { "messages_tab_enabled": true, "messages_tab_read_only_enabled": false },
    "bot_user": { "display_name": "OpenACP", "always_online": true },
    "slash_commands": [
      {
        "command": "/openacp-archive",
        "description": "Archive current session channel and start fresh",
        "should_escape": false
      }
    ]
  },
  "oauth_config": {
    "scopes": {
      "bot": [
        "channels:manage", "channels:history", "channels:join", "channels:read",
        "chat:write", "chat:write.public",
        "commands",
        "groups:write", "groups:history", "groups:read",
        "files:read", "files:write", 
        "im:history"
      ]
    }
  },
  "settings": {
    "event_subscriptions": {
      "bot_events": ["message.channels", "message.groups", "message.im"]
    },
    "interactivity": { "is_enabled": true },
    "socket_mode_enabled": true,
    "token_rotation_enabled": false
  }
}
```


## Integration into `runSetup()`

Add `"slack"` to the channel picker in `runSetup()`:

```
Which messaging platform do you want to use?
  ● Telegram
  ● Discord
  ● Slack
  ● Multiple...
```

`setupSlack()` accepts `(stepNum: number, totalSteps: number)` matching the existing signature of `setupTelegram()`.

## Error Handling

| Scenario | Behavior |
|---|---|
| Invalid botToken | Show error + retry or skip (same as setupTelegram) |
| appToken wrong format | Inline validation: "App Token must start with xapp-1-" before API call |
| Invalid appToken / signingSecret | Cannot validate pre-start — save as-is with warning |
| `#openacp-notifications` name taken | Try to reuse existing channel; if unavailable, skip + instruct manual config |
| Network error during auth.test() | Show error + retry or skip |
| Slack already configured (re-run) | Prompt confirmation before overwriting |
| Ctrl+C at any point | `guardCancel()` → "Setup cancelled." → exit without writing config |
| Ctrl+C during --upgrade-scopes | Exit without saving new token — existing config preserved |
| No existing Slack config when running --upgrade-scopes | Print "No Slack config found. Run `openacp onboard slack` first." and exit |

## DM Handling (discovered during testing)

When a user DMs the OpenACP bot directly:

1. `SlackEventRouter` detects `channelId.startsWith("D")` (Slack DM channel format) and calls `onNewSession(text, userId, fromChannelId)`
2. The adapter's `onNewSession` callback:
   - Creates a new session via `core.handleNewSession(..., { createThread: true })`
   - Calls `conversations.invite` to invite the triggering `userId` to the new private channel
   - Replies in the originating DM with a link: "✅ New session started! Continue the conversation in #channel"
   - Routes the initial message text to the new session

The same `onNewSession` flow applies when a user messages `#openacp-notifications`.

**Important:** `conversations.invite` must be called explicitly for the triggering user. `channel-manager.ts` only auto-invites users listed in `config.allowedUserIds` — when `allowedUserIds` is empty (allow all), no one is invited automatically.

## Out of Scope

- Multi-workspace support
- Auto-detecting an existing Slack app to reuse
- `/openacp-new` slash command (not yet implemented — mentioned in slack-setup.md docs but not in codebase)
- Inviting the human operator to `#openacp-notifications` via API (requires their Slack User ID — user joins manually instead)

## Notes

- **Voice support (STT/TTS)** is in scope via Step 3.5. The core manifest already includes `files:read` and `files:write` — no reinstall needed for voice. STT requires a Groq API key; TTS uses Edge TTS (free, no key).
- **Slash commands in manifest**: Only `/openacp-archive` is implemented in code. Other commands listed in `docs/slack-setup.md` (`/new`, `/cancel`, etc.) appear to be planned/undocumented and are not added to the manifest until implemented.
- **Manifest must declare `commands` scope** when `slash_commands` is present — Slack rejects the manifest otherwise. This is not documented clearly in Slack's manifest reference.
- **`app_home.messages_tab_enabled: true` is required** for DMs to work — without it the Messages tab is disabled for users and cannot be fixed at runtime.
