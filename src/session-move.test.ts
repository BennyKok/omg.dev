import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import { addManaged, listManaged, patchManaged, resetManagedRegistryForTests } from "./managed.ts";
import { appendCmd, cmdPath, readEntry, writeEntry } from "./aisdk-registry.ts";
import { writeCursor } from "./agents/backends/cmd-tail.ts";
import { moveCommandFileSession, sessionIsMoving, type SessionMoveTarget } from "./session-recovery.ts";
import { handleSessionMove } from "./session-move.ts";

const id = "056c5ddf-16ae-4662-87c2-ecf0500148db";
const nativeId = "467da4f8-c6d2-4b4c-95d9-36b83b49c0a9";
const originalData = PATHS.data;
let root: string;
let target: { cwd: string; project: string; repoRoot: string };
beforeEach(() => {
  const base = join(homedir(), ".cache/lfg/tmp");
  mkdirSync(base, { recursive: true });
  root = mkdtempSync(join(base, "session-move-test-"));
  PATHS.data = join(root, "data");
  resetManagedRegistryForTests();
  mkdirSync(join(root, "source"));
  mkdirSync(join(root, "destination"));
  target = { cwd: join(root, "destination"), project: "destination", repoRoot: join(root, "destination") };
  writeFileSync(join(root, "source", "draft.txt"), "Original draft");
  addManaged({ tmuxName: "lfg-move-test", sessionId: id, nativeSessionId: nativeId,
    agent: "codex-aisdk", runtime: "command-file", cwd: join(root, "source"), project: "",
    createdAt: 1, model: "gpt-5.5", title: "Keep this title", launchState: "running",
    containment: { agentSlice: true, sandbox: "bwrap", egressProxy: false },
  });
  writeEntry({ sessionId: id, threadId: nativeId, agent: "codex", tmuxName: "lfg-move-test",
    cwd: join(root, "source"), harnessPid: process.pid, model: "gpt-5.5", busy: false, createdAt: 1 });
});
afterEach(() => {
  resetManagedRegistryForTests();
  PATHS.data = originalData;
  rmSync(root, { recursive: true, force: true });
});
const ready = async () => true;
const stop = async () => true;

