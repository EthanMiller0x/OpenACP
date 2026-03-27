# Extract Slack Adapter to Plugin

## Context

OpenACP currently hard-codes Slack (and Discord) adapters in `main.ts`. The goal is to extract Slack into a standalone plugin in the `slack-plugin` repo, keeping only Telegram as a built-in adapter in core. This reduces core complexity and establishes the pattern for future adapter plugins.

## Approach

Use the existing **AdapterFactory** plugin system (`plugin-manager.ts`). The Slack plugin exports an `adapterFactory` object and is loaded dynamically via `loadAdapterFactory()`.

## Scope

- Extract Slack adapter code from core into `slack-plugin` repo
- Remove Slack from core `main.ts` hard-coded adapters
- Add backward-compatible migration message for existing users
- **Out of scope:** Discord extraction, npm publish, plugin-registry entry, setup wizard (separate PR)

---

## 1. slack-plugin Repo Structure

```
slack-plugin/
├── src/
│   ├── index.ts              # Export adapterFactory
│   ├── adapter.ts            # SlackAdapter class
│   ├── event-router.ts       # Routes Slack messages to sessions
│   ├── channel-manager.ts    # Creates/archives session channels
│   ├── permission-handler.ts # Allow/Deny button interactions
│   ├── formatter.ts          # Slack-specific message formatting
│   ├── text-buffer.ts        # Batches outgoing messages
│   ├── send-queue.ts         # Single-threaded WebAPI queue
│   ├── slug.ts               # Slug validation
│   ├── utils.ts              # Audio file detection
│   ├── types.ts              # SlackChannelConfig, SlackSessionMeta, SlackFileInfo
│   └── __tests__/            # All existing Slack tests
│       ├── adapter-lifecycle.test.ts
│       ├── channel-manager.test.ts
│       ├── event-router.test.ts
│       ├── formatter.test.ts
│       ├── permission-handler.test.ts
│       ├── send-queue.test.ts
│       ├── slack-voice.test.ts
│       ├── slug.test.ts
│       └── text-buffer.test.ts
├── package.json
├── tsconfig.json
├── .gitignore
└── README.md
```

## 2. Entry Point (`src/index.ts`)

```typescript
import type { AdapterFactory } from '@openacp/cli'
import { SlackAdapter } from './adapter.js'
import type { SlackChannelConfig } from './types.js'

export const adapterFactory: AdapterFactory = {
  name: 'slack',
  createAdapter(core, config) {
    return new SlackAdapter(core, config as SlackChannelConfig)
  },
}

export { SlackAdapter } from './adapter.js'
export type { SlackChannelConfig } from './types.js'
```

## 3. Dependencies (`package.json`)

```json
{
  "name": "@openacp/adapter-slack",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest",
    "prepublishOnly": "npm run build"
  },
  "peerDependencies": {
    "@openacp/cli": ">=0.6.0"
  },
  "dependencies": {
    "@slack/bolt": "^4.6.0",
    "@slack/web-api": "^7.0.0"
  },
  "devDependencies": {
    "@openacp/cli": "^0.6.10",
    "typescript": "^5.4.0",
    "vitest": "^3.0.0"
  }
}
```

## 4. Import Rewrites

All Slack files currently import from `../../core/...`. After extraction:

| Current import | New import |
|---|---|
| `from "../../core/index.js"` | `from "@openacp/cli"` |
| `from "../../core/types.js"` | `from "@openacp/cli"` |
| `from "../../core/log.js"` | `from "@openacp/cli"` |
| `from "../../core/file-service.js"` | `from "@openacp/cli"` |
| `from "../../core/config.js"` | N/A (define types locally) |

`SlackChannelConfig` currently re-exported from core config — must be defined directly in plugin `types.ts` with the same Zod schema.

## 5. Changes to OpenACP Core

### `src/main.ts`

Remove the hard-coded Slack block (lines 103-107):

```diff
- } else if (channelName === 'slack') {
-   const { SlackAdapter } = await import('./adapters/slack/adapter.js')
-   const slackConfig = channelConfig as import('./adapters/slack/types.js').SlackChannelConfig
-   core.registerAdapter('slack', new SlackAdapter(core, slackConfig))
-   log.info({ adapter: 'slack' }, 'Adapter registered')
- }
```

