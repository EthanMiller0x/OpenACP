# Slack Archive Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/openacp-archive` slash command to the Slack adapter so users can archive their current session channel and start fresh while preserving agent context.

**Architecture:** Override `ChannelAdapter.archiveSessionTopic()` in `SlackAdapter`. Create a dedicated `SlackArchiveHandler` class (following `SlackPermissionHandler` pattern) for slash command and button callbacks. Extend `SlackSessionMeta` with `sessionId` for reverse lookup. All core abstractions already exist — zero core changes needed.

**Tech Stack:** TypeScript, @slack/bolt (Slack SDK), Vitest

**Spec:** `docs/superpowers/specs/2026-03-25-slack-archive-session-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/adapters/slack/types.ts` | Modify | Add `sessionId` to `SlackSessionMeta` |
| `src/adapters/slack/archive-handler.ts` | **Create** | `SlackArchiveHandler` — slash command + button callbacks |
| `src/adapters/slack/adapter.ts` | Modify | Override `archiveSessionTopic()`, add archiving guard in `sendMessage()`, wire `SlackArchiveHandler`, include `sessionId` in sessions Map |
| `src/adapters/slack/channel-manager.ts` | Modify | Include `sessionId` in `createChannel()` return |
| `src/adapters/slack/archive-handler.test.ts` | **Create** | Tests for `SlackArchiveHandler` (command + buttons) |
| `src/adapters/slack/archive.test.ts` | **Create** | Tests for `archiveSessionTopic()` logic |

---

### Task 1: Extend `SlackSessionMeta` with `sessionId`

**Files:**
- Modify: `src/adapters/slack/types.ts:5-8`
- Modify: `src/adapters/slack/adapter.ts` (3 places that create meta)
- Modify: `src/adapters/slack/channel-manager.ts:42`

- [ ] **Step 1: Add `sessionId` to `SlackSessionMeta`**

In `src/adapters/slack/types.ts`:

```typescript
export interface SlackSessionMeta {
  sessionId: string;     // OpenACP session ID
  channelId: string;     // Slack channel ID for this session (C...)
  channelSlug: string;   // e.g. "openacp-fix-auth-bug-a3k9"
}
```

- [ ] **Step 2: Update `SlackChannelManager.createChannel()` to return `sessionId`**

In `src/adapters/slack/channel-manager.ts` line 42:

```typescript
return { sessionId, channelId, channelSlug: finalSlug };
```

- [ ] **Step 3: Update all 3 places in `adapter.ts` that populate `sessions` Map**

1. `createSessionThread()` (line 287) — already receives `sessionId` param, no spread needed since `createChannel` now returns it.

2. `_createStartupSession()` reuse path (line 225):
```typescript
this.sessions.set(session.id, { sessionId: session.id, channelId: reuseChannelId, channelSlug: slug });
```

3. The new-channel path in `_createStartupSession()` uses `createSessionThread()` which calls `createChannel()` — handled by step 2.

- [ ] **Step 4: Update existing tests that create `SlackSessionMeta` objects**

In `src/adapters/slack/event-router.test.ts`, add `sessionId` to all mock return values:

```typescript
// Example: line 116
sessionLookup.mockReturnValue({ sessionId: "sess-1", channelId: "C123", channelSlug: "openacp-session-abc1" });
```

Do the same in `channel-manager.test.ts` if it checks `SlackSessionMeta` shape.

- [ ] **Step 5: Run build and tests**

Run: `pnpm build && pnpm test -- --run src/adapters/slack/`
Expected: Build succeeds, all existing tests pass

- [ ] **Step 6: Commit**

```bash
git add src/adapters/slack/types.ts src/adapters/slack/adapter.ts src/adapters/slack/channel-manager.ts src/adapters/slack/event-router.test.ts src/adapters/slack/channel-manager.test.ts
git commit -m "feat(slack): add sessionId to SlackSessionMeta for reverse lookup"
```

---

### Task 2: Create `SlackArchiveHandler`

**Files:**
- Create: `src/adapters/slack/archive-handler.ts`
- Create: `src/adapters/slack/archive-handler.test.ts`

