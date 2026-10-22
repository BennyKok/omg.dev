// The open session page is keyed by the session id in the URL. On 2026-10-22 a
// phone went back to Create while the agent was publishing: the chat moved into
// its new project (src/project-session-move.ts), the agent restarted, and for a
// few seconds no list named the session. These tests fail if a project change,
// or that short gap, closes the page, and if a session that really ended keeps
// its page open.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
const { useOpenSession } = await import("./open-session");

type Row = { sessionId: string; project: string };
const SID = "46cf9e62-1068-4a2d-9fce-5bae2c86157b";
const GRACE = 40;

let ui: Mounted;
let shown: Row | null = null;
let closes = 0;
let refreshes = 0;
// What the next refresh "reads from the server". The test then re-renders
// with that list, the way App's refreshSessions sets `sessions`.
let onRefresh: () => Promise<void> = async () => {};

function Probe({
  openSessionId,
  liveSessions,
  shippedReview = null,
}: {
  openSessionId: string | null;
  liveSessions: Row[];
  shippedReview?: Row | null;
}) {
  shown = useOpenSession({
    openSessionId,
    liveSessions,
    shippedReview,
    onRefresh: () => {
      refreshes += 1;
      return onRefresh();
    },
    onClose: () => {
      closes += 1;
    },
    graceMs: GRACE,
  });
  return null;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  ui = mount();
  shown = null;
  closes = 0;
  refreshes = 0;
  onRefresh = async () => {};
});
afterEach(() => ui.cleanup());

test("a session stays open when it moves into a new project", async () => {
  ui.render(<Probe openSessionId={SID} liveSessions={[{ sessionId: SID, project: "" }]} />);
  expect(shown?.project).toBe("");

  // The agent restarts in the new folder: the list does not name the session.
  ui.render(<Probe openSessionId={SID} liveSessions={[{ sessionId: "other", project: "" }]} />);
  expect(shown?.sessionId).toBe(SID);

  // It is back, now in the new project, before the grace period ends.
  await ui.flushAsync(() => wait(GRACE / 2));
  ui.render(<Probe openSessionId={SID} liveSessions={[{ sessionId: SID, project: "fruit-catcher" }]} />);
  expect(shown?.project).toBe("fruit-catcher");

  await ui.flushAsync(() => wait(GRACE * 3));
  expect(closes).toBe(0);
  expect(shown?.sessionId).toBe(SID);
});

test("a gap that a fresh list read answers does not close the page", async () => {
  ui.render(<Probe openSessionId={SID} liveSessions={[{ sessionId: SID, project: "" }]} />);
  ui.render(<Probe openSessionId={SID} liveSessions={[{ sessionId: "other", project: "" }]} />);
  onRefresh = async () => {
    ui.render(<Probe openSessionId={SID} liveSessions={[{ sessionId: SID, project: "fruit-catcher" }]} />);
  };
  await ui.flushAsync(() => wait(GRACE * 3));
  expect(refreshes).toBe(1);
  expect(closes).toBe(0);
  expect(shown?.project).toBe("fruit-catcher");
});

test("a session that has really ended closes its page after a fresh read", async () => {
  ui.render(<Probe openSessionId={SID} liveSessions={[{ sessionId: SID, project: "" }]} />);
  ui.render(<Probe openSessionId={SID} liveSessions={[{ sessionId: "other", project: "" }]} />);
  await ui.flushAsync(() => wait(GRACE * 3));
  expect(refreshes).toBe(1);
  expect(closes).toBe(1);
});

test("a cold deep link does not close before the first list arrives", async () => {
  ui.render(<Probe openSessionId={SID} liveSessions={[]} />);
  await ui.flushAsync(() => wait(GRACE * 3));
  expect(closes).toBe(0);
});

test("a shipped session opened for review stays open though it is not live", async () => {
  const review = { sessionId: SID, project: "fruit-catcher" };
  ui.render(<Probe openSessionId={SID} liveSessions={[{ sessionId: "other", project: "" }]} shippedReview={review} />);
  expect(shown).toBe(review);
  await ui.flushAsync(() => wait(GRACE * 3));
  expect(closes).toBe(0);
});
