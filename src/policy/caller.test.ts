import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "../config.ts";
import type { ManagedSession } from "../managed.ts";
import { resolveCaller } from "./caller.ts";
import { createRole } from "./roles.ts";
import { SESSION_TOKEN_HEADER, resetSessionSecretForTests, sessionToken, verifySessionToken } from "./session-token.ts";

let tmp: string;
const originalData = PATHS.data;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "omg-caller-"));
  PATHS.data = tmp;
  resetSessionSecretForTests();
});

afterEach(() => {
  PATHS.data = originalData;
  resetSessionSecretForTests();
  rmSync(tmp, { recursive: true, force: true });
});

function row(patch: Partial<ManagedSession>): ManagedSession {
  return { tmuxName: "t", cwd: "/", createdAt: 1, sessionId: "s1", ...patch };
}

function request(session: string | null, headers: Record<string, string> = {}): Request {
  const url = session ? `http://box/mcp?session=${encodeURIComponent(session)}` : "http://box/mcp";
  return new Request(url, { method: "POST", headers });
}

describe("session tokens", () => {
  test("are stable per session and differ per session", () => {
    const a = sessionToken("s1");
    expect(sessionToken("s1")).toBe(a);
    expect(sessionToken("s2")).not.toBe(a);
    expect(verifySessionToken("s1", a)).toBe(true);
    expect(verifySessionToken("s2", a)).toBe(false);
    expect(verifySessionToken("s1", "")).toBe(false);
  });
});

describe("resolveCaller", () => {
  test("no session claimed: anonymous owner", () => {
    const caller = resolveCaller(request(null), () => undefined);
    expect(caller.sessionId).toBeUndefined();
    expect(caller.role.id).toBe("owner");
  });

  test("a row from before tokens is honoured on the bare query", () => {
    const caller = resolveCaller(request("s1"), () => row({}));
    expect(caller.sessionId).toBe("s1");
    expect(caller.role.id).toBe("owner");
  });

  test("a token-required row needs the token", () => {
    const lookup = () => row({ mcpTokenRequired: true });
    expect(resolveCaller(request("s1"), lookup)).toMatchObject({ sessionId: undefined, downgraded: "missing-token" });
    expect(resolveCaller(request("s1", { [SESSION_TOKEN_HEADER]: "nope" }), lookup)).toMatchObject({
      sessionId: undefined,
      downgraded: "bad-token",
    });
    const good = resolveCaller(request("s1", { [SESSION_TOKEN_HEADER]: sessionToken("s1") }), lookup);
    expect(good.sessionId).toBe("s1");
    expect(good.downgraded).toBeUndefined();
  });

  test("the row's role is resolved, unknown roles fall back to owner", () => {
    const created = createRole({ name: "Marketing" });
    expect(created.ok).toBe(true);
    const withRole = resolveCaller(request("s1"), () => row({ role: "marketing" }));
    expect(withRole.role.id).toBe("marketing");
    const missing = resolveCaller(request("s1"), () => row({ role: "deleted-role" }));
    expect(missing.role.id).toBe("owner");
  });

  test("unknown session id is still passed through as before", () => {
    const caller = resolveCaller(request("ghost"), () => undefined);
    expect(caller.sessionId).toBe("ghost");
    expect(caller.role.id).toBe("owner");
  });
});
