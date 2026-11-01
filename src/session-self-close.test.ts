import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import { addManaged, listManaged, patchManaged, resetManagedRegistryForTests, type ManagedSession } from "./managed.ts";
import {
  SELF_CLOSE_GRACE_MS,
  SELF_CLOSE_MAX_WAIT_MS,
  applyPendingSelfCloses,
  cancelSelfClose,
  requestSelfClose,
} from "./session-self-close.ts";

const id = "6b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const native = "11111111-2222-4333-8444-555555555555";
const other = "99999999-2222-4222-8222-222222222222";
const originalData = PATHS.data;
let root: string;

function session(patch: Partial<ManagedSession> = {}) {
  addManaged({
    tmuxName: "lfg-self", sessionId: id, nativeSessionId: native, agent: "claude", runtime: "tmux",
    cwd: join(root, "work"), createdAt: 1, launchState: "running", ...patch,
  });
}
const row = () => listManaged().find((r) => r.tmuxName === "lfg-self")!;

function harness(start = 1_000) {
  let clock = start;
  let busy: boolean | null = true;
  const closed: string[] = [];
  return {
    closed,
    setBusy: (value: boolean | null) => { busy = value; },
    advance: (ms: number) => { clock += ms; },
    deps: {
      isBusy: async () => busy,
      close: async (sessionId: string) => { closed.push(sessionId); return { ok: true }; },
      now: () => clock,
      log: () => {},
    },
  };
}

beforeEach(() => {
  const base = join(homedir(), ".cache/lfg/tmp");
  mkdirSync(base, { recursive: true });
  root = mkdtempSync(join(base, "self-close-test-"));
  PATHS.data = join(root, "data");
  resetManagedRegistryForTests();
});
afterEach(() => {
  PATHS.data = originalData;
  resetManagedRegistryForTests();
  rmSync(root, { recursive: true, force: true });
});

test("a session that closes itself is closed only after its turn ends", async () => {
  session();
  expect(requestSelfClose(id, id, 1_000)).toEqual({ status: "after_turn" });
  expect(row().pendingSelfClose).toEqual({ requestedAt: 1_000 });

  const h = harness();
  h.setBusy(false);
  // Inside the grace window the tool result and final reply are still landing.
  expect(await applyPendingSelfCloses(h.deps)).toBe(0);

  h.advance(SELF_CLOSE_GRACE_MS);
  h.setBusy(true);
  expect(await applyPendingSelfCloses(h.deps)).toBe(0);
  expect(h.closed).toEqual([]);

  h.setBusy(false);
  expect(await applyPendingSelfCloses(h.deps)).toBe(1);
  expect(h.closed).toEqual([id]);
  expect(row().pendingSelfClose).toBeUndefined();
});

test("the caller is matched by either id, and closing another session is not deferred", () => {
  session();
  expect(requestSelfClose(native, id)).toEqual({ status: "after_turn" });
  patchManaged("lfg-self", { pendingSelfClose: undefined });
  expect(requestSelfClose(id, native)).toEqual({ status: "after_turn" });
  patchManaged("lfg-self", { pendingSelfClose: undefined });

  expect(requestSelfClose(id, other)).toBeNull();
  expect(requestSelfClose(null, id)).toBeNull();
  expect(requestSelfClose(other, id)).toBeNull();
  expect(row().pendingSelfClose).toBeUndefined();
});

test("a bot conversation cannot close itself", () => {
  session({ botId: "bot_one" });
  expect(requestSelfClose(id, id)).toMatchObject({ status: "refused" });
  patchManaged("lfg-self", { botId: undefined, persistent: true });
  expect(requestSelfClose(id, id)).toMatchObject({ status: "refused" });
  expect(row().pendingSelfClose).toBeUndefined();
});

test("a message from the person cancels the pending close", async () => {
  session();
  requestSelfClose(id, id, 1_000);
  expect(cancelSelfClose("lfg-self")).toBe(true);
  expect(cancelSelfClose("lfg-self")).toBe(false);

  const h = harness(1_000 + SELF_CLOSE_GRACE_MS);
  h.setBusy(false);
  expect(await applyPendingSelfCloses(h.deps)).toBe(0);
  expect(h.closed).toEqual([]);
});

test("a turn that never ends drops the request and leaves the session open", async () => {
  session();
  requestSelfClose(id, id, 1_000);
  const h = harness(1_000 + SELF_CLOSE_MAX_WAIT_MS + 1);
  expect(await applyPendingSelfCloses(h.deps)).toBe(0);
  expect(row().pendingSelfClose).toBeUndefined();
  h.setBusy(false);
  expect(await applyPendingSelfCloses(h.deps)).toBe(0);
  expect(h.closed).toEqual([]);
});

test("a session that is already gone just clears its request", async () => {
  session();
  requestSelfClose(id, id, 1_000);
  const h = harness(1_000 + SELF_CLOSE_GRACE_MS);
  h.setBusy(null);
  expect(await applyPendingSelfCloses(h.deps)).toBe(0);
  expect(h.closed).toEqual([]);
  expect(row().pendingSelfClose).toBeUndefined();
});
