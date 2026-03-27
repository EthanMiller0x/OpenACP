# Plugin Setup Hooks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow adapter plugins to export an optional `setup()` wizard hook that core auto-discovers and shows in the channel configuration menu.

**Architecture:** Extend `AdapterFactory` with `displayName`, `method?`, and `setup?()`. Core's `configureChannels()` scans installed plugins at wizard time, merges them into the channel menu alongside built-in channels, and calls `factory.setup()` when selected. Setup helpers are exported from `@openacp/cli` so plugins can build consistent UIs. The Slack plugin ports `setupSlack()` from PR #67 and wires it into its `adapterFactory.setup()`.

**Tech Stack:** TypeScript (ESM, NodeNext), @clack/prompts, @slack/web-api, Vitest

## Repo Map

| Repo | Absolute Path | Role |
|------|--------------|------|
| **OpenACP** (core) | `/Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/OpenACP` | Extend AdapterFactory, update setup discovery, export helpers |
| **slack-plugin** | `/Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin` | Add setup.ts, wire into adapterFactory |

## Execution Order

**Part A** (Tasks 1-3): All work in `OpenACP` repo — extend interface, export helpers, update discovery
**Part B** (Tasks 4-5): All work in `slack-plugin` repo — create setup.ts, wire into index.ts
**Part C** (Task 6): Cross-repo verification

> **CRITICAL for agents:** Each task specifies its **Repo** at the top. Always `cd` into the correct repo before executing any command.

---

## File Structure

### Modified files in `OpenACP/`

| File | Change |
|------|--------|
| `src/core/plugin-manager.ts` | Add `displayName`, `method?`, `setup?()` to `AdapterFactory` |
| `src/index.ts` | Export setup helpers |
| `src/core/setup/setup-channels.ts` | Add plugin discovery + call `factory.setup()` |

### New/modified files in `slack-plugin/`

| File | Change |
|------|--------|
| `src/setup.ts` | **Create** — port setupSlack from PR #67 |
| `src/index.ts` | Add `displayName`, `method`, `setup()` to adapterFactory |
| `package.json` | Add `@clack/prompts` dependency |
| `src/__tests__/setup-slack.test.ts` | **Create** — tests for manifest + token validation |

---

# Part A: OpenACP repo (core changes)

> **Repo:** `/Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/OpenACP`

## Task 1: Extend AdapterFactory interface and export setup helpers

**Files:**
- Modify: `OpenACP/src/core/plugin-manager.ts:11-14`
- Modify: `OpenACP/src/index.ts`

- [ ] **Step 1: Extend `AdapterFactory` in `src/core/plugin-manager.ts`**

Replace lines 11-14:

```typescript
export interface AdapterFactory {
  name: string
  createAdapter(core: OpenACPCore, config: ChannelConfig): ChannelAdapter
}
```

with:

```typescript
export interface AdapterFactory {
  name: string
  displayName: string
  method?: string
  createAdapter(core: OpenACPCore, config: ChannelConfig): ChannelAdapter
  setup?(existing?: Record<string, unknown>): Promise<Record<string, unknown>>
}
```

- [ ] **Step 2: Export setup helpers from `src/index.ts`**

Add after the existing exports at the end of the file:

