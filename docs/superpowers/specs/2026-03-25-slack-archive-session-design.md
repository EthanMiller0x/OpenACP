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

- `ChannelAdapter.archiveSessionTopic(sessionId)` — abstract method with default no-op. Telegram overrides it.
- `OpenACPCore.archiveSession(sessionId)` — orchestrator that calls `adapter.archiveSessionTopic()`, handles errors.
- `POST /api/sessions/:sessionId/archive` — API route already wired.

### Changes Required

#### 1. `SlackAdapter.archiveSessionTopic()` override

Mirrors Telegram's `archiveSessionTopic()` pattern, adapted for Slack:

```
archiveSessionTopic(sessionId):
  1. Set session.archiving = true  (block outgoing messages)
  2. Finalize pending text buffer (flush SlackTextBuffer)
  3. Cleanup trackers: textBuffers, permissionHandler for old channel
  4. Archive old channel via channelManager.archiveChannel(oldChannelId)
  5. Create new channel via channelManager.createChannel(sessionId, name)
  6. Rewire: session.threadId = newSlug, update sessions Map with new meta
  7. Persist via patchRecord({ platform: { topicId: newSlug } })
  8. Set session.archiving = false
  9. Return { newThreadId: newSlug }
```

Key differences from Telegram:
- Telegram deletes old topic entirely; Slack archives it (still searchable)
- Telegram uses numeric topicId; Slack uses string slug
- Slack auto-invites `allowedUserIds` into new channel (handled by `channelManager.createChannel()`)

Error handling: If new channel creation fails after archiving old channel, send error notification via `notificationManager`. Session becomes orphaned but user is informed.

The `archiving` flag on Session must be checked in `sendMessage()` to skip outgoing messages during migration.

#### 2. Slash Command Handler

Register `/openacp-archive` in `SlackEventRouter.register(app)`:

```
app.command("/openacp-archive", async ({ command, ack, client }) => {
  await ack();  // Must ack within 3s per Slack API

  const session = sessionLookup(command.channel_id);
  if (!session) {
    // Ephemeral: "No active session in this channel"
    return;
  }

  // Post ephemeral with confirmation buttons
  client.chat.postEphemeral({
    channel: command.channel_id,
    user: command.user_id,
    text: "Archive this channel and start a fresh one? Agent context will be preserved.",
    blocks: [{
      type: "actions",
      elements: [
        { type: "button", text: "Archive & start fresh", action_id: "archive:confirm", value: sessionSlug },
        { type: "button", text: "Cancel", action_id: "archive:cancel" }
      ]
    }]
  });
});
```

#### 3. Button Callback Handler

Add `app.action(/^archive:/)` handler:

- `archive:confirm` → call `core.archiveSession(sessionId)` → post success message in new channel
- `archive:cancel` → delete ephemeral message

This follows existing Slack adapter patterns (permission buttons use `p:` prefix, menu uses `m:` prefix — archive uses `archive:` prefix).

#### 4. `SlackChannelManager` — No changes needed

`archiveChannel()` and `createChannel()` already exist and handle all Slack API interactions.

#### 5. `SlackEventRouter` — Extended

New dependencies:
- `onArchive: (sessionSlug: string) => void` callback, similar to existing `onNewSession` callback
- Or: direct reference to `core` for calling `archiveSession()`

The router needs the Slack `client` for posting ephemeral messages and handling button callbacks.

## Slack App Manifest

Users must add the slash command to their Slack App configuration:

```yaml
slash_commands:
  - command: /openacp-archive
    description: Archive current session channel and start fresh
    usage_hint: ""
```

This is a one-time setup step. Should be documented in Slack adapter setup guide.

## Testing

1. **`archiveSessionTopic()` unit test** — mock `channelManager`, verify: old channel archived, new channel created, session rewired (threadId, sessions Map, patchRecord)
2. **Slash command handler** — mock `ack()`, verify ephemeral message posted with correct buttons when session exists; verify error message when no session
3. **Button callback** — verify `core.archiveSession()` called on confirm; message dismissed on cancel
4. **Error path** — old channel archived but new channel creation fails → notification sent, archiving flag reset
5. **Archiving flag** — verify `sendMessage()` returns early while `session.archiving = true`

Mock at boundaries: `channelManager`, `core.sessionManager`, `core.archiveSession`. Use `vi.fn()` per existing test conventions.

## Files Changed

- `src/adapters/slack/adapter.ts` — add `archiveSessionTopic()` override, check `archiving` flag in `sendMessage()`
- `src/adapters/slack/event-router.ts` — register `/openacp-archive` command, `archive:` button callbacks
- `src/adapters/slack/__tests__/archive.test.ts` — new test file
