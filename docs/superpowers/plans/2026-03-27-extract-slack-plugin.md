# Extract Slack Adapter to Plugin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the Slack adapter from OpenACP core into the standalone `slack-plugin` repo as an AdapterFactory plugin.

**Architecture:** The Slack adapter code moves from `OpenACP/src/adapters/slack/` to the `slack-plugin` repo. All `../../core/...` imports are rewritten to `@openacp/cli`. The plugin exports an `adapterFactory` conforming to the `AdapterFactory` interface from `plugin-manager.ts`. Core's `main.ts` drops the hard-coded Slack branch and adds a migration message for legacy configs.

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest, @slack/bolt, @slack/web-api, p-queue, nanoid, zod

## Repo Map

| Repo | Absolute Path | Role |
|------|--------------|------|
| **OpenACP** (core) | `/Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/OpenACP` | Remove Slack code + add migration msg |
| **slack-plugin** | `/Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin` | New plugin repo (receives Slack code) |
| **plugin-registry** | `/Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/plugin-registry` | Add manifest JSON |

## Execution Order

**Part A** (Tasks 1-6): All work in `slack-plugin` repo — scaffold, create source files, tests
**Part B** (Task 7): All work in `OpenACP` repo — remove Slack, add migration message
**Part C** (Task 8): All work in `plugin-registry` repo — add manifest
**Part D** (Task 9): Cross-repo verification

> **CRITICAL for agents:** Each task specifies its **Repo** at the top. Always `cd` into the correct repo before executing any command. Never mix repos within a task.

## Context Documents Per Repo

| Repo | Context Doc |
|------|-------------|
| **slack-plugin** | `slack-plugin/docs/superpowers/specs/2026-03-27-slack-plugin-context.md` — Full module map, import rewrites, config schema, type dependencies |
| **OpenACP** | `OpenACP/docs/superpowers/specs/2026-03-27-extract-slack-plugin-design.md` — Original design spec |

Agents dispatched to a specific repo should read that repo's context doc first.

---

## File Structure

### New files in `slack-plugin/`

| File | Responsibility |
|------|---------------|
| `package.json` | npm metadata, deps, scripts |
| `tsconfig.json` | TypeScript config (ESM, NodeNext) |
| `.gitignore` | dist/, node_modules/ |
| `README.md` | Plugin usage instructions |
| `src/index.ts` | `adapterFactory` export (plugin entry) |
| `src/types.ts` | `SlackChannelConfig` (Zod schema), `SlackSessionMeta`, `SlackFileInfo` |
| `src/adapter.ts` | `SlackAdapter` class (from core, imports rewritten) |
| `src/event-router.ts` | `SlackEventRouter` (from core, imports rewritten) |
| `src/channel-manager.ts` | `SlackChannelManager` (from core, no core imports) |
| `src/permission-handler.ts` | `SlackPermissionHandler` (from core, no core imports) |
| `src/formatter.ts` | `SlackFormatter` + `markdownToMrkdwn` (from core, imports rewritten) |
| `src/text-buffer.ts` | `SlackTextBuffer` (from core, imports rewritten) |
| `src/send-queue.ts` | `SlackSendQueue` (from core, no core imports) |
| `src/slug.ts` | `toSlug` (from core, no core imports) |
| `src/utils.ts` | `isAudioClip`, `splitSafe` (from core, no core imports) |
| `src/__tests__/*.test.ts` | All 9 test files (from core, relative imports only) |

### Modified files in `OpenACP/`

| File | Change |
|------|--------|
| `src/main.ts` | Remove Slack hard-coded block, add migration message |
| `src/core/config.ts` | Remove `SlackChannelConfigSchema` + `SlackChannelConfig` type + `slack:` key from `ConfigSchema.channels` + Slack env overrides |

### Deleted from `OpenACP/`

| Path | What |
|------|------|
| `src/adapters/slack/` | Entire directory (11 source + 9 test files) |

### New file in `plugin-registry/`

| File | What |
|------|------|
| `plugins/openacp--adapter-slack.json` | Plugin manifest (prep, not submitted upstream yet) |

---

---

# Part A: slack-plugin repo

> **Repo:** `/Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin`

## Task 1: Scaffold slack-plugin repo

**Files:**
- Create: `slack-plugin/package.json`
- Create: `slack-plugin/tsconfig.json`
- Create: `slack-plugin/.gitignore`
- Create: `slack-plugin/README.md`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@openacp/adapter-slack",
  "version": "0.1.0",
  "description": "Slack messaging platform adapter plugin for OpenACP",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepublishOnly": "npm run build"
  },
  "keywords": ["openacp", "openacp-plugin", "slack", "adapter"],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/EthanMiller0x/slack-plugin"
  },
  "peerDependencies": {
    "@openacp/cli": ">=0.6.0"
  },
  "dependencies": {
    "@slack/bolt": "^4.6.0",
    "@slack/web-api": "^7.15.0",
    "nanoid": "^5.0.0",
    "p-queue": "^9.1.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@openacp/cli": "file:../OpenACP",
    "typescript": "^5.4.0",
    "vitest": "^3.0.0"
  }
}
```

Note: `@openacp/cli` in devDeps uses `file:../OpenACP` for local development. Change to a version number before npm publish.

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"],
  "exclude": ["src/__tests__"]
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
*.tsbuildinfo
.DS_Store
```

- [ ] **Step 4: Create `README.md`**

```markdown
# @openacp/adapter-slack

Slack messaging platform adapter plugin for [OpenACP](https://github.com/Open-ACP/OpenACP).

## Installation

```bash
openacp plugin install @openacp/adapter-slack
```

## Configuration

Add to your `~/.openacp/config.json`:

```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "adapter": "@openacp/adapter-slack",
      "botToken": "xoxb-...",
      "appToken": "xapp-...",
      "signingSecret": "...",
      "channelPrefix": "openacp",
      "notificationChannelId": "C...",
      "allowedUserIds": [],
      "autoCreateSession": true
    }
  }
}
```

## Development

```bash
npm install
npm run build
npm test

# Install locally for testing
openacp plugin install /path/to/slack-plugin
```

## License

MIT
```

- [ ] **Step 5: Install dependencies**

Run: `cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin && npm install`
Expected: `node_modules/` created, no errors

- [ ] **Step 6: Commit scaffold**

```bash
cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin
git add package.json tsconfig.json .gitignore README.md package-lock.json
git commit -m "chore: scaffold plugin package with deps and config"
```

---

## Task 2: Create types.ts with SlackChannelConfig

**Files:**
- Create: `slack-plugin/src/types.ts`

The core currently defines `SlackChannelConfig` via a Zod schema in `config.ts` and the Slack `types.ts` re-exports it. In the plugin, we define the Zod schema and types directly.

