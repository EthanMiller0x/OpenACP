# Slack Archive Session Design

## Problem

When a Slack session channel accumulates too many messages, users cannot start fresh without losing agent context. Telegram already solves this with `/archive` — Slack needs the same capability.

## Requirements

- User triggers `/openacp-archive` slash command in a session channel
- Confirmation UI: ephemeral message with "Archive & start fresh" and "Cancel" buttons
- Old channel is archived via Slack API (hidden from sidebar, still searchable)
- New channel is created, agent subprocess continues with full context
- Session is rewired to the new channel seamlessly

## Architecture

### Existing Core Abstractions (no changes needed)

The archive flow is already abstracted in core:

- `ChannelAdapter.archiveSessionTopic(sessionId)` — concrete method with default `null` return (not abstract). Telegram overrides it. Core's `archiveSession()` checks for `null` and returns `{ ok: false, error: "Adapter does not support archiving" }`.
- `OpenACPCore.archiveSession(sessionId)` — orchestrator that calls `adapter.archiveSessionTopic()`, handles errors.
- `POST /api/sessions/:sessionId/archive` — API route already wired.

### Changes Required

#### 1. `SlackAdapter.archiveSessionTopic()` override

Mirrors Telegram's `archiveSessionTopic()` pattern, adapted for Slack:

```
archiveSessionTopic(sessionId):
  1. Get session via core.sessionManager.getSession(sessionId)
  2. Guard: if session.archiving is true, return null (prevent double-archive)
  3. Set session.archiving = true  (block outgoing messages)
  4. Finalize pending text buffer (flush SlackTextBuffer)
  5. Cleanup trackers: textBuffers, permissionHandler for old channel
  6. Save old channelId from this.sessions.get(sessionId)
  7. Archive old channel via channelManager.archiveChannel(oldChannelId)
  8. Create new channel via channelManager.createChannel(sessionId, name)
     → returns { channelId: newChannelId, channelSlug: newSlug }
  9. Rewire session:
     - session.threadId = newSlug
     - this.sessions.delete(sessionId) then this.sessions.set(sessionId, newMeta)
       (both channelId and channelSlug change — must replace entire entry
        so SlackEventRouter.sessionLookup finds session in new channel)
  10. Persist via patchRecord({ platform: { ...existingPlatform, topicId: newSlug } })
      (key is `topicId` not `threadId` — matches existing Slack adapter pattern
       used by lazyResume's store.findByPlatform)
  11. Set session.archiving = false
  12. Return { newThreadId: newSlug }
```

Key differences from Telegram:
- Telegram deletes old topic entirely; Slack archives it (still searchable). If a user manually unarchives the old channel and sends a message, `sessionLookup` will not find a session for that channelId (entry was replaced in step 9), so the message is silently ignored by the event router.
- Telegram uses numeric topicId; Slack uses string slug
- Slack auto-invites `allowedUserIds` into new channel (handled by `channelManager.createChannel()`)

Error handling: If new channel creation fails after archiving old channel, send error notification via `notificationManager`, reset `session.archiving = false`, and throw. Session becomes orphaned but user is informed.

#### 2. `sendMessage()` archiving guard

Current `SlackAdapter.sendMessage()` does not access the Session object. Add a guard at the top:

```typescript
const session = this.core.sessionManager.getSession(sessionId);
if (session?.archiving) return;
```

This mirrors the Telegram pattern at `adapter.ts:722-726`.

#### 3. Slash Command Handler

Register `/openacp-archive` in `SlackEventRouter.register(app)`. This is a **new pattern** — no existing slash commands exist in the Slack adapter. The existing `/openacp-new` reference in the codebase is informational text only.

The `sessionLookup` callback returns `SlackSessionMeta` which contains `channelId` and `channelSlug` but NOT the OpenACP `sessionId`. The router needs an additional callback or the `sessionLookup` return type needs to include `sessionId`. Recommended: extend `SlackSessionMeta` or add a new `sessionIdLookup(channelSlug: string) => string | undefined` callback.

```
app.command("/openacp-archive", async ({ command, ack, client }) => {
  await ack();  // Must ack within 3s per Slack API

  const meta = sessionLookup(command.channel_id);
  if (!meta) {
    // Ephemeral: "No active session in this channel"
    return;
  }

  // Guard against archive-in-progress
  // (check via session.archiving if sessionId is available)

  // Post ephemeral with confirmation buttons
  client.chat.postEphemeral({
    channel: command.channel_id,
    user: command.user_id,
    text: "Archive this channel and start a fresh one? Agent context will be preserved.",
    blocks: [{
      type: "actions",
      elements: [
        { type: "button", text: "Archive & start fresh", action_id: "archive:confirm", value: sessionId },
        { type: "button", text: "Cancel", action_id: "archive:cancel" }
      ]
    }]
  });
});
```

#### 4. Button Callback Handler

Add `app.action(/^archive:/)` handler:

- `archive:confirm` → call `core.archiveSession(sessionId)` → post message in new channel: "Session archived and moved to this channel. Agent context preserved."
- `archive:cancel` → update ephemeral message via `response_url` to replace with "Cancelled." (Slack ephemeral messages cannot be deleted — only updated/replaced)

This follows existing Slack adapter patterns (permission buttons use `p:` prefix, menu uses `m:` prefix — archive uses `archive:` prefix).

#### 5. `SlackChannelManager` — No changes needed

`archiveChannel()` and `createChannel()` already exist and handle all Slack API interactions.

#### 6. `SlackEventRouter` — Extended

New dependencies needed for slash command and button handling:
- `onArchive: (sessionId: string) => Promise<{ ok: boolean; error?: string }>` callback that wraps `core.archiveSession()`
- Extended `sessionLookup` to also return sessionId, OR a separate `sessionIdByChannel(channelId: string) => string | undefined` callback

The router already receives the Bolt `app` instance in `register()`, which provides `app.command()` and `app.action()` for handling slash commands and interactive buttons.

## Slack App Manifest

Users must add the slash command to their Slack App configuration:

```yaml
slash_commands:
  - command: /openacp-archive
    description: Archive current session channel and start fresh
    usage_hint: ""
```

This is a one-time setup step. Should be documented in Slack adapter setup guide. No additional OAuth scopes needed — `conversations.archive` requires `groups:write` (private channels) which is already required by existing channel management features.

## Testing

1. **`archiveSessionTopic()` unit test** — mock `channelManager`, verify: old channel archived, new channel created, session rewired (threadId, sessions Map entry replaced with new channelId/slug, patchRecord called with `topicId`)
2. **Slash command handler** — mock `ack()`, verify ephemeral message posted with correct buttons when session exists; verify error ephemeral when no session
3. **Button callback** — verify `core.archiveSession()` called on confirm; ephemeral updated to "Cancelled." on cancel
4. **Error path** — old channel archived but new channel creation fails → notification sent, archiving flag reset to false
5. **Archiving flag** — verify `sendMessage()` returns early while `session.archiving = true`
6. **Double-archive guard** — verify second archive request while `archiving = true` returns null

Mock at boundaries: `channelManager`, `core.sessionManager`, `core.archiveSession`. Use `vi.fn()` per existing test conventions.

## Files Changed

- `src/adapters/slack/adapter.ts` — add `archiveSessionTopic()` override, add `archiving` guard in `sendMessage()`
- `src/adapters/slack/event-router.ts` — register `/openacp-archive` command, `archive:` button callbacks, add new dependencies
- `src/adapters/slack/types.ts` — potentially extend `SlackSessionMeta` to include `sessionId`
- `src/adapters/slack/__tests__/archive.test.ts` — new test file
