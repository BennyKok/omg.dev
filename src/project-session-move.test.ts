import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import { addManaged, listManaged, patchManaged, resetManagedRegistryForTests, type ManagedSession } from "./managed.ts";
import { applyPendingProjectMoves, requestProjectSessionMove } from "./project-session-move.ts";
import type { SessionMoveResult, SessionMoveTarget } from "./session-recovery.ts";

const id = "6b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const originalData = PATHS.data;
let root: string;
const repo = { name: "shop", cwd: "/home/u/repos/shop", project: "shop", custom: true };

function chat(patch: Partial<ManagedSession> = {}) {
  addManaged({
    tmuxName: "lfg-chat", sessionId: id, agent: "aisdk", runtime: "command-file",
    cwd: join(root, "chat"), project: "", createdAt: 1, launchState: "running", ...patch,
  });
}
const row = () => listManaged().find((r) => r.tmuxName === "lfg-chat")!;

function recorder(result: (target: SessionMoveTarget) => SessionMoveResult) {
  const calls: Array<{ sessionId: string; target: SessionMoveTarget }> = [];
  const move = async (sessionId: string, target: SessionMoveTarget) => {
    calls.push({ sessionId, target });
    return result(target);
  };
  return { calls, move: move as never };
}
const ok = (t: SessionMoveTarget): SessionMoveResult => ({ ok: true, sessionId: id, cwd: t.cwd, project: t.project });

beforeEach(() => {
  const base = join(homedir(), ".cache/lfg/tmp");
  mkdirSync(base, { recursive: true });
  root = mkdtempSync(join(base, "project-move-test-"));
  PATHS.data = join(root, "data");
  resetManagedRegistryForTests();
});
afterEach(() => {
  PATHS.data = originalData;
  resetManagedRegistryForTests();
  rmSync(root, { recursive: true, force: true });
});

test("a no-project chat moves into the project it created once the turn ends", async () => {
  chat();
  expect(requestProjectSessionMove(id, repo, 5)).toEqual({ status: "after_turn", cwd: repo.cwd, project: "shop" });
  expect(row().pendingProjectMove).toEqual({ cwd: repo.cwd, project: "shop", requestedAt: 5 });

  const spy = recorder(ok);
  let busy = true;
  const deps = { isBusy: async () => busy, move: spy.move, log: () => {} };
  expect(await applyPendingProjectMoves(deps)).toBe(0);
  expect(spy.calls).toHaveLength(0);

  busy = false;
  expect(await applyPendingProjectMoves(deps)).toBe(1);
  expect(spy.calls).toEqual([{ sessionId: id, target: { cwd: repo.cwd, project: "shop", repoRoot: repo.cwd } }]);
  expect(row().pendingProjectMove).toBeUndefined();
});

test("a chat that already has a project, a bot, or a terminal agent is not moved", () => {
  chat({ project: "lfg" });
  expect(requestProjectSessionMove(id, repo)).toMatchObject({ status: "not_moved" });
  patchManaged("lfg-chat", { project: "", botId: "b1" });
  expect(requestProjectSessionMove(id, repo)).toMatchObject({ status: "not_moved" });
  patchManaged("lfg-chat", { botId: undefined, agent: "claude", runtime: "tmux" });
  expect(requestProjectSessionMove(id, repo)).toMatchObject({ status: "not_moved" });
  expect(row().pendingProjectMove).toBeUndefined();
});

test("calls without a known session id move nothing", () => {
  chat();
  expect(requestProjectSessionMove(null, repo)).toBeNull();
  expect(requestProjectSessionMove("00000000-0000-4000-8000-000000000000", repo)).toBeNull();
  expect(row().pendingProjectMove).toBeUndefined();
});

test("a 409 keeps the request; another failure clears it", async () => {
  chat();
  requestProjectSessionMove(id, repo);
  const busy = recorder(() => ({ ok: false, status: 409, error: "Wait for pending agent commands" }));
  await applyPendingProjectMoves({ isBusy: async () => false, move: busy.move, log: () => {} });
  expect(row().pendingProjectMove?.cwd).toBe(repo.cwd);

  const broken = recorder(() => ({ ok: false, status: 502, error: "restart failed" }));
  await applyPendingProjectMoves({ isBusy: async () => false, move: broken.move, log: () => {} });
  expect(row().pendingProjectMove).toBeUndefined();
});

test("a user move before the turn ends wins", async () => {
  chat();
  requestProjectSessionMove(id, repo);
  patchManaged("lfg-chat", { project: "other", cwd: "/home/u/repos/other" });
  const spy = recorder(ok);
  await applyPendingProjectMoves({ isBusy: async () => false, move: spy.move, log: () => {} });
  expect(spy.calls).toHaveLength(0);
  expect(row().pendingProjectMove).toBeUndefined();
});