- [ ] **Step 1: Create `src/types.ts`**

```typescript
// src/types.ts
import { z } from "zod";

export const SlackChannelConfigSchema = z.object({
  enabled: z.boolean().default(false),
  adapter: z.string().optional(),
  botToken: z.string().optional(),
  appToken: z.string().optional(),
  signingSecret: z.string().optional(),
  notificationChannelId: z.string().optional(),
  allowedUserIds: z.array(z.string()).default([]),
  channelPrefix: z.string().default("openacp"),
  autoCreateSession: z.boolean().default(true),
  startupChannelId: z.string().optional(),
});

export type SlackChannelConfig = z.infer<typeof SlackChannelConfigSchema>;

/** Per-session metadata stored in SessionRecord.platform */
export interface SlackSessionMeta {
  channelId: string;
  channelSlug: string;
}

/** Minimal file metadata extracted from Slack message events (subtype: file_share) */
export interface SlackFileInfo {
  id: string;
  name: string;
  mimetype: string;
  size: number;
  url_private: string;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin && npx tsc --noEmit src/types.ts`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin
git add src/types.ts
git commit -m "feat: add SlackChannelConfig schema and types"
```

---

## Task 3: Copy utility modules (no core imports)

**Files:**
- Create: `slack-plugin/src/slug.ts`
- Create: `slack-plugin/src/utils.ts`
- Create: `slack-plugin/src/send-queue.ts`

These three files have NO imports from `../../core/...` — they only use external packages and local types. Copy them as-is with minor path adjustments.

- [ ] **Step 1: Create `src/slug.ts`**

Copy verbatim from `OpenACP/src/adapters/slack/slug.ts` (no changes needed — only imports `nanoid`):

```typescript
// src/slug.ts
import { customAlphabet } from "nanoid";

const nanoidAlpha = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 4);

/**
 * Convert a human-readable session name to a valid Slack channel name.
 * Rules: lowercase, ≤80 chars, only [a-z0-9-], unique suffix appended.
 *
 * Examples:
 *   "Fix authentication bug"            → "openacp-fix-authentication-bug-a3k9"
 *   "New Session"                       → "openacp-new-session-x7p2"
 *   "Implement OAuth 2.0 & JWT refresh" → "openacp-implement-oauth-20-jwt-refresh-b8qr"
 */
export function toSlug(name: string, prefix = "openacp"): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);

  const suffix = nanoidAlpha();
  return `${prefix}-${base}-${suffix}`.replace(/-+/g, "-");
}
```

- [ ] **Step 2: Create `src/utils.ts`**

Copy verbatim from `OpenACP/src/adapters/slack/utils.ts` (no core imports — only imports local `SlackFileInfo`):

```typescript
// src/utils.ts
import type { SlackFileInfo } from "./types.js";

/** Detect Slack audio clips — MIME type or filename pattern */
export function isAudioClip(file: SlackFileInfo): boolean {
  return (file.mimetype === "video/mp4" && file.name?.startsWith("audio_message")) ||
         file.mimetype?.startsWith("audio/");
}

const SECTION_LIMIT = 3000;

/**
 * Split text at nearest newline boundary before `limit`.
 * Does NOT track code fence state — a triple-backtick block straddling
 * the boundary will be split mid-block.
 * Used by SlackFormatter and SlackTextBuffer to avoid exceeding Slack's
 * 3000-char section limit.
 */
export function splitSafe(text: string, limit = SECTION_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= limit) { chunks.push(remaining); break; }
    let cut = remaining.lastIndexOf("\n", limit);
    if (cut <= 0) cut = limit;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  return chunks;
}
```

- [ ] **Step 3: Create `src/send-queue.ts`**

Copy verbatim from `OpenACP/src/adapters/slack/send-queue.ts` (no core imports — only `p-queue` and `@slack/web-api`):

```typescript
import PQueue from "p-queue";
import type { WebClient } from "@slack/web-api";

export type SlackMethod =
  | "chat.postMessage"
  | "chat.update"
  | "conversations.create"
  | "conversations.rename"
  | "conversations.archive"
  | "conversations.invite"
  | "conversations.join"
  | "conversations.unarchive"
  | "conversations.info";

const METHOD_RPM: Record<SlackMethod, number> = {
  "chat.postMessage":      50,
  "chat.update":           50,
  "conversations.create":  20,
  "conversations.rename":  20,
  "conversations.archive": 20,
  "conversations.invite":  20,
  "conversations.join":    20,
  "conversations.unarchive": 20,
  "conversations.info":      50,
};

export interface ISlackSendQueue {
  enqueue<T = unknown>(method: SlackMethod, params: Record<string, unknown>): Promise<T>;
}

export class SlackSendQueue implements ISlackSendQueue {
  private queues = new Map<SlackMethod, PQueue>();

  constructor(private client: WebClient) {
    for (const [method, rpm] of Object.entries(METHOD_RPM) as [SlackMethod, number][]) {
      this.queues.set(method, new PQueue({
        interval: Math.ceil(60_000 / rpm),
        intervalCap: 1,
        carryoverConcurrencyCount: true,
      }));
    }
  }

  async enqueue<T = unknown>(method: SlackMethod, params: Record<string, unknown>): Promise<T> {
    const queue = this.queues.get(method);
    if (!queue) throw new Error(`Unknown Slack method: ${method}`);
    return queue.add(() => this.client.apiCall(method, params) as Promise<T>);
  }
}
```

- [ ] **Step 4: Verify compilation**

Run: `cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin && npx tsc --noEmit`
Expected: No errors (these files have no core dependency)

- [ ] **Step 5: Commit**

```bash
cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin
git add src/slug.ts src/utils.ts src/send-queue.ts
git commit -m "feat: add utility modules (slug, utils, send-queue)"
```

---

## Task 4: Copy modules with core imports (rewrite to @openacp/cli)

**Files:**
- Create: `slack-plugin/src/formatter.ts`
- Create: `slack-plugin/src/text-buffer.ts`
- Create: `slack-plugin/src/channel-manager.ts`
- Create: `slack-plugin/src/permission-handler.ts`
- Create: `slack-plugin/src/event-router.ts`

These files import from `../../core/...`. Each import must be rewritten to `@openacp/cli`.

- [ ] **Step 1: Create `src/formatter.ts`**

Copy from `OpenACP/src/adapters/slack/formatter.ts`. Change one import:
- `from "../../core/types.js"` → `from "@openacp/cli"`

```typescript
// src/formatter.ts
import type { types } from "@slack/bolt";
import type { OutgoingMessage, PermissionRequest } from "@openacp/cli";
import { splitSafe } from "./utils.js";