- [ ] **Step 1: Write the test file first**

Create `src/adapters/slack/archive-handler.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { SlackArchiveHandler } from "./archive-handler.js";
import type { SlackChannelConfig } from "./types.js";

function createMockApp() {
  const commandHandlers: Record<string, Function> = {};
  const actionHandlers: Record<string, Function> = {};
  return {
    command: vi.fn((name: string, handler: Function) => { commandHandlers[name] = handler; }),
    action: vi.fn((name: string, handler: Function) => { actionHandlers[name] = handler; }),
    _triggerCommand: async (name: string, payload: any) => {
      const handler = commandHandlers[name];
      if (handler) await handler(payload);
    },
    _triggerAction: async (name: string, payload: any) => {
      const handler = actionHandlers[name];
      if (handler) await handler(payload);
    },
  };
}

describe("SlackArchiveHandler", () => {
  describe("/openacp-archive command", () => {
    it("posts ephemeral confirmation when session exists", async () => {
      const sessionLookup = vi.fn().mockReturnValue({
        sessionId: "sess-1", channelId: "C123", channelSlug: "openacp-test",
      });
      const onArchive = vi.fn();
      const handler = new SlackArchiveHandler(sessionLookup, onArchive, () => true);
      const app = createMockApp();
      handler.register(app as any);

      const ack = vi.fn();
      const postEphemeral = vi.fn().mockResolvedValue({});

      await app._triggerCommand("/openacp-archive", {
        command: { channel_id: "C123", user_id: "U1" },
        ack,
        client: { chat: { postEphemeral } },
      });

      expect(ack).toHaveBeenCalled();
      expect(postEphemeral).toHaveBeenCalledWith(
        expect.objectContaining({ channel: "C123", user: "U1" }),
      );
    });

    it("posts error ephemeral when no session found", async () => {
      const sessionLookup = vi.fn().mockReturnValue(undefined);
      const handler = new SlackArchiveHandler(sessionLookup, vi.fn(), () => true);
      const app = createMockApp();
      handler.register(app as any);

      const ack = vi.fn();
      const postEphemeral = vi.fn().mockResolvedValue({});

      await app._triggerCommand("/openacp-archive", {
        command: { channel_id: "C_NONE", user_id: "U1" },
        ack,
        client: { chat: { postEphemeral } },
      });

      expect(ack).toHaveBeenCalled();
      expect(postEphemeral).toHaveBeenCalledWith(
        expect.objectContaining({ text: "No active session in this channel." }),
      );
    });

    it("ignores command from non-allowed user", async () => {
      const sessionLookup = vi.fn();
      const handler = new SlackArchiveHandler(sessionLookup, vi.fn(), () => false);
      const app = createMockApp();
      handler.register(app as any);

      const ack = vi.fn();
      const postEphemeral = vi.fn();

      await app._triggerCommand("/openacp-archive", {
        command: { channel_id: "C123", user_id: "U_BAD" },
        ack,
        client: { chat: { postEphemeral } },
      });

      expect(ack).toHaveBeenCalled();
      expect(sessionLookup).not.toHaveBeenCalled();
      expect(postEphemeral).not.toHaveBeenCalled();
    });
  });

  describe("button callbacks", () => {
    it("calls onArchive on confirm", async () => {
      const onArchive = vi.fn().mockResolvedValue({ ok: true, newThreadId: "new-slug" });
      const handler = new SlackArchiveHandler(vi.fn(), onArchive, () => true);
      const app = createMockApp();
      handler.register(app as any);

      const ack = vi.fn();
      const respond = vi.fn().mockResolvedValue({});

      await app._triggerAction("archive:confirm", {
        ack,
        action: { value: "sess-1" },
        respond,
      });

      expect(ack).toHaveBeenCalled();
      expect(onArchive).toHaveBeenCalledWith("sess-1");
    });

    it("shows error when archive fails", async () => {
      const onArchive = vi.fn().mockResolvedValue({ ok: false, error: "Session not found" });
      const handler = new SlackArchiveHandler(vi.fn(), onArchive, () => true);
      const app = createMockApp();
      handler.register(app as any);

      const ack = vi.fn();
      const respond = vi.fn().mockResolvedValue({});

      await app._triggerAction("archive:confirm", {
        ack,
        action: { value: "sess-bad" },
        respond,
      });

      expect(respond).toHaveBeenCalledWith(
        expect.objectContaining({ text: expect.stringContaining("Session not found") }),
      );
    });

    it("replaces ephemeral with Cancelled on cancel", async () => {
      const handler = new SlackArchiveHandler(vi.fn(), vi.fn(), () => true);
      const app = createMockApp();
      handler.register(app as any);

      const ack = vi.fn();
      const respond = vi.fn().mockResolvedValue({});

      await app._triggerAction("archive:cancel", { ack, respond });

      expect(ack).toHaveBeenCalled();
      expect(respond).toHaveBeenCalledWith({ text: "Cancelled.", replace_original: true });
    });
  });
});
```

