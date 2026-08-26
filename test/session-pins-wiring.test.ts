import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const app = readFileSync(join(root, "web", "src", "App.tsx"), "utf8");
const server = readFileSync(join(root, "src", "commands", "serve.ts"), "utf8");

describe("cross-device session pin wiring", () => {
  test("bootstrap carries the server-owned ordered pin list", () => {
    expect(server).toContain("sessionPins: sessionPinsTask");
    expect(server).toContain("sessionPins: boot.sessionPins ?? null");
    expect(app).toContain("setTopPinned(payload.sessionPins ?? [])");
  });

  test("user toggles mutate one session instead of replacing another device's list", () => {
    expect(app).toContain(
      "`/api/session-pins/${encodeURIComponent(sessionId)}`",
    );
    expect(server).toContain('path.match(/^\\/api\\/session-pins\\/([^/]+)$/)');
    expect(server).toContain("setSessionPinned(sessionId, body.pinned)");
  });

  test("the old browser-local reconciliation owner is gone", () => {
    expect(app).not.toContain("retainLivePinnedSessions");
    expect(app).not.toContain('const PINNED_SESSIONS_KEY = "lfg_pinned_sessions"');
  });
});
