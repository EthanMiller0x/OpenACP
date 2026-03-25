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

### SOLID & Adapter Isolation

- **Single Responsibility:** Slash command + button handling lives in a dedicated `SlackArchiveHandler` class (not in `SlackEventRouter`). This follows the established pattern of `SlackPermissionHandler` which also registers its own `app.action()` handlers.
- **Open/Closed:** Core requires zero changes. `ChannelAdapter.archiveSessionTopic()` is the extension point — Slack overrides it.
- **Liskov Substitution:** `SlackAdapter` extends `ChannelAdapter` and fulfills the contract. Core calls `adapter.archiveSessionTopic()` polymorphically.
- **Interface Segregation:** `archiveSessionTopic()` is optional (default returns `null`). Adapters that don't support archiving don't need to implement it. Core handles `null` gracefully.
- **Dependency Inversion:** `SlackArchiveHandler` depends on callbacks (`SessionLookup`, `ArchiveSessionCallback`), not concrete classes.

### Existing Core Abstractions (no changes needed)

- `ChannelAdapter.archiveSessionTopic(sessionId)` — concrete method with default `null` return. Telegram overrides it. Core's `archiveSession()` checks for `null` and returns `{ ok: false, error: "Adapter does not support archiving" }`.
- `OpenACPCore.archiveSession(sessionId)` — orchestrator that calls `adapter.archiveSessionTopic()`, handles errors.
- `POST /api/sessions/:sessionId/archive` — API route already wired.

### Changes Required

#### 1. `SlackSessionMeta` — Add `sessionId`

The `sessionLookup` callback returns `SlackSessionMeta` which currently contains `channelId` and `channelSlug` but NOT the OpenACP `sessionId`. The archive handler needs to map from Slack channelId to OpenACP sessionId. Add `sessionId` to the interface:

```typescript
export interface SlackSessionMeta {
  sessionId: string;     // OpenACP session ID
  channelId: string;     // Slack channel ID (C...)
  channelSlug: string;   // e.g. "openacp-fix-auth-bug-a3k9"
}
```

All places that create `SlackSessionMeta` (3 locations in `adapter.ts`) must include `sessionId`.

#### 2. `SlackArchiveHandler` — New class

Dedicated handler for `/openacp-archive` slash command and `archive:` button callbacks. Follows `SlackPermissionHandler` pattern:

```typescript
// src/adapters/slack/archive-handler.ts
export type ArchiveSessionCallback = (sessionId: string) => Promise<{ ok: boolean; error?: string }>;

export interface ISlackArchiveHandler {
  register(app: App): void;
}

export class SlackArchiveHandler implements ISlackArchiveHandler {
  constructor(
    private sessionLookup: SessionLookup,
    private onArchive: ArchiveSessionCallback,
    private isAllowedUser: (userId: string) => boolean,
  ) {}

  register(app: App): void {
    // Register /openacp-archive slash command
    // Register archive:confirm and archive:cancel button actions
  }
}
```

**Slash command `/openacp-archive`:**
- `await ack()` within 3s (Slack API requirement)
- Check `isAllowedUser(command.user_id)`
- Lookup session via `sessionLookup(command.channel_id)`
- If no session: ephemeral "No active session in this channel."
- If found: ephemeral with "Archive & start fresh" and "Cancel" buttons

**Button callbacks:**
- `archive:confirm` → call `onArchive(sessionId)` → respond with result
- `archive:cancel` → respond with "Cancelled." via `replace_original: true` (Slack ephemeral messages cannot be deleted — only updated/replaced)

#### 3. `SlackAdapter.archiveSessionTopic()` override

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
     → returns { sessionId, channelId: newChannelId, channelSlug: newSlug }
  9. Rewire session:
     - session.threadId = newSlug
     - this.sessions.set(sessionId, newMeta)
       (both channelId and channelSlug change — must replace entire entry
        so sessionLookup finds session in new channel)
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

#### 4. `sendMessage()` archiving guard

Current `SlackAdapter.sendMessage()` does not access the Session object. Add a guard at the top:

```typescript
const session = this.core.sessionManager.getSession(sessionId);
if (session?.archiving) return;
```

This mirrors the Telegram pattern at `adapter.ts:722-726`.

#### 5. `SlackChannelManager` — No changes needed

`archiveChannel()` and `createChannel()` already exist and handle all Slack API interactions.

#### 6. `SlackEventRouter` — No changes needed

Slash command and button handling are in `SlackArchiveHandler`, keeping the router focused on message routing only.

#### 7. Wiring in `SlackAdapter.start()`

Create and register `SlackArchiveHandler` alongside existing handlers:

```typescript
this.archiveHandler = new SlackArchiveHandler(
  (channelId) => { /* sessionLookup — same as eventRouter */ },
  async (sessionId) => this.core.archiveSession(sessionId),
  (userId) => this.isAllowedUser(userId),
);
this.archiveHandler.register(this.app);
```

## Slack App Manifest

Users must add the slash command to their Slack App configuration:

```yaml
slash_commands:
  - command: /openacp-archive
    description: Archive current session channel and start fresh
    usage_hint: ""
```

One-time setup. No additional OAuth scopes needed — `conversations.archive` requires `groups:write` (private channels) which is already required by existing channel management features.

## Testing

1. **`SlackArchiveHandler` slash command** — mock `ack()`, `sessionLookup`, `client.chat.postEphemeral`; verify ephemeral posted with correct buttons when session exists; verify error ephemeral when no session
2. **`SlackArchiveHandler` button callbacks** — verify `onArchive(sessionId)` called on confirm; verify ephemeral replaced with "Cancelled." on cancel
3. **`archiveSessionTopic()` unit test** — mock `channelManager`, verify: old channel archived, new channel created, session rewired (threadId, sessions Map entry replaced, patchRecord called with `topicId`)
4. **Error path** — old channel archived but new channel creation fails → notification sent, archiving flag reset to false
5. **Archiving flag** — verify `sendMessage()` returns early while `session.archiving = true`
6. **Double-archive guard** — verify second archive request while `archiving = true` returns null

Mock at boundaries: `channelManager`, `core.sessionManager`, `core.archiveSession`. Use `vi.fn()` per existing test conventions.

## Files Changed

- `src/adapters/slack/types.ts` — extend `SlackSessionMeta` to include `sessionId`
- `src/adapters/slack/archive-handler.ts` — **new** — `SlackArchiveHandler` class
- `src/adapters/slack/adapter.ts` — add `archiveSessionTopic()` override, add `archiving` guard in `sendMessage()`, wire `SlackArchiveHandler` in `start()`, include `sessionId` when populating `sessions` Map
- `src/adapters/slack/archive-handler.test.ts` — **new** — tests for slash command and button handlers
- `src/adapters/slack/archive.test.ts` — **new** — tests for `archiveSessionTopic()` logic