- [ ] **Step 2: Run test to see it fail (module not found)**

Run: `pnpm test -- --run src/adapters/slack/archive-handler.test.ts`
Expected: FAIL — `Cannot find module './archive-handler.js'`

- [ ] **Step 3: Implement `SlackArchiveHandler`**

Create `src/adapters/slack/archive-handler.ts`:

```typescript
// src/adapters/slack/archive-handler.ts
import type { App } from "@slack/bolt";
import type { SessionLookup } from "./event-router.js";
import { createChildLogger } from "../../core/log.js";
const log = createChildLogger({ module: "slack-archive-handler" });

export type ArchiveSessionCallback = (
  sessionId: string,
) => Promise<{ ok: boolean; newThreadId?: string; error?: string }>;

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
    // /openacp-archive slash command
    app.command("/openacp-archive", async ({ command, ack, client }) => {
      await ack();

      if (!this.isAllowedUser(command.user_id)) {
        return;
      }

      const meta = this.sessionLookup(command.channel_id);
      if (!meta) {
        await client.chat.postEphemeral({
          channel: command.channel_id,
          user: command.user_id,
          text: "No active session in this channel.",
        });
        return;
      }

      await client.chat.postEphemeral({
        channel: command.channel_id,
        user: command.user_id,
        text: "Archive this channel and start a fresh one? Agent context will be preserved.",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: "Archive this channel and start a fresh one? Agent context will be preserved.",
            },
          },
          {
            type: "actions",
            elements: [
              {
                type: "button",
                text: { type: "plain_text", text: "Archive & start fresh" },
                action_id: "archive:confirm",
                value: meta.sessionId,
                style: "primary",
              },
              {
                type: "button",
                text: { type: "plain_text", text: "Cancel" },
                action_id: "archive:cancel",
              },
            ],
          },
        ],
      });
    });

    // Confirm button
    app.action("archive:confirm", async ({ ack, action, respond }) => {
      await ack();
      const sessionId = (action as any).value;
      if (!sessionId) {
        await respond({ text: "Archive not available.", replace_original: true });
        return;
      }
      await respond({ text: "⏳ Archiving session...", replace_original: true });
      try {
        const result = await this.onArchive(sessionId);
        if (result.ok) {
          log.info({ sessionId }, "Archive confirmed and completed");
        } else {
          await respond({
            text: `❌ Archive failed: ${result.error}`,
            replace_original: true,
          });
        }
      } catch (err) {
        await respond({
          text: `❌ Archive failed: ${(err as Error).message}`,
          replace_original: true,
        });
      }
    });

    // Cancel button
    app.action("archive:cancel", async ({ ack, respond }) => {
      await ack();
      await respond({ text: "Cancelled.", replace_original: true });
    });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test -- --run src/adapters/slack/archive-handler.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Run build**

Run: `pnpm build`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/adapters/slack/archive-handler.ts src/adapters/slack/archive-handler.test.ts
git commit -m "feat(slack): add SlackArchiveHandler for /openacp-archive command"
```

---

### Task 3: Add archiving guard in `sendMessage()` and implement `archiveSessionTopic()`