type KnownBlock = types.KnownBlock;

export interface ISlackFormatter {
  formatOutgoing(message: OutgoingMessage): KnownBlock[];
  formatPermissionRequest(req: PermissionRequest): KnownBlock[];
  formatNotification(text: string): KnownBlock[];
  formatSessionEnd(reason?: string): KnownBlock[];
}

/**
 * Convert a markdown string to Slack mrkdwn format.
 * Handles the most common patterns from AI responses.
 */
export function markdownToMrkdwn(text: string): string {
  return text
    .replace(/^#{1,6}\s+(.+)$/gm, "\x00BOLD\x00$1\x00BOLD\x00")
    .replace(/\*\*(.+?)\*\*/g, "\x00BOLD\x00$1\x00BOLD\x00")
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "_$1_")
    .replace(/\x00BOLD\x00(.+?)\x00BOLD\x00/g, "*$1*")
    .replace(/~~(.+?)~~/g, "~$1~")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "<$2|$1>")
    .replace(/^[ \t]*[-*]\s+/gm, "• ")
    .trim();
}

const SECTION_LIMIT = 3000;

function section(text: string): KnownBlock {
  return { type: "section", text: { type: "mrkdwn", text: text.slice(0, SECTION_LIMIT) } };
}

function context(text: string): KnownBlock {
  return { type: "context", elements: [{ type: "mrkdwn", text }] };
}

export class SlackFormatter implements ISlackFormatter {
  formatOutgoing(message: OutgoingMessage): KnownBlock[] {
    switch (message.type) {
      case "text": {
        const text = message.text ?? "";
        if (!text.trim()) return [];
        const converted = markdownToMrkdwn(text);
        return splitSafe(converted).map(chunk => section(chunk));
      }

      case "thought":
        return [context(`💭 _${(message.text ?? "").slice(0, 500)}_`)];

      case "tool_call": {
        const name = (message as OutgoingMessage & { metadata?: { name?: string; input?: unknown } }).metadata?.name ?? "tool";
        const input = (message as OutgoingMessage & { metadata?: { input?: unknown } }).metadata?.input;
        const inputStr = input ? `\n\`\`\`\n${JSON.stringify(input, null, 2).slice(0, 500)}\n\`\`\`` : "";
        return [context(`🔧 \`${name}\`${inputStr}`)];
      }

      case "tool_update": {
        const name = (message as OutgoingMessage & { metadata?: { name?: string; status?: string } }).metadata?.name ?? "tool";
        const status = (message as OutgoingMessage & { metadata?: { status?: string } }).metadata?.status ?? "done";
        const icon = status === "error" ? "❌" : "✅";
        return [context(`${icon} \`${name}\` — ${status}`)];
      }

      case "plan":
        return [
          { type: "divider" },
          section(`📋 *Plan*\n${message.text ?? ""}`),
        ];

      case "usage": {
        const meta = (message as OutgoingMessage & { metadata?: { input_tokens?: number; output_tokens?: number; cost_usd?: number } }).metadata ?? {};
        const parts = [
          meta.input_tokens != null ? `in: ${meta.input_tokens}` : null,
          meta.output_tokens != null ? `out: ${meta.output_tokens}` : null,
          meta.cost_usd != null ? `$${Number(meta.cost_usd).toFixed(4)}` : null,
        ].filter((p): p is string => p !== null);
        return parts.length ? [context(`📊 ${parts.join(" · ")}`)] : [];
      }

      case "session_end":
        return this.formatSessionEnd(message.text);

      case "error":
        return [section(`⚠️ *Error:* ${message.text ?? "Unknown error"}`)];

      default:
        return [];
    }
  }

  formatPermissionRequest(req: PermissionRequest): KnownBlock[] {
    return [
      section(`🔐 *Permission Request*\n${req.description}`),
      {
        type: "actions",
        block_id: `perm_${req.id}`,
        elements: req.options.map(opt => ({
          type: "button" as const,
          text: { type: "plain_text" as const, text: opt.label, emoji: true },
          value: `${req.id}:${opt.id}`,
          action_id: `perm_action_${opt.id}_${req.id}`,
          style: (opt.isAllow ? "primary" : "danger") as "primary" | "danger",
        })),
      } as KnownBlock,
    ];
  }

  formatNotification(text: string): KnownBlock[] {
    return [section(text)];
  }

  formatSessionEnd(reason?: string): KnownBlock[] {
    return [
      { type: "divider" },
      context(`✅ Session ended${reason ? ` — ${reason}` : ""}`),
    ];
  }
}
```

- [ ] **Step 2: Create `src/text-buffer.ts`**

Copy from `OpenACP/src/adapters/slack/text-buffer.ts`. Change one import:
- `from "../../core/log.js"` → `from "@openacp/cli"`

```typescript
// src/text-buffer.ts
import type { ISlackSendQueue } from "./send-queue.js";
import { markdownToMrkdwn } from "./formatter.js";
import { splitSafe } from "./utils.js";
import { createChildLogger } from "@openacp/cli";

const log = createChildLogger({ module: "slack-text-buffer" });

const FLUSH_IDLE_MS = 2000;

export class SlackTextBuffer {
  private buffer = "";
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushPromise: Promise<void> | undefined;
  private lastMessageTs: string | undefined;
  private lastPostedText: string | undefined;

  constructor(
    private channelId: string,
    private sessionId: string,
    private queue: ISlackSendQueue,
  ) {}

  append(text: string): void {
    if (!text) return;
    this.buffer += text;
    this.resetTimer();
  }

