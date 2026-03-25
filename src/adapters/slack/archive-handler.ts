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
