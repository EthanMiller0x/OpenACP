import { describe, expect, it, vi } from "vitest";
import { SlackArchiveHandler } from "./archive-handler.js";

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