**Files:**
- Modify: `src/adapters/slack/adapter.ts`
- Create: `src/adapters/slack/archive.test.ts`

- [ ] **Step 1: Write tests for archiveSessionTopic logic**

Create `src/adapters/slack/archive.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

describe("archiveSessionTopic logic", () => {
  it("archives old channel and creates new one via channelManager", async () => {
    const mockArchive = vi.fn().mockResolvedValue(undefined);
    const mockCreate = vi.fn().mockResolvedValue({
      sessionId: "sess-1",
      channelId: "C_NEW",
      channelSlug: "openacp-new-slug",
    });

    const oldChannelId = "C_OLD";
    await mockArchive(oldChannelId);
    const newMeta = await mockCreate("sess-1", "Test Session");

    expect(mockArchive).toHaveBeenCalledWith("C_OLD");
    expect(mockCreate).toHaveBeenCalledWith("sess-1", "Test Session");
    expect(newMeta.channelId).toBe("C_NEW");
    expect(newMeta.channelSlug).toBe("openacp-new-slug");
  });

  it("replaces sessions Map entry so sessionLookup finds new channel", () => {
    const sessions = new Map<string, { sessionId: string; channelId: string; channelSlug: string }>();
    sessions.set("sess-1", { sessionId: "sess-1", channelId: "C_OLD", channelSlug: "openacp-old" });

    // Simulate rewire
    const newMeta = { sessionId: "sess-1", channelId: "C_NEW", channelSlug: "openacp-new" };
    sessions.set("sess-1", newMeta);

    // Old channelId no longer found
    const lookupOld = [...sessions.values()].find(m => m.channelId === "C_OLD");
    expect(lookupOld).toBeUndefined();

    // New channelId found
    const lookupNew = [...sessions.values()].find(m => m.channelId === "C_NEW");
    expect(lookupNew?.sessionId).toBe("sess-1");
  });

  it("returns null when session.archiving is already true (double-archive guard)", () => {
    const session = { archiving: true };
    const result = session.archiving ? null : "would-proceed";
    expect(result).toBeNull();
  });

  it("resets archiving flag when new channel creation fails", async () => {
    const session = { archiving: false };
    session.archiving = true;

    // Simulate creation failure
    try {
      throw new Error("name_taken");
    } catch {
      session.archiving = false;
    }

    expect(session.archiving).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm test -- --run src/adapters/slack/archive.test.ts`
Expected: All PASS

- [ ] **Step 3: Add archiving guard to `sendMessage()`**

In `src/adapters/slack/adapter.ts`, at the top of `sendMessage()` (line 349):

```typescript
async sendMessage(sessionId: string, content: OutgoingMessage): Promise<void> {
  // Skip outgoing messages while session is being archived (channel migration)
  const session = this.core.sessionManager.getSession(sessionId);
  if (session?.archiving) return;

  const meta = this.sessions.get(sessionId);
  // ... rest of existing code unchanged
```

- [ ] **Step 4: Implement `archiveSessionTopic()` in SlackAdapter**

Add after `deleteSessionThread()` (around line 338):