  private resetTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush().catch((err) => log.error({ err, sessionId: this.sessionId }, "Text buffer flush error"));
    }, FLUSH_IDLE_MS);
  }

  async flush(): Promise<void> {
    if (this.flushPromise) return this.flushPromise;
    const text = this.buffer.trim();
    if (!text) return;
    this.buffer = "";
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }

    this.flushPromise = (async () => {
      try {
        const converted = markdownToMrkdwn(text);
        const chunks = splitSafe(converted);
        for (const chunk of chunks) {
          if (!chunk.trim()) continue;
          const result = await this.queue.enqueue("chat.postMessage", {
            channel: this.channelId,
            text: chunk,
            blocks: [{ type: "section", text: { type: "mrkdwn", text: chunk } }],
          });
          this.lastMessageTs = (result as { ts?: string } | undefined)?.ts;
          this.lastPostedText = chunk;
        }
      } finally {
        this.flushPromise = undefined;
        if (this.buffer.trim()) {
          await this.flush();
        }
      }
    })();

    return this.flushPromise;
  }

  destroy(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    this.buffer = "";
  }

  async stripTtsBlock(): Promise<void> {
    if (/\[TTS\][\s\S]*?\[\/TTS\]/.test(this.buffer)) {
      this.buffer = this.buffer.replace(/\[TTS\][\s\S]*?\[\/TTS\]/g, "").replace(/\s{2,}/g, " ").trim();
      return;
    }

    if (this.lastMessageTs && this.lastPostedText && /\[TTS\][\s\S]*?\[\/TTS\]/.test(this.lastPostedText)) {
      const cleaned = this.lastPostedText.replace(/\[TTS\][\s\S]*?\[\/TTS\]/g, "").replace(/\s{2,}/g, " ").trim();
      if (cleaned) {
        await this.queue.enqueue("chat.update", {
          channel: this.channelId,
          ts: this.lastMessageTs,
          text: cleaned,
          blocks: [{ type: "section", text: { type: "mrkdwn", text: cleaned } }],
        });
      }
      this.lastPostedText = cleaned;
    }
  }
}
```

- [ ] **Step 3: Create `src/channel-manager.ts`**

Copy verbatim from `OpenACP/src/adapters/slack/channel-manager.ts` (no core imports — only local types):

```typescript
// src/channel-manager.ts
import type { ISlackSendQueue } from "./send-queue.js";
import { toSlug } from "./slug.js";
import type { SlackSessionMeta } from "./types.js";
import type { SlackChannelConfig } from "./types.js";

export interface ISlackChannelManager {
  createChannel(sessionId: string, sessionName: string): Promise<SlackSessionMeta>;
  archiveChannel(channelId: string): Promise<void>;
  notifyChannel(text: string): Promise<void>;
}

export class SlackChannelManager implements ISlackChannelManager {
  constructor(
    private queue: ISlackSendQueue,
    private config: SlackChannelConfig,
  ) {}

  async createChannel(sessionId: string, sessionName: string): Promise<SlackSessionMeta> {
    let lastError: unknown;

    for (let attempt = 0; attempt < 3; attempt++) {
      const finalSlug = toSlug(sessionName, this.config.channelPrefix ?? "openacp");

      try {
        const res = await this.queue.enqueue<{ channel: { id: string } }>(
          "conversations.create",
          { name: finalSlug, is_private: true },
        );
        const channelId = res.channel.id;

        const userIds = this.config.allowedUserIds ?? [];
        if (userIds.length > 0) {
          await this.queue.enqueue("conversations.invite", {
            channel: channelId,
            users: userIds.join(","),
          });
        }

        return { channelId, channelSlug: finalSlug };
      } catch (err: any) {
        if (err?.data?.error === "name_taken" && attempt < 2) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }

    throw lastError;
  }

  async archiveChannel(channelId: string): Promise<void> {
    await this.queue.enqueue("conversations.archive", { channel: channelId });
  }

  async notifyChannel(text: string): Promise<void> {
    if (this.config.notificationChannelId) {
      await this.queue.enqueue("chat.postMessage", {
        channel: this.config.notificationChannelId,
        text,
      });
    }
  }
}
```

- [ ] **Step 4: Create `src/permission-handler.ts`**

Copy verbatim from `OpenACP/src/adapters/slack/permission-handler.ts` (no core imports):

```typescript
import type { App, BlockAction, ButtonAction } from "@slack/bolt";
import type { ISlackSendQueue } from "./send-queue.js";

export type PermissionResponseCallback = (requestId: string, optionId: string) => void;

export interface ISlackPermissionHandler {
  register(app: App): void;
  trackPendingMessage(requestId: string, channelId: string, messageTs: string): void;
  cleanupSession(channelId: string): Promise<void>;
}

export class SlackPermissionHandler implements ISlackPermissionHandler {
  private pendingMessages = new Map<string, { channelId: string; messageTs: string }>();

  constructor(
    private queue: ISlackSendQueue,
    private onResponse: PermissionResponseCallback,
  ) {}

  trackPendingMessage(requestId: string, channelId: string, messageTs: string): void {
    this.pendingMessages.set(requestId, { channelId, messageTs });
  }

  async cleanupSession(channelId: string): Promise<void> {
    for (const [requestId, info] of this.pendingMessages) {
      if (info.channelId !== channelId) continue;
      await this.queue.enqueue("chat.update", {
        channel: info.channelId,
        ts: info.messageTs,
        blocks: [],
      });
      this.pendingMessages.delete(requestId);
    }
  }

  register(app: App): void {
    app.action<BlockAction<ButtonAction>>(
      /^perm_action_/,
      async ({ ack, body, action }) => {
        await ack();

        const value: string = action.value ?? "";
        const colonIdx = value.indexOf(":");
        if (colonIdx === -1) return;

        const requestId = value.slice(0, colonIdx);
        const optionId  = value.slice(colonIdx + 1);

        this.onResponse(requestId, optionId);

        this.pendingMessages.delete(requestId);

        const message = body.message;
        if (message) {
          await this.queue.enqueue("chat.update", {
            channel: body.channel?.id ?? "",
            ts: message.ts,
            text: `✅ Permission response: *${optionId}*`,
            blocks: [],
          });
        }
      }
    );
  }
}
```

- [ ] **Step 5: Create `src/event-router.ts`**

Copy from `OpenACP/src/adapters/slack/event-router.ts`. Change one import:
- `from "../../core/log.js"` → `from "@openacp/cli"`

```typescript
// src/event-router.ts
import type { App } from "@slack/bolt";
import type { SlackSessionMeta, SlackFileInfo } from "./types.js";
import type { SlackChannelConfig } from "./types.js";
import { createChildLogger } from "@openacp/cli";
const log = createChildLogger({ module: "slack-event-router" });

interface SlackMessageEvent {
  bot_id?: string;
  subtype?: string;
  channel: string;
  text?: string;
  user?: string;
  files?: Array<{
    id: string;
    name: string;
    mimetype: string;
    size: number;
    url_private: string;
  }>;
}

export type SessionLookup = (channelId: string) => SlackSessionMeta | undefined;
export type IncomingMessageCallback = (sessionId: string, text: string, userId: string, files?: SlackFileInfo[]) => void;
export type NewSessionCallback = (text: string, userId: string) => void;

export interface ISlackEventRouter {
  register(app: App): void;
}

export class SlackEventRouter implements ISlackEventRouter {
  constructor(
    private sessionLookup: SessionLookup,
    private onIncoming: IncomingMessageCallback,
    private botUserId: string,
    private notificationChannelId: string | undefined,
    private onNewSession: NewSessionCallback,
    private config: SlackChannelConfig,
    private globalAllowedUserIds: string[] = [],
  ) {}

  private isAllowedUser(userId: string): boolean {
    const slackAllowed = this.config.allowedUserIds ?? [];
    const allowed = slackAllowed.length > 0 ? slackAllowed : this.globalAllowedUserIds;
    if (allowed.length === 0) return true;
    return allowed.includes(userId);
  }

