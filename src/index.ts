export * from './core/index.js'
export { TelegramAdapter } from './adapters/telegram/index.js'
export { AgentCatalog } from "./core/agent-catalog.js";
export { AgentStore } from "./core/agent-store.js";
export type { InstalledAgent, RegistryAgent, AgentListItem } from "./core/types.js";

// Setup helpers for adapter plugins
export { guardCancel, ok, fail, warn, step, dim, c } from './core/setup/helpers.js'

