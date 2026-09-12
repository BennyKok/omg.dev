import { expect, test } from "bun:test";
import type { OmgSession } from "../packages/protocol/src";
import { observeSessionStatus, patchSessionStatus, SessionStatusState } from "../mobile/src/omg/session-status";

test("partial fleet updates preserve metadata, clear nullable fields, and keep unchanged rows", () => {
  const sessions: OmgSession[] = [{ sessionId: "a", title: "Old", busy: true, cwd: "/repo", model: "model" }, { sessionId: "b" }];
  const next = patchSessionStatus(sessions, [{ sessionId: "a", title: "New" }, { sessionId: "a", busy: false, model: null }]);
  expect(next[0]).toEqual({ sessionId: "a", title: "New", busy: false, cwd: "/repo", model: null });
  expect(next[1]).toBe(sessions[1]);
  expect(patchSessionStatus(next, [{ sessionId: "a", title: undefined }, { sessionId: null }, { sessionId: "unknown" }])).toBe(next);
  expect(sessions[0]!.title).toBe("Old");
});

test("status received during REST wins over that older response", async () => {
  let latest: OmgSession[] = [];
  const state = new SessionStatusState((rows) => { latest = rows; });
  await state.refresh(async () => [{ sessionId: "a", busy: false }]);
  let resolve!: (rows: OmgSession[]) => void;
  const request = state.refresh(() => new Promise((done) => { resolve = done; }));
  await Promise.resolve();
  state.apply([{ sessionId: "a", busy: true }]);
  state.apply([{ sessionId: "a", title: "New" }]);
  resolve([{ sessionId: "a", busy: false, title: "Old" }]);
  await request;
  expect(latest).toEqual([{ sessionId: "a", busy: true, title: "New" }]);
});

test("unknown sessions request one follow-up refresh during an existing load", async () => {
  let latest: OmgSession[] = [];
  const state = new SessionStatusState((rows) => { latest = rows; });
  let calls = 0;
  let resolve!: (rows: OmgSession[]) => void;
  const fetch = async () => ++calls === 1 ? await new Promise<OmgSession[]>((done) => { resolve = done; }) : [{ sessionId: "new", cwd: "/new" }];
  const request = state.refresh(fetch);
  expect(state.refresh(fetch)).toBe(request);
  await Promise.resolve();
  expect(state.apply([{ sessionId: "new", busy: true }])).toBe(true);
  expect(state.apply([{ sessionId: "new", busy: true }])).toBe(false);
  resolve([]);
  await request;
  expect(calls).toBe(2);
  expect(latest[0]!.cwd).toBe("/new");
  expect(latest[0]!.busy).toBe(true);
  expect(state.apply([{ sessionId: "new", busy: false }])).toBe(false);
  state.remove("new");
  expect(latest).toEqual([]);
});

test("failed REST keeps the visible fleet and permits a later retry", async () => {
  let latest: OmgSession[] = [];
  const state = new SessionStatusState((rows) => { latest = rows; });
  await state.refresh(async () => [{ sessionId: "a" }]);
  await expect(state.refresh(async () => { throw new Error("offline"); })).rejects.toThrow("offline");
  expect(latest).toEqual([{ sessionId: "a" }]);
  await state.refresh(async () => []);
  expect(latest).toEqual([]);
});


test("Home polls without status support, slows when live, refreshes unknown rows, and releases observers", () => {
  type Connection = import("../packages/client/src").OmgConnectionState;
  type Row = import("../packages/protocol/src").OmgStatusRow;
  let connection!: (state: Connection) => void;
  let status!: (rows: Row[]) => void;
  let tick!: () => void;
  const refreshes: boolean[] = [];
  const releases: string[] = [];
  let applied = 0;
  const stop = observeSessionStatus({
    live: {
      state: { status: "connecting", attempt: 0 },
      subscribeConnection: (callback) => { connection = callback; callback({ status: "connecting", attempt: 0 }); return () => releases.push("connection"); },
      subscribeStatus: (callback) => { status = callback; return () => releases.push("status"); },
    },
    apply: (rows) => { applied++; return rows.some((row) => row.sessionId === "unknown"); },
    refresh: (quiet) => { refreshes.push(quiet); },
    connectionChanged: () => {},
  }, { start: (callback) => { tick = callback; return () => releases.push("timer"); } });
  expect(refreshes).toEqual([false]);
  connection({ status: "live", attempt: 0 });
  tick(); // A socket alone does not prove status support.
  expect(refreshes).toEqual([false, true, true]);
  status([]); // Empty baseline is valid support.
  for (let i = 0; i < 4; i++) tick();
  expect(refreshes).toHaveLength(3);
  tick(); // One minute reconciles removals that status frames cannot express.
  expect(refreshes).toHaveLength(4);
  status([{ sessionId: "unknown" }]);
  expect(refreshes).toHaveLength(5);
  connection({ status: "reconnecting", attempt: 1 });
  tick();
  expect(refreshes).toHaveLength(6);
  stop(); stop();
  expect(releases).toEqual(["timer", "status", "connection"]);
  tick(); status([]); connection({ status: "live", attempt: 0 });
  expect(refreshes).toHaveLength(6);
  expect(applied).toBe(2);
});
