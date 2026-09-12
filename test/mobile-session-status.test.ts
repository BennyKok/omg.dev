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
  expect(state.apply([{ sessionId: "new", busy: true }])).toEqual({ unknown: true, settled: false });
  expect(state.apply([{ sessionId: "new", busy: true }])).toEqual({ unknown: false, settled: false });
  resolve([]);
  await request;
  expect(calls).toBe(2);
  expect(latest[0]!.cwd).toBe("/new");
  expect(latest[0]!.busy).toBe(true);
  // Known and finishing: no hole in the list, but the per-viewer read state
  // it may have just earned only comes back from REST. See `settled`.
  expect(state.apply([{ sessionId: "new", busy: false }])).toEqual({ unknown: false, settled: true });
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
    apply: (rows) => { applied++; return { unknown: rows.some((row) => row.sessionId === "unknown"), settled: false }; },
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


test("a finished turn refetches the list once per burst, a chatty turn never does", async () => {
  // Status frames carry no per-viewer unread (src/session-reads.ts stamps it
  // on /api/sessions), so a settled session has to pull REST — but a session
  // mid-turn emits frames constantly and must not cost a request each time.
  type Row = import("../packages/protocol/src").OmgStatusRow;
  let status!: (rows: Row[]) => void;
  const refreshes: boolean[] = [];
  const live = {
    state: { status: "live" as const, attempt: 0 },
    subscribeConnection: () => () => {},
    subscribeStatus: (callback: (rows: Row[]) => void) => { status = callback; return () => {}; },
  };
  const settled = { unknown: false, settled: true };
  const stop = observeSessionStatus({
    live,
    apply: () => settled,
    refresh: (quiet) => { refreshes.push(quiet); },
    connectionChanged: () => {},
    settleRefreshMs: 20,
  }, { start: () => () => {} });
  expect(refreshes).toEqual([false]);
  status([{ sessionId: "a", busy: false }]);
  status([{ sessionId: "b", busy: false }]);
  status([{ sessionId: "c", busy: false }]);
  expect(refreshes).toEqual([false]); // Held, not dropped.
  await Bun.sleep(60);
  expect(refreshes).toEqual([false, true]); // One quiet refresh for the burst.
  stop();
});

test("nothing to settle, and nothing to refetch", async () => {
  type Row = import("../packages/protocol/src").OmgStatusRow;
  let status!: (rows: Row[]) => void;
  const refreshes: boolean[] = [];
  const stop = observeSessionStatus({
    live: {
      state: { status: "live" as const, attempt: 0 },
      subscribeConnection: () => () => {},
      subscribeStatus: (callback: (rows: Row[]) => void) => { status = callback; return () => {}; },
    },
    apply: () => ({ unknown: false, settled: false }),
    refresh: (quiet) => { refreshes.push(quiet); },
    connectionChanged: () => {},
    settleRefreshMs: 20,
  }, { start: () => () => {} });
  status([{ sessionId: "a", busy: true }]);
  await Bun.sleep(60);
  expect(refreshes).toEqual([false]);
  stop();
});

test("a stopped observer never wakes up to fetch", async () => {
  type Row = import("../packages/protocol/src").OmgStatusRow;
  let status!: (rows: Row[]) => void;
  const refreshes: boolean[] = [];
  const stop = observeSessionStatus({
    live: {
      state: { status: "live" as const, attempt: 0 },
      subscribeConnection: () => () => {},
      subscribeStatus: (callback: (rows: Row[]) => void) => { status = callback; return () => {}; },
    },
    apply: () => ({ unknown: false, settled: true }),
    refresh: (quiet) => { refreshes.push(quiet); },
    connectionChanged: () => {},
    settleRefreshMs: 20,
  }, { start: () => () => {} });
  status([{ sessionId: "a", busy: false }]);
  stop(); // Home blurred or backgrounded with a settle window open.
  await Bun.sleep(60);
  expect(refreshes).toEqual([false]);
});

test("a missing row still refetches at once, ahead of any settle window", () => {
  type Row = import("../packages/protocol/src").OmgStatusRow;
  let status!: (rows: Row[]) => void;
  const refreshes: boolean[] = [];
  const stop = observeSessionStatus({
    live: {
      state: { status: "live" as const, attempt: 0 },
      subscribeConnection: () => () => {},
      subscribeStatus: (callback: (rows: Row[]) => void) => { status = callback; return () => {}; },
    },
    apply: () => ({ unknown: true, settled: true }),
    refresh: (quiet) => { refreshes.push(quiet); },
    connectionChanged: () => {},
    settleRefreshMs: 20,
  }, { start: () => () => {} });
  status([{ sessionId: "new", busy: false }]);
  expect(refreshes).toEqual([false, true]);
  stop();
});
