import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import { addManaged, listManaged, patchManaged, resetManagedRegistryForTests } from "./managed.ts";
import { handleSessionReparent } from "./session-reparent.ts";
import type { Session } from "./sessions.ts";

const originalData = PATHS.data;
let root: string;
let invalidations: number;
let notices: Array<{ parent: string | null; text: string }>;
let notification: { ok: boolean; error?: string };
const child = "11111111-1111-4111-8111-111111111111";
const parent = "22222222-2222-4222-8222-222222222222";
const nativeParent = "33333333-3333-4333-8333-333333333333";
const grandchild = "44444444-4444-4444-8444-444444444444";

beforeEach(() => {
  const base = join(homedir(), ".cache/lfg/tmp");
  mkdirSync(base, { recursive: true });
  root = mkdtempSync(join(base, "reparent-test-"));
  PATHS.data = join(root, "data");
  resetManagedRegistryForTests();
  invalidations = 0;
  notices = [];
  notification = { ok: true };
  for (const id of [child, parent, grandchild]) {
    addManaged({ tmuxName: id, sessionId: id, agent: "codex-aisdk", runtime: "command-file",
      cwd: root, project: "test", createdAt: 1, launchState: "running", title: `Task ${id.slice(0, 8)}`,
      ...(id === parent ? { nativeSessionId: nativeParent } : {}),
      ...(id === grandchild ? { parentSessionId: child } : {}),
    });
  }
});
afterEach(() => {
  PATHS.data = originalData;
  resetManagedRegistryForTests();
  rmSync(root, { recursive: true, force: true });
});

function sessions(): Session[] {
  return listManaged().map((record) => ({
    ...record, agent: record.agent ?? "codex-aisdk", managed: true,
    sessionId: record.sessionId ?? null, project: record.project ?? "", title: record.title ?? "",
    pid: 1, cmd: "", lastUserText: null, startedAt: 1, transcriptPath: null,
    lastActivityAt: null, last: null, tmuxTarget: null, assignedUser: null, model: null,
    status: "ok", statusReason: null, statusDetail: null,
  }));
}
async function call(body: unknown, rows = sessions(), notifyParent?: (target: Session, text: string) => Promise<{ ok: boolean; error?: string }>) {
  const response = await handleSessionReparent(new Request("http://localhost/api/sessions/reparent", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), {
    sessions: rows,
    invalidate: () => { invalidations++; },
    notifyParent: notifyParent ?? (async (target, text) => {
      // A parent can query its new child as soon as the notice arrives.
      expect(listManaged().find((record) => record.sessionId === child)?.parentSessionId).toBe(parent);
      expect(invalidations).toBe(1);
      notices.push({ parent: target.sessionId, text });
      return notification;
    }),
  });
  return { status: response.status, data: await response.json() as Record<string, unknown> };
}

test("saves both parent IDs, keeps descendants, and notifies the new parent after invalidating the list", async () => {
  const result = await call({ sessionId: child, parentSessionId: nativeParent });
  expect(result).toMatchObject({ status: 200, data: { ok: true, parentSessionId: parent, parentNotified: true } });
  expect(listManaged().find((record) => record.sessionId === child)).toMatchObject({
    parentSessionId: parent, parentNativeSessionId: nativeParent, parentAgent: "codex-aisdk",
  });
  expect(listManaged().find((record) => record.sessionId === grandchild)?.parentSessionId).toBe(child);
  expect(notices).toHaveLength(1);
  expect(notices[0]?.parent).toBe(parent);
  expect(notices[0]?.text).toContain(child);
  expect(notices[0]?.text).toContain("Task 11111111");
});

test("switches an existing parent and does not send duplicate notices on a repeated move", async () => {
  patchManaged(child, { parentSessionId: "old-parent" });
  await call({ sessionId: child, parentSessionId: parent });
  const repeated = await call({ sessionId: child, parentSessionId: nativeParent });
  expect(repeated.data.changed).toBe(false);
  expect(notices).toHaveLength(1);
  expect(invalidations).toBe(1);
});

test("detaches to a root without a notice", async () => {
  patchManaged(child, { parentSessionId: parent, parentNativeSessionId: nativeParent, parentAgent: "codex-aisdk" });
  expect((await call({ sessionId: child, parentSessionId: null })).data.parentSessionId).toBeNull();
  const row = listManaged().find((record) => record.sessionId === child)!;
  expect(row.parentSessionId).toBeUndefined();
  expect(row.parentNativeSessionId).toBeUndefined();
  expect(row.parentAgent).toBeUndefined();
  expect(notices).toHaveLength(0);
  expect(invalidations).toBe(1);
});

test("rejects self-parenting through an alias and cycles through descendants", async () => {
  expect((await call({ sessionId: parent, parentSessionId: nativeParent })).status).toBe(400);
  expect((await call({ sessionId: child, parentSessionId: grandchild })).data.error).toContain("cycle");
  patchManaged(parent, { parentSessionId: nativeParent });
  expect((await call({ sessionId: child, parentSessionId: parent })).data.error).toContain("cycle");
  expect(invalidations).toBe(0);
  expect(notices).toHaveLength(0);
});

test("rejects missing sessions, unmanaged children, and malformed IDs before writing", async () => {
  for (const body of [null, {}, { sessionId: 1 }, { sessionId: child, parentSessionId: 12 }])
    expect((await call(body)).status).toBe(400);
  expect((await call({ sessionId: "missing", parentSessionId: parent })).status).toBe(404);
  expect((await call({ sessionId: child, parentSessionId: "missing" })).status).toBe(404);
  expect((await call({ sessionId: child, parentSessionId: parent }, sessions().map((row) => ({ ...row, managed: false })))).status).toBe(400);
  expect(invalidations).toBe(0);
  expect(notices).toHaveLength(0);
});

test("keeps the saved move and reports a refused or failed parent notice", async () => {
  notification = { ok: false, error: "Parent session unavailable" };
  expect((await call({ sessionId: child, parentSessionId: parent })).data).toMatchObject({
    ok: true, parentNotified: false, notificationError: "Parent session unavailable",
  });
  expect(listManaged().find((record) => record.sessionId === child)?.parentSessionId).toBe(parent);
  patchManaged(child, { parentSessionId: undefined, parentNativeSessionId: undefined });
  expect((await call({ sessionId: child, parentSessionId: parent }, sessions(), async () => {
    throw new Error("Transport stopped");
  })).data).toMatchObject({ ok: true, parentNotified: false, notificationError: "Transport stopped" });
});