```typescript
// Setup helpers for adapter plugins
export { guardCancel, ok, fail, warn, step, dim, c } from './core/setup/helpers.js'
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/OpenACP && pnpm build`
Expected: Build succeeds. (The `displayName` field is required in the interface but existing plugin code hasn't been updated yet — that's OK because TypeScript only checks at compile time of the consumer, and we'll update the slack-plugin in Part B.)

- [ ] **Step 4: Verify tests**

Run: `cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/OpenACP && pnpm test`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/OpenACP
git add src/core/plugin-manager.ts src/index.ts
git commit -m "feat: extend AdapterFactory with setup hook, export setup helpers"
```

---

## Task 2: Add plugin discovery to configureChannels

**Files:**
- Modify: `OpenACP/src/core/setup/setup-channels.ts`

- [ ] **Step 1: Update imports**

In `src/core/setup/setup-channels.ts`, add the plugin imports. Replace the current import block:

```typescript
import * as clack from "@clack/prompts";
import type { Config } from "../config.js";
import type { ConfiguredChannelAction, ChannelId, ChannelStatus } from "./types.js";
import { CHANNEL_META } from "./types.js";
import { guardCancel, ok, c } from "./helpers.js";
import { setupTelegram } from "./setup-telegram.js";
import { setupDiscord } from "./setup-discord.js";
import type { DiscordChannelConfig } from "../../adapters/discord/types.js";
```

with:

```typescript
import * as clack from "@clack/prompts";
import type { Config } from "../config.js";
import type { ConfiguredChannelAction, ChannelId, ChannelStatus } from "./types.js";
import { CHANNEL_META } from "./types.js";
import { guardCancel, ok, c } from "./helpers.js";
import { setupTelegram } from "./setup-telegram.js";
import { setupDiscord } from "./setup-discord.js";
import type { DiscordChannelConfig } from "../../adapters/discord/types.js";
import { listPlugins, loadAdapterFactory, type AdapterFactory } from "../plugin-manager.js";
```

- [ ] **Step 2: Add plugin discovery helper**

Add after the imports, before `getChannelStatuses`:

```typescript
interface PluginChannelInfo {
  packageName: string;
  factory: AdapterFactory;
}

async function discoverPluginChannels(): Promise<PluginChannelInfo[]> {
  const plugins = listPlugins();
  const result: PluginChannelInfo[] = [];
  for (const packageName of Object.keys(plugins)) {
    const factory = await loadAdapterFactory(packageName);
    if (factory && typeof factory.setup === "function") {
      result.push({ packageName, factory });
    }
  }
  return result;
}
```

- [ ] **Step 3: Update `configureChannels` to include plugin channels**

Replace the entire `configureChannels` function (lines 61-139) with:

```typescript
export async function configureChannels(config: Config): Promise<{ config: Config; changed: boolean }> {
  const next = structuredClone(config);
  let changed = false;

  // Discover plugin channels with setup hooks
  const pluginChannels = await discoverPluginChannels();

  noteChannelStatus(next);

  while (true) {
    const statuses = getChannelStatuses(next);
    const builtinOptions = statuses.map((s) => {
      const status = s.enabled ? "enabled" : s.configured ? "disabled" : "not configured";
      return {
        value: s.id as string,
        label: `${s.label} (${CHANNEL_META[s.id].method})`,
        hint: status + (s.hint ? ` · ${s.hint}` : ""),
      };
    });

    // Add plugin channel options
    const pluginOptions = pluginChannels.map((p) => {
      const ch = next.channels[p.factory.name] as Record<string, unknown> | undefined;
      const enabled = ch?.enabled === true;
      const configured = !!ch && Object.keys(ch).length > 1;
      const status = enabled ? "enabled" : configured ? "disabled" : "not configured";
      return {
        value: p.factory.name,
        label: `${p.factory.displayName ?? p.factory.name} (${p.factory.method ?? "Plugin"})`,
        hint: status,
      };
    });

    const choice = guardCancel(
      await clack.select({
        message: "Select a channel",
        options: [
          ...builtinOptions,
          ...pluginOptions,
          { value: "__done__" as const, label: "Finished" },
        ],
      }),
    );

    if (choice === "__done__") break;

    const channelId = choice as string;

    // Check if this is a plugin channel
    const plugin = pluginChannels.find((p) => p.factory.name === channelId);

    const existing = next.channels[channelId] as Record<string, unknown> | undefined;
    const isConfigured = !!existing && Object.keys(existing).length > 1;

    if (isConfigured) {
      const label = plugin ? (plugin.factory.displayName ?? plugin.factory.name) : CHANNEL_META[channelId as ChannelId]?.label ?? channelId;
      const action = await promptConfiguredAction(label);

      if (action === "skip") continue;
      if (action === "disable") {
        (next.channels[channelId] as Record<string, unknown>).enabled = false;
        changed = true;
        console.log(ok(`${label} disabled`));
        continue;
      }
      if (action === "delete") {
        const confirmed = guardCancel(
          await clack.confirm({
            message: `Delete ${label} config? This cannot be undone.`,
            initialValue: false,
          }),
        );
        if (confirmed) {
          delete next.channels[channelId];
          changed = true;
          console.log(ok(`${label} config deleted`));
        }
        continue;
      }
      // action === "modify" — fall through to setup
    }

    // Run channel setup
    if (plugin) {
      // Plugin channel — call factory.setup()
      const result = await plugin.factory.setup!(isConfigured ? existing : undefined);
      (next.channels as Record<string, unknown>)[channelId] = {
        enabled: true,
        adapter: plugin.packageName,
        ...result,
      };
      changed = true;
    } else if (channelId === "telegram") {
      const result = await setupTelegram({
        existing: isConfigured ? (existing as Config["channels"][string]) : undefined,
      });
      next.channels.telegram = result;
      changed = true;
    } else if (channelId === "discord") {
      const result = await setupDiscord({
        existing: isConfigured ? (existing as unknown as DiscordChannelConfig) : undefined,
      });
      next.channels.discord = result as Config["channels"][string];
      changed = true;
    }
  }

  return { config: next, changed };
}
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/OpenACP && pnpm build`
Expected: Build succeeds

- [ ] **Step 5: Verify tests**

Run: `cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/OpenACP && pnpm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/OpenACP
git add src/core/setup/setup-channels.ts
git commit -m "feat: discover plugin setup hooks in channel wizard"
```

---

## Task 3: Rebuild OpenACP so slack-plugin can link updated types

**Files:** None (build-only)

- [ ] **Step 1: Rebuild**

Run: `cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/OpenACP && pnpm build`
Expected: Clean build — `dist/` contains updated `.d.ts` files with the new `AdapterFactory` interface and exported helpers.

This is needed because `slack-plugin` links to `file:../OpenACP` and resolves types from `dist/`.

---

# Part B: slack-plugin repo

> **Repo:** `/Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin`

## Task 4: Create setup.ts with setupSlack wizard

**Files:**
- Create: `slack-plugin/src/setup.ts`
- Create: `slack-plugin/src/__tests__/setup-slack.test.ts`
- Modify: `slack-plugin/package.json`

- [ ] **Step 1: Add `@clack/prompts` dependency**

Run: `cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin && npm install @clack/prompts`

- [ ] **Step 2: Create `src/setup.ts`**

This is ported from PR #67's `src/core/setup/setup-slack.ts` with these changes:
- Imports `guardCancel`, `ok`, `fail`, `warn`, `dim`, `c`, `step` from `@openacp/cli` instead of `./helpers.js`
- Removes `expandHome` import (use inline path)
- Removes `SlackChannelConfig` import from core config (use local type)
- `setupSlack()` signature changed: accepts `existing?: Record<string, unknown>`, returns `Promise<Record<string, unknown>>` (matching `AdapterFactory.setup()` contract)
- Removes `upgradeSlackScopes()` (out of scope)

```typescript
// src/setup.ts
import fs from "node:fs";
import * as path from "node:path";
import os from "node:os";
import * as clack from "@clack/prompts";
import { guardCancel, ok, fail, warn, dim, c } from "@openacp/cli";

// --- Manifest ---

export interface SlackManifest {
  version: number;
  manifest: {
    display_information: { name: string };
    features: {
      app_home: { messages_tab_enabled: boolean; messages_tab_read_only_enabled: boolean };
      bot_user: { display_name: string; always_online: boolean };
      slash_commands: Array<{ command: string; description: string; should_escape: boolean }>;
    };
    oauth_config: { scopes: { bot: string[] } };
    settings: {
      event_subscriptions: { bot_events: string[] };
      interactivity: { is_enabled: boolean };
      socket_mode_enabled: boolean;
      token_rotation_enabled: boolean;
    };
  };
}

export function generateSlackManifest(): SlackManifest {
  return {
    version: 2,
    manifest: {
      display_information: { name: "OpenACP" },
      features: {
        app_home: { messages_tab_enabled: true, messages_tab_read_only_enabled: false },
        bot_user: { display_name: "OpenACP", always_online: true },
        slash_commands: [
          {
            command: "/openacp-archive",
            description: "Archive current session channel and start fresh",
            should_escape: false,
          },
        ],
      },
      oauth_config: {
        scopes: {
          bot: [
            "channels:manage", "channels:history", "channels:join", "channels:read",
            "chat:write", "chat:write.public",
            "commands",
            "groups:write", "groups:history", "groups:read",
            "files:read", "files:write",
            "im:history",
          ],
        },
      },
      settings: {
        event_subscriptions: { bot_events: ["message.channels", "message.groups", "message.im"] },
        interactivity: { is_enabled: true },
        socket_mode_enabled: true,
        token_rotation_enabled: false,
      },
    },
  };
}

export async function validateSlackBotToken(
  token: string,
): Promise<{ ok: true; botUsername: string } | { ok: false; error: string }> {
  try {
    const res = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    const data = (await res.json()) as { ok: boolean; user?: string; error?: string };
    if (data.ok && data.user) return { ok: true, botUsername: data.user };
    return { ok: false, error: data.error || "Invalid token" };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

// --- Manifest version tracking ---

const OPENACP_DIR = path.join(os.homedir(), ".openacp");
const SLACK_MANIFEST_VERSION_FILE = path.join(OPENACP_DIR, "slack-manifest-version");

function writeSlackManifestVersion(version: number): void {
  fs.mkdirSync(path.dirname(SLACK_MANIFEST_VERSION_FILE), { recursive: true });
  fs.writeFileSync(SLACK_MANIFEST_VERSION_FILE, String(version), "utf8");
}

// --- Setup wizard ---

export async function setupSlack(existing?: Record<string, unknown>): Promise<Record<string, unknown>> {
  // Guard: already configured
  if (existing?.botToken) {
    const rerun = guardCancel(
      await clack.confirm({
        message: "Slack is already configured. Re-run setup? This will overwrite existing credentials.",
        initialValue: false,
      }),
    );
    if (!rerun) {
      clack.cancel("Keeping existing Slack config.");
      process.exit(0);
    }
  }

  // Step 1: App Manifest
  const { manifest } = generateSlackManifest();
  const manifestJson = JSON.stringify(manifest, null, 2);

  console.log("");
  console.log(`  ${c.bold}Step 1: Create your Slack app${c.reset}`);
  console.log("");
  console.log(dim("  1. Open https://api.slack.com/apps"));
  console.log(dim("  2. Click 'Create New App' → 'From a manifest'"));
  console.log(dim("  3. Select your workspace"));
  console.log(dim("  4. Paste this manifest:"));
  console.log("");
  console.log(`  ┌${"─".repeat(60)}┐`);
  manifestJson.split("\n").forEach((line) => {
    console.log(`  │ ${line.padEnd(58)} │`);
  });
  console.log(`  └${"─".repeat(60)}┘`);
  console.log("");
  console.log(dim("  5. Click Next → Create → Install to Workspace → Allow"));
  console.log(dim("  6. After install:"));
  console.log(dim("     • Bot Token:      OAuth & Permissions → Bot User OAuth Token"));
  console.log(dim("     • App Token:      Basic Information → App-Level Tokens → Generate Token"));
  console.log(dim("                       (name it anything, select 'connections:write' scope)"));
  console.log(dim("     • Signing Secret: Basic Information → App Credentials → Signing Secret"));
  console.log("");

  guardCancel(await clack.text({ message: "Press Enter when done..." }));

  // Step 2: Credentials
  let botToken = "";
  while (true) {
    botToken = (guardCancel(
      await clack.text({
        message: "Bot Token (xoxb-...):",
        validate: (val) => (val ?? "").toString().trim().length > 0 ? undefined : "Bot Token cannot be empty",
      }),
    ) as string).trim();

    const spinner = clack.spinner();
    spinner.start("Validating Bot Token...");
    const result = await validateSlackBotToken(botToken);
    spinner.stop(result.ok ? ok(`Authenticated as @${result.botUsername}`) : fail(result.error));

    if (result.ok) break;

    const action = guardCancel(
      await clack.select({
        message: "What to do?",
        options: [
          { label: "Re-enter token", value: "retry" },
          { label: "Use as-is (skip validation)", value: "skip" },
        ],
      }),
    );
    if (action === "skip") break;
  }

  const appToken = (guardCancel(
    await clack.text({
      message: "App Token (xapp-1-...):",
      validate: (val) => {
        const v = (val ?? "").toString().trim();
        if (!v) return "App Token cannot be empty";
        if (!v.startsWith("xapp-1-")) return "App Token must start with xapp-1-";
        return undefined;
      },
    }),
  ) as string).trim();

  const signingSecret = (guardCancel(
    await clack.text({
      message: "Signing Secret:",
      validate: (val) => (val ?? "").toString().trim().length > 0 ? undefined : "Signing Secret cannot be empty",
    }),
  ) as string).trim();

  console.log(warn("App Token and Signing Secret cannot be validated until the adapter starts."));

  // Step 3: Optional config
  const allowedRaw = (guardCancel(
    await clack.text({
      message: "Allowed Slack User IDs (comma-separated, or Enter to allow all):",
      placeholder: "U0123456789, U9876543210",
    }),
  ) as string).trim();
  const allowedUserIds = allowedRaw
    ? allowedRaw.split(",").map((uid) => uid.trim()).filter(Boolean)
    : [];

  const channelPrefix = (guardCancel(
    await clack.text({
      message: "Channel prefix:",
      initialValue: "openacp",
    }),
  ) as string).trim() || "openacp";

  // Step 4: Auto-create notification channel
  let notificationChannelId: string | undefined;

  const s4 = clack.spinner();
  s4.start("Creating #openacp-notifications channel...");

  try {
    const { WebClient } = await import("@slack/web-api");
    const web = new WebClient(botToken);

    try {
      const createRes = await web.conversations.create({
        name: "openacp-notifications",
        is_private: true,
      });
      notificationChannelId = (createRes.channel as { id?: string })?.id;
      s4.stop(ok(`Created #openacp-notifications (${notificationChannelId})`));
      console.log(dim("  ➜ Join the channel: open Slack → search for #openacp-notifications → Join"));
    } catch (createErr: unknown) {
      const errCode = (createErr as { data?: { error?: string } })?.data?.error;
      if (errCode === "name_taken") {
        s4.message("Channel name taken — looking up existing channel...");
        let cursor = "";
        let found = false;
        while (true) {
          const listRes = await web.conversations.list({
            types: "private_channel",
            cursor,
            limit: 200,
          });
          const channels = (listRes.channels ?? []) as Array<{ id?: string; name?: string }>;
          const match = channels.find((ch) => ch.name === "openacp-notifications");
          if (match?.id) {
            notificationChannelId = match.id;
            s4.stop(ok(`Using existing #openacp-notifications (${notificationChannelId})`));
            found = true;
            break;
          }
          cursor = (listRes.response_metadata as { next_cursor?: string })?.next_cursor ?? "";
          if (!cursor) break;
        }
        if (!found) {
          s4.stop(warn("Could not find #openacp-notifications"));
          console.log(dim("  Set notificationChannelId manually in config after joining the channel"));
        }
      } else {
        s4.stop(warn("Could not create notification channel — skipping"));
        console.log(dim("  Set notificationChannelId manually in config after joining the channel"));
      }
    }
  } catch {
    s4.stop(warn("Skipped notification channel creation"));
  }

  writeSlackManifestVersion(generateSlackManifest().version);

  console.log("");
  console.log(ok("Slack adapter configured"));
  console.log(dim("  Note: autoCreateSession is enabled by default."));
  console.log(dim("  To disable: openacp config set channels.slack.autoCreateSession false"));

  return {
    botToken,
    appToken,
    signingSecret,
    allowedUserIds,
    channelPrefix,
    autoCreateSession: true,
    ...(notificationChannelId ? { notificationChannelId } : {}),
  };
}
```

Key differences from PR #67's version:
- Returns `Record<string, unknown>` (not `{ slackConfig, speechConfig }`) — core adds `enabled` + `adapter` fields
- Imports helpers from `@openacp/cli` instead of relative paths
- Uses `os.homedir()` instead of `expandHome()`
- Removed voice setup (speech config is a separate concern from channel adapter config — can be added later)
- Removed `upgradeSlackScopes()` (out of scope)

- [ ] **Step 3: Create `src/__tests__/setup-slack.test.ts`**

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { generateSlackManifest, validateSlackBotToken } from "../setup.js";

describe("generateSlackManifest", () => {
  it("returns manifest with required bot scopes", () => {
    const manifest = generateSlackManifest();
    expect(manifest.version).toBe(2);
    const scopes = manifest.manifest.oauth_config.scopes.bot;
    const required = [
      "channels:manage", "channels:history", "channels:join", "channels:read",
      "chat:write", "chat:write.public",
      "groups:write", "groups:history", "groups:read",
      "files:read", "files:write",
    ];
    for (const s of required) expect(scopes).toContain(s);
  });

  it("includes /openacp-archive slash command", () => {
    const manifest = generateSlackManifest();
    const cmds = manifest.manifest.features.slash_commands;
    expect(cmds).toHaveLength(1);
    expect(cmds[0].command).toBe("/openacp-archive");
  });

  it("has socket_mode_enabled true", () => {
    const manifest = generateSlackManifest();
    expect(manifest.manifest.settings.socket_mode_enabled).toBe(true);
  });

  it("has interactivity enabled", () => {
    const manifest = generateSlackManifest();
    expect(manifest.manifest.settings.interactivity.is_enabled).toBe(true);
  });

  it("subscribes to message.channels, message.groups, and message.im events", () => {
    const manifest = generateSlackManifest();
    const events = manifest.manifest.settings.event_subscriptions.bot_events;
    expect(events).toContain("message.channels");
    expect(events).toContain("message.groups");
    expect(events).toContain("message.im");
  });
});

describe("validateSlackBotToken", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("returns ok with username on valid token", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, user: "openacp-bot", user_id: "U123" }),
    }));
    const result = await validateSlackBotToken("xoxb-valid");
    expect(result).toEqual({ ok: true, botUsername: "openacp-bot" });
  });

  it("returns error when Slack responds ok: false", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: false, error: "invalid_auth" }),
    }));
    const result = await validateSlackBotToken("xoxb-bad");
    expect(result).toEqual({ ok: false, error: "invalid_auth" });
  });

  it("returns error on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    const result = await validateSlackBotToken("xoxb-any");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Network error");
  });
});
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin && npm run build`
Expected: Build succeeds

- [ ] **Step 5: Run tests**

Run: `cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin && npm test`
Expected: All tests pass (existing 65 + new setup tests)

- [ ] **Step 6: Commit**

```bash
cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin
git add src/setup.ts src/__tests__/setup-slack.test.ts package.json package-lock.json
git commit -m "feat: add setupSlack wizard (ported from PR #67)"
```

---

## Task 5: Wire setup into adapterFactory

**Files:**
- Modify: `slack-plugin/src/index.ts`

- [ ] **Step 1: Update `src/index.ts`**

Replace the entire file:

```typescript
// src/index.ts
import type { AdapterFactory } from "@openacp/cli";
import { SlackAdapter } from "./adapter.js";
import type { SlackChannelConfig } from "./types.js";

export const adapterFactory: AdapterFactory = {
  name: "slack",
  displayName: "Slack",
  method: "Socket Mode",
  createAdapter(core, config) {
    return new SlackAdapter(core, config as SlackChannelConfig);
  },
  async setup(existing) {
    const { setupSlack } = await import("./setup.js");
    return setupSlack(existing);
  },
};

export { SlackAdapter } from "./adapter.js";
export type { SlackChannelConfig, SlackSessionMeta, SlackFileInfo } from "./types.js";
export { generateSlackManifest, validateSlackBotToken } from "./setup.js";
export type { SlackManifest } from "./setup.js";
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Run tests**

Run: `cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin && npm test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin
git add src/index.ts
git commit -m "feat: wire setupSlack into adapterFactory.setup()"
```

---

# Part C: Cross-repo verification

## Task 6: End-to-end verification

- [ ] **Step 1: Rebuild both repos**

```bash
cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/OpenACP && pnpm build
cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin && npm run build
```

Expected: Both build clean

- [ ] **Step 2: Run all tests**

```bash
cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/OpenACP && pnpm test
cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin && npm test
```

Expected: All tests pass in both repos

- [ ] **Step 3: Reinstall plugin**

```bash
cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/OpenACP && node dist/cli.js install ../slack-plugin
```

Expected: Installs successfully

- [ ] **Step 4: Test wizard discovery**

```bash
cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/OpenACP && node dist/cli.js onboard
```

Expected: Channel menu shows "Slack (Socket Mode)" alongside Telegram and Discord. Selecting Slack runs the interactive wizard.

- [ ] **Step 5: Verify no stale references**

```bash
cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/slack-plugin && grep -r "../../core" src/ || echo "No stale core imports"
cd /Users/hieu/Documents/Companies/Lab3/opensource/openacp-group/OpenACP && grep -r "setup-slack\|setupSlack" src/ || echo "No stale Slack setup references in core"
```

Expected: No stale references found