Add migration message for users with legacy Slack config (no `adapter` field):

```typescript
} else if (channelName === 'slack' && !channelConfig.adapter) {
  log.error(
    { adapter: 'slack' },
    'Slack adapter has been moved to a plugin. Install it with: openacp plugin install @openacp/adapter-slack\n' +
    'Then add "adapter": "@openacp/adapter-slack" to your slack channel config.'
  )
}
```

### `src/core/config.ts`

Remove `SlackChannelConfig` Zod schema from core config. The Slack channel config will be validated by the plugin itself. Core only validates the generic `ChannelConfig` shape (`enabled`, `adapter`, and pass-through for other fields).

### Delete `src/adapters/slack/`

Remove the entire Slack adapter directory from core.

## 6. User Config Migration

Before (current):
```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "botToken": "xoxb-...",
      "appToken": "xapp-..."
    }
  }
}
```

After:
```json
{
  "channels": {
    "slack": {
      "enabled": true,
      "adapter": "@openacp/adapter-slack",
      "botToken": "xoxb-...",
      "appToken": "xapp-..."
    }
  }
}
```

User must also run:
- **Dev (local, before npm publish):** `openacp plugin install /path/to/slack-plugin`
- **Production (after npm publish):** `openacp plugin install @openacp/adapter-slack`

## 7. Verification

1. **Plugin builds:** `cd slack-plugin && npm install && npm run build` succeeds
2. **Tests pass:** `cd slack-plugin && npm test` — all existing Slack tests pass
3. **Core tests pass:** `cd OpenACP && pnpm test` — no regressions
4. **Integration test:**
   - Install plugin locally: `openacp plugin install ./slack-plugin`
   - Add `"adapter": "@openacp/adapter-slack"` to config
   - Start OpenACP, verify Slack adapter loads and connects
5. **Migration test:** Start with old config (no adapter field), verify friendly error message appears

## 8. Plugin Registry Manifest (prep only)

Create `plugins/openacp--adapter-slack.json` in the `plugin-registry` repo. This file will be committed but the PR to the upstream registry should only be submitted **after** the package is published to npm (CI validates npm existence).

```json
{
  "name": "adapter-slack",
  "displayName": "Slack Adapter",
  "description": "Slack messaging platform adapter for OpenACP",
  "npm": "@openacp/adapter-slack",
  "repository": "https://github.com/EthanMiller0x/slack-plugin",
  "author": { "name": "OpenACP", "github": "Open-ACP" },
  "version": "0.1.0",
  "minCliVersion": "0.6.10",
  "category": "adapter",
  "tags": ["slack", "messaging", "adapter"],
  "icon": "💬",
  "license": "MIT",
  "verified": true
}
```

---

## Files to Modify

### In `slack-plugin` repo (new files):
- `src/index.ts` — adapterFactory export
- `src/adapter.ts` — copy from `OpenACP/src/adapters/slack/adapter.ts`, rewrite imports
- `src/event-router.ts` — copy + rewrite
- `src/channel-manager.ts` — copy + rewrite
- `src/permission-handler.ts` — copy + rewrite
- `src/formatter.ts` — copy + rewrite
- `src/text-buffer.ts` — copy + rewrite
- `src/send-queue.ts` — copy + rewrite
- `src/slug.ts` — copy + rewrite
- `src/utils.ts` — copy + rewrite
- `src/types.ts` — define SlackChannelConfig locally (from core config Zod schema)
- `src/__tests__/*` — copy all 9 test files, rewrite imports
- `package.json`, `tsconfig.json`, `.gitignore`, `README.md`

### In `OpenACP` repo (modifications):
- `src/main.ts` — remove Slack block, add migration message
- `src/core/config.ts` — remove SlackChannelConfig schema
- Delete `src/adapters/slack/` directory

### In `plugin-registry` repo:
- `plugins/openacp--adapter-slack.json` — plugin manifest (commit only, no upstream PR yet)
