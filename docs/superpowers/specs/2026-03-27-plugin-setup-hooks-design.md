# Plugin Setup Hooks

## Context

OpenACP's CLI setup wizard (`openacp onboard`) lets users configure messaging channels interactively. Currently only built-in channels (Telegram, Discord) appear in the wizard. Adapter plugins like `@openacp/adapter-slack` have no way to register a setup wizard — users must manually edit `config.json` to configure them.

PR #67 contains a working `setupSlack()` wizard (~400 lines) that was written for core but needs to live in the plugin after the Slack extraction.

## Goal

Allow adapter plugins to export an optional `setup()` function. Core auto-discovers installed plugins that have a setup hook and shows them in the channel configuration wizard alongside built-in channels.

## Scope

**In scope:**
- Extend `AdapterFactory` interface with `displayName`, `method?`, `setup?()`
- Core discovers plugin setup hooks in `configureChannels()`
- Export setup helpers from `@openacp/cli` for plugins to use
- Port `setupSlack()` from PR #67 into `slack-plugin/src/setup.ts`
- Port setup tests from PR #67

**Out of scope:**
- `upgradeSlackScopes()` — separate follow-up
- `openacp onboard <plugin>` CLI subcommand — separate follow-up
- Refactoring built-in channels (Telegram, Discord) to use the same plugin pattern
- npm publish

---

## 1. AdapterFactory Interface

**File:** `OpenACP/src/core/plugin-manager.ts`

```typescript
export interface AdapterFactory {
  name: string
  displayName: string
  method?: string
  createAdapter(core: OpenACPCore, config: ChannelConfig): ChannelAdapter
  setup?(existing?: Record<string, unknown>): Promise<Record<string, unknown>>
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | yes | Config key, e.g. `"slack"` → `config.channels.slack` |
| `displayName` | yes | Human label for wizard menu, e.g. `"Slack"` |
| `method` | no | Hint shown in menu, e.g. `"Socket Mode"` |
| `createAdapter` | yes | Creates adapter instance (existing) |
| `setup` | no | Interactive wizard, returns channel config |

**Backward compatibility:** Existing plugins without `displayName` or `setup` continue to work. Core checks `typeof factory.setup === 'function'` before showing in wizard. `displayName` is required in the TypeScript interface but core falls back to `factory.name` at runtime if missing (for JS plugins).

### setup() Contract

- **Input:** `existing` — current channel config if reconfiguring, `undefined` if first setup
- **Output:** Plain object with channel-specific config fields (e.g. `{ botToken, appToken, signingSecret, ... }`)
- **Core responsibility:** Core wraps the result with `{ enabled: true, adapter: packageName, ...result }` before writing to config
- **Plugin responsibility:** Run interactive prompts, validate credentials, return config. Plugin must NOT write to config file directly.
- **Cancellation:** Plugin should use `guardCancel()` (from `@openacp/cli`) to handle Ctrl+C. If user cancels, process exits — no special return value needed.

---

## 2. Core Setup Discovery

**File:** `OpenACP/src/core/setup/setup-channels.ts`

### Discovery Flow

When `configureChannels()` runs:

1. Show built-in channels (Telegram, Discord) from `CHANNEL_META` — unchanged
2. Call `listPlugins()` to get installed plugin package names
3. For each plugin, call `loadAdapterFactory(packageName)`
4. Filter to factories with `typeof factory.setup === 'function'`
5. Add plugin channels to the selection menu
6. When user selects a plugin channel, call `factory.setup(existing)`
7. Write result to config: `config.channels[factory.name] = { enabled: true, adapter: packageName, ...result }`

### Menu Display

```
  Telegram (Bot API)        — enabled · Chat ID: 123
  Discord (Bot API)         — not configured
  Slack (Socket Mode)       — not configured        ← discovered from plugin
  ──────────
  Finished
