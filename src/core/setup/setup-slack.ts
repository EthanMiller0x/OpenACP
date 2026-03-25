// src/core/setup/setup-slack.ts
import fs from "node:fs";
import * as path from "node:path";
import * as clack from "@clack/prompts";
import type { ConfigManager, SlackChannelConfig } from "../config.js";
import { expandHome } from "../config.js";
import { guardCancel, ok, fail, warn, dim, c, step } from "./helpers.js";

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

// --- Setup wizard ---

export async function setupSlack(opts?: {
  existing?: Partial<SlackChannelConfig>;
  stepNum?: number;
  totalSteps?: number;
}): Promise<{ slackConfig: SlackChannelConfig; speechConfig: { stt?: { provider: string; apiKey: string }; tts?: { provider: string; voice?: string } } }> {
  const { existing: existingConfig, stepNum, totalSteps } = opts ?? {};

  if (stepNum != null && totalSteps != null) {
    console.log(step(stepNum, totalSteps, "Slack"));
  }

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

  const slackConfig: SlackChannelConfig = {
    enabled: true,
    adapter: "slack",
    botToken,
    appToken,
    signingSecret,
    allowedUserIds,
    channelPrefix,
    autoCreateSession: true,
    ...(notificationChannelId ? { notificationChannelId } : {}),
  };

  console.log("");
  console.log(ok("Slack adapter configured"));
  console.log(dim("  Note: autoCreateSession is enabled by default."));
  console.log(dim("  To disable: openacp config set channels.slack.autoCreateSession false"));

  return { slackConfig, speechConfig };
}

// --- Scope upgrade ---

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
