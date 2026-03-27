import * as clack from "@clack/prompts";
import type { Config } from "../config.js";
import type { ConfiguredChannelAction, ChannelId, ChannelStatus } from "./types.js";
import { CHANNEL_META } from "./types.js";
import { guardCancel, ok, c } from "./helpers.js";
import { setupTelegram } from "./setup-telegram.js";
import { setupDiscord } from "./setup-discord.js";
import type { DiscordChannelConfig } from "../../adapters/discord/types.js";
import { listPlugins, loadAdapterFactory, type AdapterFactory } from "../plugin-manager.js";

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

export function getChannelStatuses(config: Config): ChannelStatus[] {
  const statuses: ChannelStatus[] = [];

  for (const [id, meta] of Object.entries(CHANNEL_META) as [ChannelId, typeof CHANNEL_META[ChannelId]][]) {
    const ch = config.channels[id] as Record<string, unknown> | undefined;
    const enabled = ch?.enabled === true;
    const configured = !!ch && Object.keys(ch).length > 1;

    let hint: string | undefined;
    if (id === "telegram" && ch?.botToken && typeof ch.botToken === "string" && ch.botToken !== "YOUR_BOT_TOKEN_HERE") {
      hint = `Chat ID: ${ch.chatId}`;
    }
    if (id === "discord" && ch?.guildId) {
      hint = `Guild: ${ch.guildId}`;
    }

    statuses.push({ id, label: meta.label, configured, enabled, hint });
  }

  return statuses;
}

export function noteChannelStatus(config: Config): void {
  const statuses = getChannelStatuses(config);
  const lines = statuses.map((s) => {
    const status = s.enabled ? "enabled" : s.configured ? "disabled" : "not configured";
    const hintStr = s.hint ? ` — ${s.hint}` : "";
    return `  ${s.label}: ${status}${hintStr}`;
  });

  console.log("");
  console.log(`${c.bold}  Channel status${c.reset}`);
  for (const line of lines) console.log(line);
  console.log("");
}

async function promptConfiguredAction(label: string): Promise<ConfiguredChannelAction> {
  return guardCancel(
    await clack.select({
      message: `${label} already configured. What do you want to do?`,
      options: [
        { value: "modify" as const, label: "Modify settings" },
        { value: "disable" as const, label: "Disable bot" },
        { value: "delete" as const, label: "Delete config" },
        { value: "skip" as const, label: "Skip (leave as-is)" },
      ],
      initialValue: "modify" as const,
    }),
  );
}

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