```typescript
async archiveSessionTopic(sessionId: string): Promise<{ newThreadId: string } | null> {
  const session = this.core.sessionManager.getSession(sessionId);
  if (!session) return null;
  if (session.archiving) return null;

  const meta = this.sessions.get(sessionId);
  if (!meta) return null;

  const rawName = (session.name || `Session ${session.id.slice(0, 6)}`).replace(/^🔄\s*/, "");

  // 1. Block outgoing messages
  session.archiving = true;

  // 2. Flush pending text buffer
  const buf = this.textBuffers.get(sessionId);
  if (buf) {
    try { await buf.flush(); } catch { /* best effort */ }
    buf.destroy();
    this.textBuffers.delete(sessionId);
  }

  // 3. Cleanup permission buttons for old channel
  try {
    await this.permissionHandler.cleanupSession(meta.channelId);
  } catch (err) {
    log.warn({ err, sessionId }, "Failed to cleanup permissions during archive");
  }

  // 4. Archive old channel
  try {
    await this.channelManager.archiveChannel(meta.channelId);
  } catch (err) {
    log.warn({ err, sessionId }, "Failed to archive old channel");
  }

  // 5. Create new channel
  let newMeta: SlackSessionMeta;
  try {
    newMeta = await this.channelManager.createChannel(sessionId, `🔄 ${rawName}`);
  } catch (createErr) {
    session.archiving = false;
    this.core.notificationManager.notifyAll({
      sessionId: session.id,
      sessionName: session.name,
      type: "error",
      summary: `Channel recreation failed for session "${rawName}". Session is orphaned. Error: ${(createErr as Error).message}`,
    });
    throw createErr;
  }

  // 6. Rewire session to new channel
  session.threadId = newMeta.channelSlug;
  this.sessions.set(sessionId, newMeta);

  // 7. Persist new topicId
  const existingRecord = this.core.sessionManager.getSessionRecord(sessionId);
  const existingPlatform = { ...(existingRecord?.platform ?? {}) };
  await this.core.sessionManager.patchRecord(sessionId, {
    platform: { ...existingPlatform, topicId: newMeta.channelSlug },
  });

  // 8. Clear archiving flag
  session.archiving = false;

  log.info({ sessionId, oldChannelId: meta.channelId, newChannelId: newMeta.channelId }, "Session channel archived and recreated");
  return { newThreadId: newMeta.channelSlug };
}
```

- [ ] **Step 5: Run build and tests**

Run: `pnpm build && pnpm test -- --run src/adapters/slack/`
Expected: Build succeeds, all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/adapters/slack/adapter.ts src/adapters/slack/archive.test.ts
git commit -m "feat(slack): implement archiveSessionTopic and sendMessage archiving guard"
```

---

### Task 4: Wire `SlackArchiveHandler` in adapter `start()`

**Files:**
- Modify: `src/adapters/slack/adapter.ts`

- [ ] **Step 1: Import `SlackArchiveHandler`**

At the top of `src/adapters/slack/adapter.ts`:

```typescript
import { SlackArchiveHandler } from "./archive-handler.js";
```

- [ ] **Step 2: Add private field**

In the `SlackAdapter` class fields (around line 36):

```typescript
private archiveHandler!: SlackArchiveHandler;
```

- [ ] **Step 3: Create and register in `start()`**

After `this.permissionHandler.register(this.app)` (line 92), add:

```typescript
// Archive handler — /openacp-archive slash command + buttons
this.archiveHandler = new SlackArchiveHandler(
  (slackChannelId) => {
    for (const meta of this.sessions.values()) {
      if (meta.channelId === slackChannelId) return meta;
    }
    return undefined;
  },
  async (sessionId) => {
    const result = await this.core.archiveSession(sessionId);
    return result.ok
      ? { ok: true, newThreadId: result.newThreadId }
      : { ok: false, error: result.error };
  },
  (userId) => {
    const slackAllowed = this.slackConfig.allowedUserIds ?? [];
    const globalAllowed = this.core.configManager.get().security.allowedUserIds;
    const allowed = slackAllowed.length > 0 ? slackAllowed : globalAllowed;
    if (allowed.length === 0) return true;
    return allowed.includes(userId);
  },
);
this.archiveHandler.register(this.app);
```

- [ ] **Step 4: Run build and tests**

Run: `pnpm build && pnpm test -- --run src/adapters/slack/`
Expected: Build succeeds, all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/adapters/slack/adapter.ts
git commit -m "feat(slack): wire SlackArchiveHandler in adapter start()"
```

---

### Task 5: Final integration verification

**Files:** All modified files

- [ ] **Step 1: Run full build**

Run: `pnpm build`
Expected: Clean build, no errors

- [ ] **Step 2: Run all Slack adapter tests**

Run: `pnpm test -- --run src/adapters/slack/`
Expected: All tests pass

- [ ] **Step 3: Run full test suite**

Run: `pnpm test -- --run`
Expected: All tests pass, no regressions

- [ ] **Step 4: Final commit (if fixups needed)**

```bash
git add -A
git commit -m "fix(slack): resolve integration issues from archive feature"
```
