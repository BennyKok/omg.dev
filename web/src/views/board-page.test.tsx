// The harness installs the DOM globals, so it must be imported before the
// component. See web/src/test-support/render.tsx.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { groupBoard } from "../lib/board-columns";
import type { Session, ShipPost } from "../App";
import type { Question } from "../components/ask-center";

const { BoardView } = await import("./board-page");

function session(over: Partial<Session> & { sessionId: string }): Session {
  return { agent: "claude", startedAt: 1_000, lastActivityAt: 2_000, ...over };
}

const POST: ShipPost = {
  id: "p1",
  rev: 1,
  ts: 9_000,
  firstTs: 9_000,
  title: "Landed the thing",
  summary: "It works.",
  sessionId: "s-shipped",
  agent: "codex",
  project: "lfg",
  mediaItems: [],
};

describe("groupBoard", () => {
  test("sorts sessions by what they need from you", () => {
    const questions: Question[] = [
      { id: "q1", question: "Which branch?", sessionId: "s-ask", createdAt: 5 },
    ];
    const cols = groupBoard({
      sessions: [
        session({ sessionId: "s-ask", busy: true, title: "Asking" }),
        session({ sessionId: "s-blocked", status: "blocked", statusReason: "out_of_credits" }),
        session({ sessionId: "s-busy", busy: true, title: "Busy" }),
        session({ sessionId: "s-idle", busy: false, title: "Idle one" }),
      ],
      questions,
      posts: [POST],
    });
    const byId = Object.fromEntries(cols.map((c) => [c.id, c.cards.map((x) => x.key)]));
    // A pending question outranks `busy`; a blocker does too.
    expect(byId["needs-you"]).toEqual(["session:s-ask", "session:s-blocked"]);
    expect(byId.working).toEqual(["session:s-busy"]);
    expect(byId.idle).toEqual(["session:s-idle"]);
    expect(byId.shipped).toEqual(["post:p1"]);
  });

  test("notes say why a card needs you", () => {
    const cols = groupBoard({
      sessions: [
        session({ sessionId: "s-ask" }),
        session({ sessionId: "s-blocked", status: "blocked", statusReason: "provider_auth" }),
      ],
      questions: [{ id: "q", question: "Deploy   to\nprod?", sessionId: "s-ask", createdAt: 1 }],
      posts: [],
    });
    const notes = cols[0].cards.map((c) => c.note);
    expect(notes).toEqual(["Deploy to prod?", "Provider needs sign-in"]);
  });

  test("newest activity comes first inside a column", () => {
    const cols = groupBoard({
      sessions: [
        session({ sessionId: "old", lastActivityAt: 10 }),
        session({ sessionId: "new", lastActivityAt: 20 }),
      ],
      questions: [],
      posts: [],
    });
    expect(cols[2].cards.map((c) => c.sessionId)).toEqual(["new", "old"]);
  });

  test("skips rows with no session id", () => {
    const cols = groupBoard({
      sessions: [{ sessionId: null } as Session],
      questions: [],
      posts: [],
    });
    expect(cols.every((c) => c.cards.length === 0)).toBe(true);
  });
});

describe("BoardView", () => {
  let ui: Mounted;
  beforeEach(() => {
    ui = mount();
  });
  afterEach(() => ui.cleanup());

  test("renders four columns with counts and opens a card", () => {
    const opened: string[] = [];
    const shipped: string[] = [];
    const columns = groupBoard({
      sessions: [
        session({ sessionId: "s-busy", busy: true, title: "Fix the login bug" }),
        session({ sessionId: "s-idle", title: "Write docs" }),
      ],
      questions: [],
      posts: [POST],
    });
    ui.render(
      <BoardView
        columns={columns}
        onOpenSession={(sid) => opened.push(sid)}
        onOpenShipped={(post) => shipped.push(post.id)}
      />,
    );
    const text = ui.text();
    for (const label of ["Needs you", "Working", "Idle", "Shipped"]) {
      expect(text).toContain(label);
    }
    expect(text).toContain("Fix the login bug");
    expect(text).toContain("Landed the thing");
    expect(text).toContain("Nothing is waiting on you.");
    expect(text).toContain("3 cards");

    const buttons = ui.queryAll("button");
    const busyCard = buttons.find((b) => b.textContent?.includes("Fix the login bug"));
    const shipCard = buttons.find((b) => b.textContent?.includes("Landed the thing"));
    ui.flush(() => busyCard?.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    ui.flush(() => shipCard?.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    expect(opened).toEqual(["s-busy"]);
    expect(shipped).toEqual(["p1"]);
  });
});