  register(app: App): void {
    app.message(async ({ message }) => {
      log.debug({ message }, "Slack raw message event");

      const msg = message as unknown as SlackMessageEvent;

      if (msg.bot_id) return;
      const subtype = msg.subtype;
      if (subtype && subtype !== "file_share") return;

      const channelId = msg.channel;
      const text: string = msg.text ?? "";
      const userId: string = msg.user ?? "";

      const files: SlackFileInfo[] | undefined = msg.files?.map((f) => ({
        id: f.id,
        name: f.name,
        mimetype: f.mimetype,
        size: f.size,
        url_private: f.url_private,
      }));

      log.debug({ channelId, userId, text }, "Slack message received");

      if (userId === this.botUserId) return;

      if (!this.isAllowedUser(userId)) {
        log.warn({ userId }, "slack: message from non-allowed user rejected");
        return;
      }

      const session = this.sessionLookup(channelId);
      if (session) {
        log.debug({ channelId, sessionSlug: session.channelSlug }, "Routing to session");
        this.onIncoming(session.channelSlug, text, userId, files);
        return;
      }

      log.debug({ channelId, notificationChannelId: this.notificationChannelId }, "No session found for channel");

      if (this.notificationChannelId && channelId === this.notificationChannelId) {
        this.onNewSession(text, userId);
        return;
      }
    });
  }
}
```

- [ ] **Step 6: Verify compilation**

Run: `cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin
git add src/formatter.ts src/text-buffer.ts src/channel-manager.ts src/permission-handler.ts src/event-router.ts
git commit -m "feat: add formatter, text-buffer, channel-manager, permission-handler, event-router"
```

---

## Task 5: Copy adapter.ts and create index.ts entry point

**Files:**
- Create: `slack-plugin/src/adapter.ts`
- Create: `slack-plugin/src/index.ts`

- [ ] **Step 1: Create `src/adapter.ts`**

Copy from `OpenACP/src/adapters/slack/adapter.ts`. Rewrite ALL core imports:
- `from "../../core/index.js"` → `from "@openacp/cli"`
- `from "../../core/types.js"` → `from "@openacp/cli"`
- `from "../../core/file-service.js"` → `from "@openacp/cli"`
- `from "../../core/log.js"` → `from "@openacp/cli"`

```typescript
// src/adapter.ts
import fs from "node:fs";
import { App } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import {
  ChannelAdapter,
  type ChannelConfig,
  type OpenACPCore,
  type OutgoingMessage,
  type PermissionRequest,
  type NotificationMessage,
  createChildLogger,
  type FileService,
} from "@openacp/cli";
import type { Attachment } from "@openacp/cli";

const log = createChildLogger({ module: "slack" });

import type { SlackChannelConfig } from "./types.js";
import type { SlackSessionMeta, SlackFileInfo } from "./types.js";
import { SlackSendQueue } from "./send-queue.js";
import { SlackFormatter } from "./formatter.js";
import { SlackChannelManager } from "./channel-manager.js";
import { SlackPermissionHandler } from "./permission-handler.js";
import { SlackEventRouter } from "./event-router.js";
import { SlackTextBuffer } from "./text-buffer.js";
import { toSlug } from "./slug.js";
import { isAudioClip } from "./utils.js";

export class SlackAdapter extends ChannelAdapter<OpenACPCore> {
  private app!: App;
  private webClient!: WebClient;
  private queue!: SlackSendQueue;
  private formatter: SlackFormatter;
  private channelManager!: SlackChannelManager;
  private permissionHandler!: SlackPermissionHandler;
  private eventRouter!: SlackEventRouter;
  private sessions = new Map<string, SlackSessionMeta>();
  private textBuffers = new Map<string, SlackTextBuffer>();
  private botUserId = "";
  private slackConfig: SlackChannelConfig;
  private fileService!: FileService;

  constructor(core: OpenACPCore, config: SlackChannelConfig) {
    super(core, config as unknown as ChannelConfig);
    this.slackConfig = config;
    this.formatter = new SlackFormatter();
  }

  async start(): Promise<void> {
    const { botToken, appToken, signingSecret } = this.slackConfig;

    if (!botToken || !appToken || !signingSecret) {
      throw new Error("Slack adapter requires botToken, appToken, and signingSecret");
    }

    this.app = new App({
      token: botToken,
      appToken,
      signingSecret,
      socketMode: true,
    });

    this.webClient = new WebClient(botToken);
    this.queue = new SlackSendQueue(this.webClient);
    this.fileService = this.core.fileService;

    const authResult = await this.webClient.auth.test();
    if (!authResult.user_id) {
      throw new Error("Slack auth.test() did not return user_id — verify botToken is valid");
    }
    this.botUserId = authResult.user_id as string;
    log.info({ botUserId: this.botUserId }, "Slack bot authenticated");

    this.channelManager = new SlackChannelManager(this.queue, this.slackConfig);

    this.permissionHandler = new SlackPermissionHandler(
      this.queue,
      (requestId, optionId) => {
        for (const [sessionId, _meta] of this.sessions) {
          const session = this.core.sessionManager.getSession(sessionId);
          if (session && session.permissionGate.requestId === requestId) {
            session.permissionGate.resolve(optionId);
            log.info({ sessionId, requestId, optionId }, "Permission resolved");
            return;
          }
        }
        log.warn({ requestId, optionId }, "No matching session found for permission response");
      },
    );
    this.permissionHandler.register(this.app);

    this.eventRouter = new SlackEventRouter(
      (slackChannelId) => {
        for (const meta of this.sessions.values()) {
          if (meta.channelId === slackChannelId) return meta;
        }
        return undefined;
      },
      (sessionChannelSlug, text, userId, files) => {
        const processFiles = async (): Promise<Attachment[] | undefined> => {
          if (!files?.length) return undefined;
          const audioFiles = files.filter((f) => isAudioClip(f));
          if (!audioFiles.length) return undefined;

          const attachments: Attachment[] = [];
          for (const file of audioFiles) {
            const buffer = await this.downloadSlackFile(file.url_private);
            if (!buffer) continue;
            const mimeType = file.mimetype === "video/mp4" ? "audio/mp4" : file.mimetype;
            const sessionId = this.core.sessionManager.getSessionByThread("slack", sessionChannelSlug)?.id;
            if (!sessionId) continue;
            const att = await this.fileService.saveFile(sessionId, file.name, buffer, mimeType);
            attachments.push(att);
          }
          return attachments.length > 0 ? attachments : undefined;
        };

        processFiles()
          .then((attachments) => {
            this.core
              .handleMessage({
                channelId: "slack",
                threadId: sessionChannelSlug,
                userId,
                text,
                attachments,
              })
              .catch((err) => log.error({ err }, "handleMessage error"));
          })
          .catch((err) => log.error({ err }, "Failed to process audio files"));
      },
      this.botUserId,
      this.slackConfig.notificationChannelId,
      async (_text, _userId) => {
        if (this.slackConfig.notificationChannelId) {
          await this.queue.enqueue("chat.postMessage", {
            channel: this.slackConfig.notificationChannelId,
            text: "💬 To start a new session, use the `/openacp-new` slash command in any channel.",
          }).catch((err: unknown) => log.warn({ err }, "Failed to send onNewSession reply"));
        }
      },
      this.slackConfig,
      this.core.configManager.get().security.allowedUserIds,
    );
    this.eventRouter.register(this.app);

    await this.app.start();
    log.info("Slack adapter started (Socket Mode)");

    if (this.slackConfig.autoCreateSession !== false) {
      await this._createStartupSession();
    }
  }