```

Plugin channel status is derived from `config.channels[factory.name]`:
- Has config + `enabled: true` → "enabled"
- Has config + `enabled: false` → "disabled"
- No config → "not configured"

### Type Handling

`ChannelId` union type (`"telegram" | "discord"`) is NOT modified. Plugin channels use `string` keys. The menu selection returns `string` and runtime checks distinguish built-in vs plugin channels:

```typescript
if (channelId === "telegram") {
  // existing built-in flow
} else if (channelId === "discord") {
  // existing built-in flow
} else {
  // plugin channel — find factory by name, call setup()
  const factory = pluginFactories.find(f => f.name === channelId)
  if (factory?.setup) {
    const result = await factory.setup(existing)
    next.channels[channelId] = { enabled: true, adapter: packageName, ...result }
  }
}
```

### Plugin Channel Actions

When a plugin channel is already configured, the same action menu applies: modify (re-run setup), disable, delete, skip.

---

## 3. Exported Setup Helpers

**File:** `OpenACP/src/index.ts`

Add exports so plugins can build consistent wizard UIs:

```typescript
export { guardCancel, ok, fail, warn, step, dim, c } from './core/setup/helpers.js'
```

| Export | Purpose |
|--------|---------|
| `guardCancel(value)` | Exits on Ctrl+C cancel from clack prompts |
| `ok(msg)` | Green checkmark formatted string |
| `fail(msg)` | Red X formatted string |
| `warn(msg)` | Yellow warning formatted string |
| `step(n, total, title)` | Step header like "Step 1/3: Slack" |
| `dim(msg)` | Dimmed/gray text |
| `c` | Color constants (`c.bold`, `c.reset`, `c.dim`) |

Plugins also need `@clack/prompts` for interactive prompts — they depend on it directly, not via core re-export.

---

## 4. slack-plugin Changes

### New File: `slack-plugin/src/setup.ts`

Port from PR #67's `setupSlack()` code. The function:

1. Shows Slack app manifest with copy instructions
2. Prompts for Bot Token, validates via `auth.test` API
3. Prompts for App Token (`xapp-1-...`), Signing Secret
4. Prompts for allowed user IDs, channel prefix
5. Optionally sets up voice (STT/TTS)
6. Auto-creates `#openacp-notifications` private channel
7. Returns config object

```typescript
import { guardCancel, ok, fail, warn, step, dim, c } from '@openacp/cli'
import * as clack from '@clack/prompts'

export function generateSlackManifest(): SlackManifest { ... }
export async function validateSlackBotToken(token: string): Promise<...> { ... }
export async function setupSlack(existing?: Record<string, unknown>): Promise<Record<string, unknown>> { ... }
```

### Updated: `slack-plugin/src/index.ts`

```typescript
export const adapterFactory: AdapterFactory = {
  name: 'slack',
  displayName: 'Slack',
  method: 'Socket Mode',
  createAdapter(core, config) {
    return new SlackAdapter(core, config as SlackChannelConfig)
  },
  async setup(existing) {
    const { setupSlack } = await import('./setup.js')
    return setupSlack(existing)
  },
}
```

Lazy import `./setup.js` so `@clack/prompts` is only loaded when wizard runs, not during normal adapter operation.

### Updated: `slack-plugin/package.json`

Add to `dependencies`:
```json
"@clack/prompts": "^0.9.0"
```

### New File: `slack-plugin/src/__tests__/setup-slack.test.ts`

Port tests from PR #67 for `generateSlackManifest()` and `validateSlackBotToken()`.

---

## 5. Files to Modify

### OpenACP repo
| File | Change |
|------|--------|
| `src/core/plugin-manager.ts` | Add `displayName`, `method?`, `setup?()` to `AdapterFactory` |
| `src/core/setup/setup-channels.ts` | Add plugin discovery + call `factory.setup()` |
| `src/index.ts` | Export setup helpers |

### slack-plugin repo
| File | Change |
|------|--------|
| `src/setup.ts` | New — port setupSlack from PR #67 |
| `src/index.ts` | Add `displayName`, `method`, `setup()` to adapterFactory |
| `package.json` | Add `@clack/prompts` dependency |
| `src/__tests__/setup-slack.test.ts` | New — port setup tests from PR #67 |

---

## 6. Verification

1. `cd OpenACP && pnpm build && pnpm test` — core builds, tests pass
2. `cd slack-plugin && npm run build && npm test` — plugin builds, all tests pass (including setup tests)
3. Install plugin locally: `cd OpenACP && node dist/cli.js install ../slack-plugin`
4. Run `node dist/cli.js onboard` → channel menu shows "Slack (Socket Mode)" alongside Telegram and Discord
5. Select Slack → wizard runs, prompts for credentials, writes config
6. Restart OpenACP → Slack adapter loads from plugin config