describe("move a managed session", () => {
  test("keeps ids, title, containment and files while relaunching in the new folder", async () => {
    const result = await moveCommandFileSession(id, target, { stop, ready, launch: (entry, owner) => {
      expect(entry.sessionId).toBe(id);
      expect(entry.threadId).toBe(nativeId);
      expect(owner.title).toBe("Keep this title");
      expect(owner.cwd).toBe(target.cwd);
      expect(owner.containment).toEqual({ agentSlice: true, sandbox: "bwrap", egressProxy: false });
      expect(sessionIsMoving(id)).toBe(true);
      expect(sessionIsMoving(nativeId)).toBe(true);
      writeEntry({ ...entry, harnessPid: process.pid });
      return { ok: true, pid: process.pid };
    } });
    expect(result).toEqual({ ok: true, sessionId: id, cwd: target.cwd, project: target.project });
    expect(listManaged()[0]?.cwd).toBe(target.cwd);
    expect(readEntry(id)?.threadId).toBe(nativeId);
    expect(readFileSync(join(root, "source", "draft.txt"), "utf8")).toBe("Original draft");
    expect(sessionIsMoving(id)).toBe(false);
  });

  test("the real launcher receives the new cwd and the original Codex resume id", async () => {
    const capture = join(root, "launch.json");
    const previousCapture = process.env.LFG_TEST_HARNESS_CAPTURE;
    process.env.LFG_TEST_HARNESS_CAPTURE = capture;
    try {
      expect((await moveCommandFileSession(id, target, { stop, ready })).ok).toBe(true);
      const launched = JSON.parse(readFileSync(capture, "utf8"));
      expect(launched.cwd).toBe(target.cwd);
      expect(launched.cmd[launched.cmd.indexOf("--cwd") + 1]).toBe(target.cwd);
      expect(launched.cmd[launched.cmd.indexOf("--resume") + 1]).toBe(nativeId);
      expect(launched.cmd[launched.cmd.indexOf("--key") + 1]).toBe(id);
    } finally {
      if (previousCapture === undefined) delete process.env.LFG_TEST_HARNESS_CAPTURE;
      else process.env.LFG_TEST_HARNESS_CAPTURE = previousCapture;
    }
  });

  test("refuses busy sessions without stopping them", async () => {
    writeEntry({ ...readEntry(id)!, busy: true });
    let stops = 0;
    const result = await moveCommandFileSession(id, target, { stop: async () => { stops++; return true; } });
    expect(result.ok).toBe(false);
    expect(stops).toBe(0);
    expect(listManaged()[0]?.cwd).toBe(join(root, "source"));
  });

  test("does not use an old SDK registry entry to move a native terminal session", async () => {
    patchManaged("lfg-move-test", { agent: "codex", runtime: "tmux" });
    const result = await moveCommandFileSession(id, target, { stop: async () => { throw new Error("must not stop"); } });
    expect(result.ok).toBe(false);
    expect(listManaged()[0]?.cwd).toBe(join(root, "source"));
  });

  test("a stopped harness must use normal resume admission before moving", async () => {
    writeEntry({ ...readEntry(id)!, harnessPid: 0 });
    const result = await moveCommandFileSession(id, target, { stop: async () => { throw new Error("must not stop"); } });
    expect(result.ok).toBe(false);
    expect(listManaged()[0]?.cwd).toBe(join(root, "source"));
  });

  test("does not stop a reused process id from a previous boot", async () => {
    writeEntry({ ...readEntry(id)!, bootId: "previous-boot" });
    const result = await moveCommandFileSession(id, target, { stop: async () => { throw new Error("must not stop"); } });
    expect(result.ok).toBe(false);
    expect(listManaged()[0]?.cwd).toBe(join(root, "source"));
  });

  test("refuses unread commands before stopping", async () => {
    writeCursor(cmdPath(id), 0);
    appendCmd(id, { type: "send", text: "Do this first" });
    const result = await moveCommandFileSession(id, target, { stop: async () => { throw new Error("must not stop"); } });
    expect(result.ok).toBe(false);
  });

  test("refuses a second move under either session id while stopping", async () => {
    await moveCommandFileSession(id, target, {
      stop: async () => {
        expect((await moveCommandFileSession(nativeId, target)).ok).toBe(false);
        return true;
      }, ready, launch: () => ({ ok: true, pid: process.pid }),
    });
    expect(sessionIsMoving(nativeId)).toBe(false);
  });

  test("does not change folders if the old process cannot stop", async () => {
    const result = await moveCommandFileSession(id, target, { stop: async () => false });
    expect(result.ok).toBe(false);
    expect(listManaged()[0]?.cwd).toBe(join(root, "source"));
    expect(listManaged()[0]?.launchState).toBe("running");
  });

  test("restores the original folder and resume handle when launch fails", async () => {
    let calls = 0;
    const result = await moveCommandFileSession(id, target, { stop, ready, launch: (entry, owner) => {
      calls++;
      if (calls === 1) return { ok: false, error: "failed target launch" };
      expect(owner.cwd).toBe(join(root, "source"));
      expect(entry.threadId).toBe(nativeId);
      return { ok: true, pid: process.pid };
    } });
    expect(result.ok).toBe(false);
    expect(calls).toBe(2);
    expect(listManaged()[0]?.cwd).toBe(join(root, "source"));
    expect(listManaged()[0]?.launchState).toBe("running");
    expect(sessionIsMoving(id)).toBe(false);
  });
});

describe("move request handler", () => {
  const request = (body: unknown) => new Request("http://localhost/api/sessions/test/move", {
    method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  });
  const options = () => ({ sessionId: id, tmuxName: "lfg-move-test", repos: [{ ...target, name: "destination" }],
    move: (key: string, folder: SessionMoveTarget) => moveCommandFileSession(key, folder, {
      stop, ready, launch: () => ({ ok: true, pid: process.pid }),
    }),
  });
  test("moves from no project to a listed folder", async () => {
    const response = await handleSessionMove(request({ cwd: target.cwd }), options());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sessionId: id });
    expect(listManaged()[0]?.project).toBe("destination");
  });
  test("moves back to no project", async () => {
    patchManaged("lfg-move-test", target);
    writeEntry({ ...readEntry(id)!, cwd: target.cwd });
    const response = await handleSessionMove(request({ unassigned: true }), {
      ...options(), chatWorkspace: async () => join(root, "source"),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ project: "" });
  });
  test("rejects ambiguous, invalid, unknown and missing destinations", async () => {
    for (const body of [{}, { cwd: 3 }, { cwd: target.cwd, unassigned: true }, { cwd: root }, { unassigned: "true" }]) {
      expect((await handleSessionMove(request(body), options())).status).toBe(400);
    }
    rmSync(target.cwd, { recursive: true });
    expect((await handleSessionMove(request({ cwd: target.cwd }), options())).status).toBe(400);
  });
  test("queued work prevents moving", async () => {
    expect((await handleSessionMove(request({ cwd: target.cwd }), { ...options(), queued: true })).status).toBe(409);
    expect(listManaged()[0]?.cwd).toBe(join(root, "source"));
  });
});