  private async downloadSlackFile(url: string): Promise<Buffer | null> {
    try {
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${this.slackConfig.botToken}` },
      });
      if (!resp.ok) {
        log.warn({ status: resp.status }, "Failed to download Slack file");
        return null;
      }
      const contentType = resp.headers.get("content-type") ?? "";
      if (contentType.includes("text/html")) {
        log.warn("Slack file download returned HTML instead of binary — bot likely missing files:read scope. Reinstall the Slack app with files:read scope.");
        return null;
      }
      return Buffer.from(await resp.arrayBuffer());
    } catch (err) {
      log.error({ err }, "Error downloading Slack file");
      return null;
    }
  }

  private async uploadAudioFile(channelId: string, att: Attachment): Promise<void> {
    const fileBuffer = await fs.promises.readFile(att.filePath);
    await this.webClient.files.uploadV2({
      channel_id: channelId,
      file: fileBuffer,
      filename: att.fileName,
    });
  }

  private async _createStartupSession(): Promise<void> {
    try {
      let reuseChannelId = this.slackConfig.startupChannelId;

      if (reuseChannelId) {
        try {
          const info = await this.queue.enqueue<Record<string, unknown>>(
            "conversations.info", { channel: reuseChannelId },
          );
          const channel = (info as Record<string, unknown>)?.channel as Record<string, unknown> | undefined;
          if (!channel || typeof channel.is_archived !== "boolean") {
            log.warn({ reuseChannelId }, "Unexpected conversations.info response shape, creating new channel");
            reuseChannelId = undefined;
          } else if (channel.is_archived) {
            await this.queue.enqueue("conversations.unarchive", { channel: reuseChannelId });
            log.info({ channelId: reuseChannelId }, "Unarchived startup channel for reuse");
          }
        } catch {
          reuseChannelId = undefined;
        }
      }

      if (reuseChannelId) {
        let hasSession = false;
        for (const m of this.sessions.values()) {
          if (m.channelId === reuseChannelId) { hasSession = true; break; }
        }
        if (!hasSession) {
          const session = await this.core.handleNewSession("slack", undefined, undefined, { createThread: false });
          const slug = `startup-${session.id.slice(0, 8)}`;
          this.sessions.set(session.id, { channelId: reuseChannelId, channelSlug: slug });
          session.threadId = slug;
          await this.core.sessionManager.patchRecord(session.id, {
            platform: { topicId: slug },
          });
          log.info({ sessionId: session.id, channelId: reuseChannelId }, "Reused startup channel");
        }
      } else {
        const session = await this.core.handleNewSession("slack", undefined, undefined, { createThread: true });
        if (!session.threadId) {
          log.error({ sessionId: session.id }, "Startup session created without threadId");
          return;
        }

        const meta = this.sessions.get(session.id);
        if (meta) {
          await this.core.configManager.save(
            { channels: { slack: { startupChannelId: meta.channelId } } },
          );
          log.info({ sessionId: session.id, channelId: meta.channelId }, "Saved startup channel to config");
        }
      }

      if (this.slackConfig.notificationChannelId) {
        const startupMeta = [...this.sessions.values()].find(m =>
          m.channelId === (reuseChannelId ?? this.slackConfig.startupChannelId)
        );
        if (startupMeta) {
          await this.queue.enqueue("chat.postMessage", {
            channel: this.slackConfig.notificationChannelId,
            text: `✅ OpenACP ready — chat with the agent in <#${startupMeta.channelId}>`,
          });
        }
      }
    } catch (err) {
      log.error({ err }, "Failed to create/reuse Slack startup session");
    }
  }

  async stop(): Promise<void> {
    for (const [sessionId, buf] of this.textBuffers) {
      try {
        await buf.flush();
      } catch (err) {
        log.warn({ err, sessionId }, "Flush failed during stop");
      }
      buf.destroy();
    }
    this.textBuffers.clear();
    await this.app.stop();
    log.info("Slack adapter stopped");
  }

  async createSessionThread(sessionId: string, name: string): Promise<string> {
    const meta = await this.channelManager.createChannel(sessionId, name);
    this.sessions.set(sessionId, meta);
    log.info({ sessionId, channelId: meta.channelId, slug: meta.channelSlug }, "Session channel created");
    return meta.channelSlug;
  }

  async renameSessionThread(sessionId: string, newName: string): Promise<void> {
    const meta = this.sessions.get(sessionId);
    if (!meta) return;

    const newSlug = toSlug(newName, this.slackConfig.channelPrefix ?? "openacp");

    try {
      await this.queue.enqueue("conversations.rename", {
        channel: meta.channelId,
        name: newSlug,
      });
      meta.channelSlug = newSlug;
      const session = this.core.sessionManager.getSession(sessionId);
      if (session) session.threadId = newSlug;
      const existingRecord = this.core.sessionManager.getSessionRecord(sessionId);
      await this.core.sessionManager.patchRecord(sessionId, {
        name: newName,
        platform: { ...(existingRecord?.platform ?? {}), topicId: newSlug },
      });
      log.info({ sessionId, newSlug }, "Session channel renamed");
    } catch (err) {
      log.warn({ err, sessionId }, "Failed to rename Slack channel");
    }
  }

  async deleteSessionThread(sessionId: string): Promise<void> {
    const meta = this.sessions.get(sessionId);
    if (!meta) return;

    try {
      await this.permissionHandler.cleanupSession(meta.channelId);
    } catch (err) {
      log.warn({ err, sessionId }, "Failed to clean up permission buttons");
    }

    try {
      await this.channelManager.archiveChannel(meta.channelId);
      log.info({ sessionId, channelId: meta.channelId }, "Session channel archived");
    } catch (err) {
      log.warn({ err, sessionId }, "Failed to archive Slack channel");
    }
    this.sessions.delete(sessionId);
    const buf = this.textBuffers.get(sessionId);
    if (buf) { buf.destroy(); this.textBuffers.delete(sessionId); }
  }

  private getTextBuffer(sessionId: string, channelId: string): SlackTextBuffer {
    let buf = this.textBuffers.get(sessionId);
    if (!buf) {
      buf = new SlackTextBuffer(channelId, sessionId, this.queue);
      this.textBuffers.set(sessionId, buf);
    }
    return buf;
  }

  async sendMessage(sessionId: string, content: OutgoingMessage): Promise<void> {
    const meta = this.sessions.get(sessionId);
    if (!meta) {
      log.warn({ sessionId }, "No Slack channel for session, skipping message");
      return;
    }

    if (content.type === "text") {
      const buf = this.getTextBuffer(sessionId, meta.channelId);
      buf.append(content.text ?? "");
      return;
    }

    if (content.type === "session_end" || content.type === "error") {
      const buf = this.textBuffers.get(sessionId);
      if (buf) {
        try {
          await buf.flush();
        } catch (err) {
          log.warn({ err, sessionId }, "Flush failed on session_end");
        }
        buf.destroy();
        this.textBuffers.delete(sessionId);
      }
    }

    if (content.type === "attachment" && content.attachment) {
      if (content.attachment.type === "audio") {
        try {
          await this.uploadAudioFile(meta.channelId, content.attachment);
          const buf = this.textBuffers.get(sessionId);
          if (buf) await buf.stripTtsBlock();
        } catch (err) {
          log.error({ err, sessionId }, "Failed to upload audio to Slack");
        }
      }
      return;
    }

    const blocks = this.formatter.formatOutgoing(content);
    if (blocks.length === 0) return;

    try {
      await this.queue.enqueue("chat.postMessage", {
        channel: meta.channelId,
        text: content.text ?? content.type,
        blocks,
      });
    } catch (err) {
      log.error({ err, sessionId, type: content.type }, "Failed to post Slack message");
    }
  }

  async sendPermissionRequest(
    sessionId: string,
    request: PermissionRequest,
  ): Promise<void> {
    const meta = this.sessions.get(sessionId);
    if (!meta) return;

    log.info({ sessionId, requestId: request.id }, "Sending Slack permission request");
    const blocks = this.formatter.formatPermissionRequest(request);

    try {
      const result = await this.queue.enqueue("chat.postMessage", {
        channel: meta.channelId,
        text: `Permission request: ${request.description}`,
        blocks,
      });
      const ts = (result as { ts?: string })?.ts;
      if (ts) {
        this.permissionHandler.trackPendingMessage(request.id, meta.channelId, ts);
      }
    } catch (err) {
      log.error({ err, sessionId }, "Failed to post Slack permission request");
    }
  }

  async sendNotification(notification: NotificationMessage): Promise<void> {
    if (!this.slackConfig.notificationChannelId) return;

    const emoji: Record<string, string> = {
      completed: "✅",
      error: "❌",
      permission: "🔐",
      input_required: "💬",
    };
    const icon = emoji[notification.type] ?? "ℹ️";
    const text = `${icon} *${notification.sessionName ?? "Session"}*\n${notification.summary}`;
    const blocks = this.formatter.formatNotification(text);

    try {
      await this.queue.enqueue("chat.postMessage", {
        channel: this.slackConfig.notificationChannelId,
        text,
        blocks,
      });
    } catch (err) {
      log.warn({ err, sessionId: notification.sessionId }, "Failed to send Slack notification");
    }
  }
}

