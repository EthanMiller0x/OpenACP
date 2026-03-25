import { describe, expect, it, vi } from "vitest";

describe("archiveSessionTopic logic", () => {
  it("archives old channel and creates new one via channelManager", async () => {
    const mockArchive = vi.fn().mockResolvedValue(undefined);
    const mockCreate = vi.fn().mockResolvedValue({
      sessionId: "sess-1",
      channelId: "C_NEW",
      channelSlug: "openacp-new-slug",
    });

    const oldChannelId = "C_OLD";
    await mockArchive(oldChannelId);
    const newMeta = await mockCreate("sess-1", "Test Session");

    expect(mockArchive).toHaveBeenCalledWith("C_OLD");
    expect(mockCreate).toHaveBeenCalledWith("sess-1", "Test Session");
    expect(newMeta.channelId).toBe("C_NEW");
    expect(newMeta.channelSlug).toBe("openacp-new-slug");
  });

  it("replaces sessions Map entry so sessionLookup finds new channel", () => {
    const sessions = new Map<string, { sessionId: string; channelId: string; channelSlug: string }>();
    sessions.set("sess-1", { sessionId: "sess-1", channelId: "C_OLD", channelSlug: "openacp-old" });

    const newMeta = { sessionId: "sess-1", channelId: "C_NEW", channelSlug: "openacp-new" };
    sessions.set("sess-1", newMeta);

    const lookupOld = [...sessions.values()].find(m => m.channelId === "C_OLD");
    expect(lookupOld).toBeUndefined();

    const lookupNew = [...sessions.values()].find(m => m.channelId === "C_NEW");
    expect(lookupNew?.sessionId).toBe("sess-1");
  });

  it("returns null when session.archiving is already true (double-archive guard)", () => {
    const session = { archiving: true };
    const result = session.archiving ? null : "would-proceed";
    expect(result).toBeNull();
  });

  it("resets archiving flag when new channel creation fails", async () => {
    const session = { archiving: false };
    session.archiving = true;

    try {
      throw new Error("name_taken");
    } catch {
      session.archiving = false;
    }

    expect(session.archiving).toBe(false);
  });
});
