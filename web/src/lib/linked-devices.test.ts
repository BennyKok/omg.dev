import { describe, expect, test } from "bun:test";
import { deviceMentionHint, lastSeenLabel, linkCommand, type LinkedDevice } from "./linked-devices";

const device = (names: string[]): LinkedDevice => ({
  id: "test-mac",
  pairedAt: 0,
  actions: names.map((name) => ({ name, approval: "in-grant" as const })),
});

describe("linked devices helpers", () => {
  test("the picker hint names up to four actions", () => {
    expect(deviceMentionHint(device([]))).toBe("Linked device");
    expect(deviceMentionHint(device(["snap", "logs"]))).toBe("Linked device · snap, logs");
    expect(deviceMentionHint(device(["a", "b", "c", "d", "e", "f"]))).toBe("Linked device · a, b, c, d, +2");
  });

  test("last seen reads in plain units", () => {
    const now = 10_000_000_000;
    expect(lastSeenLabel(undefined, now)).toBe("Never connected");
    expect(lastSeenLabel(now - 5_000, now)).toBe("Connected now");
    expect(lastSeenLabel(now - 3 * 60_000, now)).toBe("Seen 3 min ago");
    expect(lastSeenLabel(now - 5 * 3_600_000, now)).toBe("Seen 5 h ago");
    expect(lastSeenLabel(now - 4 * 86_400_000, now)).toBe("Seen 4 days ago");
  });

  test("the link command falls back to a placeholder without a public address", () => {
    expect(linkCommand({ code: "AB-CD", name: "x", expiresAt: 0, server: null })).toBe(
      "omg device link --server https://<this computer's tailnet name> --code AB-CD",
    );
  });
});