export type { SlackChannelConfig } from "./types.js";
```

- [ ] **Step 2: Create `src/index.ts`**

```typescript
// src/index.ts
import type { AdapterFactory } from "@openacp/cli";
import { SlackAdapter } from "./adapter.js";
import type { SlackChannelConfig } from "./types.js";

export const adapterFactory: AdapterFactory = {
  name: "slack",
  createAdapter(core, config) {
    return new SlackAdapter(core, config as SlackChannelConfig);
  },
};

export { SlackAdapter } from "./adapter.js";
export type { SlackChannelConfig, SlackSessionMeta, SlackFileInfo } from "./types.js";
```

- [ ] **Step 3: Verify compilation**

Run: `cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Build the plugin**

Run: `cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin && npm run build`
Expected: `dist/` created with compiled JS and `.d.ts` files

- [ ] **Step 5: Commit**

```bash
cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin
git add src/adapter.ts src/index.ts
git commit -m "feat: add SlackAdapter and adapterFactory entry point"
```

---

## Task 6: Copy test files

**Files:**
- Create: `slack-plugin/src/__tests__/adapter-lifecycle.test.ts`
- Create: `slack-plugin/src/__tests__/channel-manager.test.ts`
- Create: `slack-plugin/src/__tests__/event-router.test.ts`
- Create: `slack-plugin/src/__tests__/formatter.test.ts`
- Create: `slack-plugin/src/__tests__/permission-handler.test.ts`
- Create: `slack-plugin/src/__tests__/send-queue.test.ts`
- Create: `slack-plugin/src/__tests__/slack-voice.test.ts`
- Create: `slack-plugin/src/__tests__/slug.test.ts`
- Create: `slack-plugin/src/__tests__/text-buffer.test.ts`

All test files use only relative imports (no `../../core/...` imports). The only change needed is adjusting import paths since tests move from `src/adapters/slack/` to `src/__tests__/`.

- [ ] **Step 1: Copy all 9 test files**

For each test file, copy from `OpenACP/src/adapters/slack/<name>.test.ts` to `slack-plugin/src/__tests__/<name>.test.ts`.

Update relative imports — in the original files, imports like `./text-buffer.js` referenced sibling files in the same directory. In `__tests__/`, they need to become `../text-buffer.js`:

- `from "./text-buffer.js"` → `from "../text-buffer.js"`
- `from "./event-router.js"` → `from "../event-router.js"`
- `from "./send-queue.js"` → `from "../send-queue.js"`
- `from "./channel-manager.js"` → `from "../channel-manager.js"`
- `from "./permission-handler.js"` → `from "../permission-handler.js"`
- `from "./formatter.js"` → `from "../formatter.js"`
- `from "./slug.js"` → `from "../slug.js"`
- `from "./utils.js"` → `from "../utils.js"`
- `from "./types.js"` → `from "../types.js"`

Files to copy (with the import path prefix changed from `./` to `../`):

