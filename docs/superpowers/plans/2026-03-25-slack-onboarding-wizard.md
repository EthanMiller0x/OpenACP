# Slack Onboarding Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `setupSlack()` and `upgradeSlackScopes()` to the CLI wizard so users can onboard the Slack adapter in minutes by pasting one JSON manifest instead of manually clicking 15+ steps on api.slack.com.

**Architecture:** Extend `src/core/setup.ts` with Slack-specific helpers (`generateSlackManifest`, `validateSlackBotToken`) and the two exported wizard functions, following the existing `setupTelegram` / `setupDiscord` pattern. Update `cmdOnboard()` in `commands.ts` to handle `openacp onboard slack` and `openacp onboard slack --upgrade-scopes` subcommand routing. Wire `setupSlack()` into `runSetup()` channel picker.

**Tech Stack:** TypeScript, `@clack/prompts`, `@slack/web-api` (WebClient already used in Slack adapter), Vitest

**Spec:** `docs/superpowers/specs/2026-03-25-slack-onboarding-wizard-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/core/setup.ts` | Modify | Add `generateSlackManifest()`, `validateSlackBotToken()`, `setupSlack()`, `upgradeSlackScopes()` |
| `src/cli/commands.ts` | Modify | Update `cmdOnboard()` to accept args and route `slack` / `--upgrade-scopes` |
| `src/cli.ts` | Modify | Pass `args` to `cmdOnboard()` |
| `src/__tests__/setup-slack.test.ts` | **Create** | Tests for all new Slack setup helpers |

---

### Task 1: `generateSlackManifest()` and `validateSlackBotToken()` helpers

**Files:**
- Modify: `src/core/setup.ts` (append after `setupDiscord`, before `setupAgents`)
- Create: `src/__tests__/setup-slack.test.ts`

- [ ] **Step 1: Write the test file**

Create `src/__tests__/setup-slack.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateSlackManifest, validateSlackBotToken } from '../core/setup.js'

describe('generateSlackManifest', () => {
  it('returns v1 manifest with required bot scopes', () => {
    const manifest = generateSlackManifest()
    expect(manifest.version).toBe(1)
    const scopes = manifest.manifest.oauth_config.scopes.bot
    expect(scopes).toContain('channels:manage')
    expect(scopes).toContain('channels:history')
    expect(scopes).toContain('groups:history')
    expect(scopes).toContain('chat:write')
    expect(scopes).toContain('files:read')
    expect(scopes).toContain('files:write')
  })

  it('includes /openacp-archive slash command', () => {
    const manifest = generateSlackManifest()
    const cmds = manifest.manifest.features.slash_commands
    expect(cmds).toHaveLength(1)
    expect(cmds[0].command).toBe('/openacp-archive')
  })

  it('has socket_mode_enabled true', () => {
    const manifest = generateSlackManifest()
    expect(manifest.manifest.settings.socket_mode_enabled).toBe(true)
  })

  it('has interactivity enabled', () => {
    const manifest = generateSlackManifest()
    expect(manifest.manifest.settings.interactivity.is_enabled).toBe(true)
  })

  it('subscribes to message.channels and message.groups events', () => {
    const manifest = generateSlackManifest()
    const events = manifest.manifest.settings.event_subscriptions.bot_events
    expect(events).toContain('message.channels')
    expect(events).toContain('message.groups')
  })
})

describe('validateSlackBotToken', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('returns ok with username on valid token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: true, user: 'openacp-bot', user_id: 'U123' }),
    }))
    const result = await validateSlackBotToken('xoxb-valid')
    expect(result).toEqual({ ok: true, botUsername: 'openacp-bot' })
  })

  it('returns error when Slack responds ok: false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: false, error: 'invalid_auth' }),
    }))
    const result = await validateSlackBotToken('xoxb-bad')
    expect(result).toEqual({ ok: false, error: 'invalid_auth' })
  })

  it('returns error on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')))
    const result = await validateSlackBotToken('xoxb-any')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Network error')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/hieu/Documents/Companies/Lab3/opensource/OpenACP
pnpm test -- --run src/__tests__/setup-slack.test.ts
```

Expected: FAIL — `generateSlackManifest is not a function`

- [ ] **Step 3: Implement helpers in `setup.ts`**

Add after `setupDiscord()` (around line 514), before `setupAgents()`:

```typescript
// --- Slack manifest ---

export interface SlackManifest {
  version: number;
  manifest: {
    display_information: { name: string };
    features: {
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
    version: 1,
    manifest: {
      display_information: { name: "OpenACP" },
      features: {
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
            "groups:write", "groups:history", "groups:read",
            "files:read", "files:write",
          ],
        },
      },
      settings: {
        event_subscriptions: { bot_events: ["message.channels", "message.groups"] },
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
```

- [ ] **Step 4: Run tests**

```bash
pnpm test -- --run src/__tests__/setup-slack.test.ts
```

Expected: All PASS

- [ ] **Step 5: Run build**

```bash
pnpm build
```

Expected: Clean build

- [ ] **Step 6: Commit**

```bash
git add src/core/setup.ts src/__tests__/setup-slack.test.ts
git commit -m "feat(slack): add generateSlackManifest and validateSlackBotToken helpers"
```

---

### Task 2: `setupSlack()` — main wizard

**Files:**
- Modify: `src/core/setup.ts` (add `setupSlack()` after the helpers from Task 1)

Read the existing `setupDiscord()` function (lines 447–514) in `setup.ts` to understand the `@clack/prompts` pattern before implementing.

- [ ] **Step 1: Add tests for notification channel lookup logic**

Append to `src/__tests__/setup-slack.test.ts`:

```typescript
describe('Slack notification channel lookup logic', () => {
  it('finds existing private channel by name via paginated list', () => {
    // Simulate finding channel on page 2
    const pages = [
      { channels: [{ id: 'C_OTHER', name: 'general' }], response_metadata: { next_cursor: 'cursor1' } },
      { channels: [{ id: 'C_NOTIF', name: 'openacp-notifications' }], response_metadata: { next_cursor: '' } },
    ]
    let pageIdx = 0
    const mockList = vi.fn().mockImplementation(() => Promise.resolve(pages[pageIdx++]))

    // Test the lookup logic inline
    async function findChannel(name: string) {
      let cursor = ''
      while (true) {
        const res = await mockList({ types: 'private_channel', cursor, limit: 200 }) as typeof pages[0]
        const found = res.channels.find((c: { id: string; name: string }) => c.name === name)
        if (found) return found.id
        cursor = res.response_metadata?.next_cursor ?? ''
        if (!cursor) return null
      }
    }

    return expect(findChannel('openacp-notifications')).resolves.toBe('C_NOTIF')
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

```bash
pnpm test -- --run src/__tests__/setup-slack.test.ts
```

Expected: All PASS

- [ ] **Step 3: Add imports and manifest version helpers in setup.ts**

At the top of `src/core/setup.ts`, check existing imports. `import { execFileSync } from "node:child_process"` is already there. Add if not present:

```typescript
import fs from "node:fs";
import * as path from "node:path";
```

Also add the `SlackChannelConfig` import — it is exported from `src/core/config.ts`, not the adapter:

```typescript
import type { SlackChannelConfig } from "./config.js";
```

Then after `validateSlackBotToken()`, add the version file helpers:

```typescript
// --- Slack setup wizard ---

const SLACK_MANIFEST_VERSION_FILE = expandHome("~/.openacp/slack-manifest-version");

function readSlackManifestVersion(): number {
  try {
    const content = fs.readFileSync(SLACK_MANIFEST_VERSION_FILE, "utf8").trim();
    return parseInt(content, 10) || 0;
  } catch {
    return 0;
  }
}