1. `adapter-lifecycle.test.ts` — imports: `./text-buffer.js` → `../text-buffer.js`
2. `channel-manager.test.ts` — imports: `./channel-manager.js`, `./send-queue.js`, `./types.js` → `../` prefix
3. `event-router.test.ts` — imports: `./event-router.js`, `./types.js` → `../` prefix
4. `formatter.test.ts` — imports: `./formatter.js` → `../formatter.js`
5. `permission-handler.test.ts` — imports: `./permission-handler.js`, `./send-queue.js` → `../` prefix
6. `send-queue.test.ts` — imports: `./send-queue.js` → `../send-queue.js`
7. `slack-voice.test.ts` — imports: `./text-buffer.js`, `./send-queue.js`, `./utils.js` → `../` prefix
8. `slug.test.ts` — imports: `./slug.js` → `../slug.js`
9. `text-buffer.test.ts` — imports: `./text-buffer.js` → `../text-buffer.js`

- [ ] **Step 2: Run tests**

Run: `cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin && npm test`
Expected: All 9 test suites pass

- [ ] **Step 3: Commit**

```bash
cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin
git add src/__tests__/
git commit -m "test: copy all Slack adapter tests from core"
```

---

---

# Part B: OpenACP repo (core changes)

> **Repo:** `/Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/OpenACP`

## Task 7: Remove Slack from OpenACP core

**Files:**
- Modify: `OpenACP/src/main.ts:100-107`
- Modify: `OpenACP/src/core/config.ts:67-80,122,339-341`
- Delete: `OpenACP/src/adapters/slack/` (entire directory)

- [ ] **Step 1: Modify `src/main.ts`**

Replace the Slack hard-coded block (lines 103-107) with a migration message. The updated adapter registration loop should look like:

In `OpenACP/src/main.ts`, replace:
```typescript
    } else if (channelName === 'slack') {
      const { SlackAdapter } = await import('./adapters/slack/adapter.js')
      const slackConfig = channelConfig as import('./adapters/slack/types.js').SlackChannelConfig
      core.registerAdapter('slack', new SlackAdapter(core, slackConfig))
      log.info({ adapter: 'slack' }, 'Adapter registered')
    } else if (channelName === 'discord') {
```

with:

```typescript
    } else if (channelName === 'slack' && !channelConfig.adapter) {
      log.error(
        { adapter: 'slack' },
        'Slack adapter has been moved to a plugin. Install it with: openacp plugin install @openacp/adapter-slack — Then add "adapter": "@openacp/adapter-slack" to your slack channel config.'
      )
    } else if (channelName === 'discord') {
```

- [ ] **Step 2: Modify `src/core/config.ts`**

Remove these items:

a) Remove the `SlackChannelConfigSchema` definition (lines 67-78):

```typescript
const SlackChannelConfigSchema = z.object({
  enabled: z.boolean().default(false),
  adapter: z.literal("slack").optional(),
  botToken: z.string().optional(),
  appToken: z.string().optional(),
  signingSecret: z.string().optional(),
  notificationChannelId: z.string().optional(),
  allowedUserIds: z.array(z.string()).default([]),
  channelPrefix: z.string().default("openacp"),
  autoCreateSession: z.boolean().default(true),
  startupChannelId: z.string().optional(),
});
```

b) Remove the `SlackChannelConfig` type export (line 80):

```typescript
export type SlackChannelConfig = z.infer<typeof SlackChannelConfigSchema>;
```

c) In the `ConfigSchema.channels` object, remove the `slack:` key (line 122):

```typescript
      slack: SlackChannelConfigSchema.optional(),
```

After removal, the channels definition should look like:

```typescript
  channels: z
    .object({})
    .catchall(BaseChannelSchema),
```

(The `BaseChannelSchema` with `.passthrough()` will handle any Slack config transparently.)

d) Remove the Slack env overrides (lines 339-341):

```typescript
      ["OPENACP_SLACK_BOT_TOKEN", ["channels", "slack", "botToken"]],
      ["OPENACP_SLACK_APP_TOKEN", ["channels", "slack", "appToken"]],
      ["OPENACP_SLACK_SIGNING_SECRET", ["channels", "slack", "signingSecret"]],
```

- [ ] **Step 3: Delete `src/adapters/slack/` directory**

Run: `rm -rf /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/OpenACP/src/adapters/slack`

- [ ] **Step 4: Verify core still builds**

Run: `cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/OpenACP && pnpm build`
Expected: Build succeeds with no errors

- [ ] **Step 5: Verify core tests pass**

Run: `cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/OpenACP && pnpm test`
Expected: All tests pass (Slack tests are gone, no other test references Slack)

- [ ] **Step 6: Commit in OpenACP repo**

```bash
cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/OpenACP
git add -A src/adapters/slack
git add src/main.ts src/core/config.ts
git commit -m "refactor: extract Slack adapter to plugin, add migration message for legacy configs"
```

---

---

# Part C: plugin-registry repo

> **Repo:** `/Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/plugin-registry`

## Task 8: Create plugin-registry manifest

**Files:**
- Create: `plugin-registry/plugins/openacp--adapter-slack.json`

- [ ] **Step 1: Create manifest file**

```json
{
  "name": "adapter-slack",
  "displayName": "Slack Adapter",
  "description": "Slack messaging platform adapter for OpenACP",
  "npm": "@openacp/adapter-slack",
  "repository": "https://github.com/EthanMiller0x/slack-plugin",
  "author": {
    "name": "OpenACP",
    "github": "Open-ACP"
  },
  "version": "0.1.0",
  "minCliVersion": "0.6.10",
  "category": "adapter",
  "tags": ["slack", "messaging", "adapter"],
  "icon": "💬",
  "license": "MIT",
  "verified": true
}
```

- [ ] **Step 2: Commit in plugin-registry repo**

```bash
cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/plugin-registry
git add plugins/openacp--adapter-slack.json
git commit -m "feat: add Slack adapter plugin manifest (pending npm publish)"
```

---

---

# Part D: Cross-repo verification

## Task 9: Verify end-to-end

- [ ] **Step 1: Plugin builds clean**

Run: `cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin && npm run build`
Expected: No errors

- [ ] **Step 2: Plugin tests pass**

Run: `cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin && npm test`
Expected: All 9 test suites pass

- [ ] **Step 3: Core builds clean**

Run: `cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/OpenACP && pnpm build`
Expected: No errors

- [ ] **Step 4: Core tests pass**

Run: `cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/OpenACP && pnpm test`
Expected: All tests pass, no Slack-related failures

- [ ] **Step 5: Verify no stale Slack references in core**

Run: `grep -r "adapters/slack" /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/OpenACP/src/`
Expected: No matches (all Slack references removed)

Run: `grep -r "SlackAdapter\|SlackChannelConfig" /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/OpenACP/src/`
Expected: No matches (types fully removed from core)