function writeSlackManifestVersion(version: number): void {
  fs.mkdirSync(path.dirname(SLACK_MANIFEST_VERSION_FILE), { recursive: true });
  fs.writeFileSync(SLACK_MANIFEST_VERSION_FILE, String(version), "utf8");
}
```

- [ ] **Step 4: Implement `setupSlack()`**

Add immediately after the version helpers:

```typescript
export async function setupSlack(
  stepNum = 1,
  totalSteps = 1,
  existingConfig?: Partial<SlackChannelConfig>,
): Promise<{ slackConfig: SlackChannelConfig; speechConfig: { stt?: { provider: string; apiKey: string }; tts?: { provider: string; voice?: string } } }> {
  console.log(step(stepNum, totalSteps, "Slack"));

  // Guard: already configured
  if (existingConfig?.botToken) {
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

    const s = clack.spinner();
    s.start("Validating Bot Token...");
    const result = await validateSlackBotToken(botToken);
    s.stop(result.ok ? ok(`Authenticated as @${result.botUsername}`) : fail(result.error));

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
    ? allowedRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const channelPrefix = (guardCancel(
    await clack.text({
      message: "Channel prefix:",
      initialValue: "openacp",
    }),
  ) as string).trim() || "openacp";

  // Step 3.5: Voice setup
  let speechConfig: { stt?: { provider: string; apiKey: string }; tts?: { provider: string; voice?: string } } = {};

  const enableVoice = guardCancel(
    await clack.confirm({
      message: "Enable voice support? (Speech-to-Text / Text-to-Speech)",
      initialValue: false,
    }),
  );

  if (enableVoice) {
    const groqKey = (guardCancel(
      await clack.text({
        message: "Groq API key for Speech-to-Text (get free key at console.groq.com, or Enter to skip):",
        placeholder: "gsk_...",
      }),
    ) as string).trim();

    if (groqKey) {
      speechConfig.stt = { provider: "groq", apiKey: groqKey };
      console.log(ok("STT configured — files:read is already in the app manifest, no reinstall needed"));
    }

    const enableTts = guardCancel(
      await clack.confirm({
        message: "Enable Text-to-Speech? (Edge TTS, free, no API key needed)",
        initialValue: true,
      }),
    );

    if (enableTts) {
      console.log(dim("  Popular voices: en-US-GuyNeural, vi-VN-HoaiMyNeural, ja-JP-NanamiNeural"));
      const voice = (guardCancel(
        await clack.text({
          message: "Voice (Enter for default en-US-AriaNeural):",
          placeholder: "en-US-AriaNeural",
        }),
      ) as string).trim() || "en-US-AriaNeural";

      speechConfig.tts = { provider: "edge-tts", voice };
      console.log(ok("TTS configured — files:write is already in the app manifest, no reinstall needed"));
    }
  }

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
        // Try to find existing channel
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

  // Write manifest version marker
  writeSlackManifestVersion(generateSlackManifest().version);

  // Build result config
  const slackConfig: SlackChannelConfig = {
    enabled: true,
    adapter: "slack",
    botToken,
    appToken,
    signingSecret,
    allowedUserIds,
    channelPrefix,
    ...(notificationChannelId ? { notificationChannelId } : {}),
  };

  console.log("");
  console.log(ok("Slack adapter configured"));
  console.log(dim("  Note: autoCreateSession is enabled by default."));
  console.log(dim("  To disable: openacp config set channels.slack.autoCreateSession false"));

  return { slackConfig, speechConfig };
}

- [ ] **Step 5: Run build**

```bash
pnpm build
```

Expected: Clean build. Fix any TypeScript errors before proceeding.

- [ ] **Step 6: Commit**

```bash
git add src/core/setup.ts src/__tests__/setup-slack.test.ts
git commit -m "feat(slack): implement setupSlack() wizard with voice support"
```

---

### Task 3: `upgradeSlackScopes()` — scope upgrade path

**Files:**
- Modify: `src/core/setup.ts` (add `upgradeSlackScopes()` after `setupSlack()`)
- Modify: `src/__tests__/setup-slack.test.ts` (add tests)

- [ ] **Step 1: Add tests**

Append to `src/__tests__/setup-slack.test.ts`:

```typescript
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

describe('manifest version tracking', () => {
  it('generateSlackManifest returns version 1', () => {
    const { version } = generateSlackManifest()
    expect(version).toBe(1)
  })
})
```

- [ ] **Step 2: Run tests**

```bash
pnpm test -- --run src/__tests__/setup-slack.test.ts
```

Expected: All PASS

- [ ] **Step 3: Implement `upgradeSlackScopes()`**

Add after `setupSlack()` in `src/core/setup.ts`:

```typescript
export async function upgradeSlackScopes(configManager: ConfigManager): Promise<void> {
  await configManager.load().catch(() => {});
  const config = configManager.get();
  const slackConfig = (config.channels as Record<string, unknown>)?.slack as SlackChannelConfig | undefined;

  if (!slackConfig?.botToken) {
    console.log(fail("No Slack config found. Run `openacp onboard slack` first."));
    process.exit(1);
  }

  const currentVersion = readSlackManifestVersion();
  const { version: latestVersion, manifest } = generateSlackManifest();

  console.log("");
  console.log(`  Current manifest: ${c.bold}v${currentVersion}${c.reset}`);
  console.log(`  Latest manifest:  ${c.bold}v${latestVersion}${c.reset}`);
  console.log("");

  if (currentVersion >= latestVersion) {
    console.log(ok("Your Slack app scopes are up to date."));
    return;
  }

  console.log(`  ${c.bold}New scopes in v${latestVersion}:${c.reset}`);
  // Future: diff old vs new scopes here
  console.log(dim("  (scope changes will be listed here in future versions)"));
  console.log("");

  const manifestJson = JSON.stringify(manifest, null, 2);
  console.log(`  ┌${"─".repeat(60)}┐`);
  manifestJson.split("\n").forEach((line) => {
    console.log(`  │ ${line.padEnd(58)} │`);
  });
  console.log(`  └${"─".repeat(60)}┘`);
  console.log("");
  console.log(dim("  1. Open api.slack.com/apps → Your App → App Manifest"));
  console.log(dim("  2. Replace entire manifest with the one above"));
  console.log(dim("  3. Save Changes → Reinstall App → Install to Workspace"));
  console.log(dim("  4. Copy the new Bot Token from OAuth & Permissions"));
  console.log("");

  guardCancel(await clack.text({ message: "Press Enter when done..." }));

  let newToken = "";
  while (true) {
    newToken = (guardCancel(
      await clack.text({
        message: "New Bot Token (xoxb-...):",
        validate: (val) => (val ?? "").toString().trim().length > 0 ? undefined : "Token cannot be empty",
      }),
    ) as string).trim();

    const s = clack.spinner();
    s.start("Validating new Bot Token...");
    const result = await validateSlackBotToken(newToken);
    s.stop(result.ok ? ok(`Authenticated as @${result.botUsername}`) : fail(result.error));

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

  await configManager.save({ channels: { slack: { ...slackConfig, botToken: newToken } } });
  writeSlackManifestVersion(latestVersion);
  console.log(ok("Scope upgrade complete"));
}
```

> **Note:** `configManager.save()` performs a deep merge — it merges the passed partial config into the existing config and writes to disk. Read `src/core/config.ts` to confirm the `save()` signature before implementing.

- [ ] **Step 4: Run build**

```bash
pnpm build
```

Expected: Clean build. Fix any TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/core/setup.ts src/__tests__/setup-slack.test.ts
git commit -m "feat(slack): implement upgradeSlackScopes() for scope upgrade path"
```

---

### Task 4: Wire `setupSlack()` into `runSetup()` channel picker

**Files:**
- Modify: `src/core/setup.ts` — update `runSetup()`

- [ ] **Step 1: Update channel picker and handler in `runSetup()`**

In `runSetup()` (line 735), change the `clack.select` options and add Slack handling:

```typescript
// Before (line 736-744):
const channelChoice = guardCancel(
  await clack.select({
    message: 'Which messaging platform do you want to use?',
    options: [
      { label: 'Telegram', value: 'telegram' },
      { label: 'Discord', value: 'discord' },
      { label: 'Both', value: 'both' },
    ],
  }),
);

// After:
const channelChoice = guardCancel(
  await clack.select({
    message: 'Which messaging platform do you want to use?',
    options: [
      { label: 'Telegram', value: 'telegram' },
      { label: 'Discord', value: 'discord' },
      { label: 'Slack', value: 'slack' },
      { label: 'Multiple (Telegram + Discord)', value: 'both' },
    ],
  }),
);
```

- [ ] **Step 2: Add Slack variable declaration and step counting**

After `let discord: DiscordChannelConfig | undefined;` (line 747), add:

```typescript
let slackResult: { slackConfig: SlackChannelConfig; speechConfig: { stt?: { provider: string; apiKey: string }; tts?: { provider: string; voice?: string } } } | undefined;
```

Update step count logic:

```typescript
// Before:
const channelSteps = channelChoice === 'both' ? 2 : 1;

// After:
const channelSteps = channelChoice === 'both' ? 2 : 1;
// Slack counts as 1 channel step
```

- [ ] **Step 3: Add Slack setup call**

After the Discord setup block (line 763), add:

```typescript
if (channelChoice === 'slack') {
  currentStep++;
  slackResult = await setupSlack(currentStep, totalSteps);
}
```

- [ ] **Step 4: Add Slack to channels and speech to config**

In the config assembly block (lines 812–857), add:

```typescript
// After: if (discord) channels.discord = ...
if (slackResult) channels.slack = slackResult.slackConfig as unknown as Config["channels"][string];
```

And update the speech block:

```typescript
speech: {
  stt: slackResult?.speechConfig?.stt
    ? { provider: slackResult.speechConfig.stt.provider, providers: { [slackResult.speechConfig.stt.provider]: { apiKey: slackResult.speechConfig.stt.apiKey } } }
    : { provider: null, providers: {} },
  tts: slackResult?.speechConfig?.tts
    ? { provider: slackResult.speechConfig.tts.provider, providers: { [slackResult.speechConfig.tts.provider]: { voice: slackResult.speechConfig.tts.voice } } }
    : { provider: null, providers: {} },
},
```

- [ ] **Step 5: Run build and existing tests**

```bash
pnpm build && pnpm test -- --run src/__tests__/setup.test.ts src/__tests__/setup-slack.test.ts
```

Expected: Build clean, all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/core/setup.ts
git commit -m "feat(slack): wire setupSlack into runSetup channel picker"
```

---

### Task 5: CLI routing — `openacp onboard slack` and `--upgrade-scopes`

**Files:**
- Modify: `src/cli/commands.ts` — update `cmdOnboard()`
- Modify: `src/cli.ts` — pass `args` to `cmdOnboard()`

- [ ] **Step 1: Update `cli.ts` to pass args**

In `src/cli.ts` line 53, change:

```typescript
// Before:
'onboard': () => cmdOnboard(),

// After:
'onboard': () => cmdOnboard(args),
```

- [ ] **Step 2: Update `cmdOnboard()` signature in `commands.ts`**

At line 1813, replace `cmdOnboard()` with:

```typescript
export async function cmdOnboard(args: string[] = []): Promise<void> {
  const { ConfigManager } = await import('../core/config.js')
  const cm = new ConfigManager()

  const subcommand = args[1]        // e.g. "slack"
  const flag = args[2]              // e.g. "--upgrade-scopes"

  if (subcommand === 'slack') {
    if (flag === '--upgrade-scopes') {
      const { upgradeSlackScopes } = await import('../core/setup.js')
      await upgradeSlackScopes(cm)
      return
    }
    // Direct Slack setup
    await cm.load().catch(() => {})
    const existing = cm.get().channels?.slack
    const { setupSlack } = await import('../core/setup.js')
    const result = await setupSlack(1, 1, existing)
    // Merge into config
    const config = cm.get()
    const channels = { ...config.channels, slack: result.slackConfig }
    // Handle speech config merge
    const speech = { ...config.speech }
    if (result.speechConfig.stt) {
      speech.stt = { provider: result.speechConfig.stt.provider, providers: { [result.speechConfig.stt.provider]: { apiKey: result.speechConfig.stt.apiKey } } }
    }
    if (result.speechConfig.tts) {
      speech.tts = { provider: result.speechConfig.tts.provider, providers: { [result.speechConfig.tts.provider]: { voice: result.speechConfig.tts.voice } } }
    }
    await cm.writeNew({ ...config, channels, speech })
    return
  }

  const { runSetup } = await import('../core/setup.js')
  await runSetup(cm, { skipRunMode: true })
}
```

- [ ] **Step 3: Run build**

```bash
pnpm build
```

Expected: Clean build

- [ ] **Step 4: Run all setup tests**

```bash
pnpm test -- --run src/__tests__/setup.test.ts src/__tests__/setup-slack.test.ts
```

Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts src/cli/commands.ts
git commit -m "feat(slack): add openacp onboard slack and --upgrade-scopes CLI routing"
```

---

### Task 6: Final verification

- [ ] **Step 1: Full build**

```bash
pnpm build
```

Expected: Clean, no errors

- [ ] **Step 2: Full test suite**

```bash
pnpm test -- --run
```

Expected: All tests pass, no regressions

- [ ] **Step 3: Run build + full test suite**

```bash
pnpm build && pnpm test -- --run
```

Expected: Clean build, all tests pass

- [ ] **Step 4: Final commit if any fixups**

```bash
git add -A
git commit -m "fix(slack): resolve any integration issues from onboarding wizard"
```
