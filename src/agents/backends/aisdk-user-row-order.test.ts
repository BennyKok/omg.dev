import { describe, expect, test } from "bun:test";
import type { SessionMsg } from "../../sessions.ts";
import { AisdkUserRowCommitter } from "./aisdk-session.ts";

function row(id: string, role: "assistant" | "user", text: string): SessionMsg {
  return { id, role, kind: "text", text, ts: 1 };
}

describe("Claude steering row persistence", () => {
  test("commits a mid-stream send after the interrupt marker", () => {
    const committed: SessionMsg[] = [];
    const rows = new AisdkUserRowCommitter((messages) => committed.push(...messages));

    rows.interrupted(true);
    rows.send("steer now");
    rows.sdk([row("partial", "assistant", "partial answer")]);
    rows.sdk([row("marker", "user", "[Request interrupted by user]")]);
    rows.turnEnded();

    expect(committed.map((message) => message.text)).toEqual([
      "partial answer",
      "[Request interrupted by user]",
      "steer now",
    ]);
  });

  test("uses the SDK echo as the one durable steering row", () => {
    const committed: SessionMsg[] = [];
    const rows = new AisdkUserRowCommitter((messages) => committed.push(...messages));

    rows.interrupted(true);
    rows.send("steer now");
    rows.sdk([row("marker", "user", "[Request interrupted by user]")]);
    rows.sdk([row("echo", "user", "steer now")]);
    rows.turnEnded();

    expect(committed.map((message) => message.id)).toEqual(["marker", "echo"]);
  });

  test("keeps an ordinary send immediate", () => {
    const committed: SessionMsg[] = [];
    const rows = new AisdkUserRowCommitter((messages) => committed.push(...messages));

    rows.send("ordinary");

    expect(committed.map((message) => message.text)).toEqual(["ordinary"]);
  });

  test("stamps a deferred steering row after the interrupted turn it now follows", () => {
    const committed: SessionMsg[] = [];
    let clock = 1_000;
    const rows = new AisdkUserRowCommitter((messages) => committed.push(...messages), () => clock);

    rows.interrupted(true);
    rows.send("steer now"); // typed at 1000
    const partial = { ...row("partial", "assistant", "partial answer"), ts: 1_113 };
    const marker = { ...row("marker", "user", "[Request interrupted by user]"), ts: 1_116 };
    clock = 1_100;
    rows.sdk([partial]);
    rows.sdk([marker]);
    rows.turnEnded();

    const steer = committed.find((message) => message.text === "steer now")!;
    // Later than both rows written before it, so a view that orders an
    // arriving row by ts keeps it below the answer it interrupted.
    expect(steer.ts).toBe(1_117);
    expect(steer.ts).toBeGreaterThan(marker.ts!);
    expect(committed.map((message) => message.ts)).toEqual([...committed.map((message) => message.ts)].sort((a, b) => a! - b!));
  });

  test("an interrupt after the turn ended does not hold the next send", () => {
    // A steer races the end of the turn it meant to stop. Nothing is left to
    // interrupt, so its text starts the next turn and is written first: it
    // used to wait for that turn to end and land below its own answer.
    const committed: SessionMsg[] = [];
    const rows = new AisdkUserRowCommitter((messages) => committed.push(...messages));

    rows.interrupted(false);
    rows.send("stop, say ok");
    rows.sdk([row("answer", "assistant", "ok")]);
    rows.turnEnded();

    expect(committed.map((message) => message.text)).toEqual(["stop, say ok", "ok"]);
  });

  test("an answer to an open question is never held behind an interrupt", () => {
    const committed: SessionMsg[] = [];
    const rows = new AisdkUserRowCommitter((messages) => committed.push(...messages));

    rows.interrupted(true);
    rows.send("option two", true);

    expect(committed.map((message) => message.text)).toEqual(["option two"]);
  });

  test("the interrupt closes with its turn", () => {
    const committed: SessionMsg[] = [];
    const rows = new AisdkUserRowCommitter((messages) => committed.push(...messages));

    rows.interrupted(true);
    rows.turnEnded();
    rows.send("next turn");

    expect(committed.map((message) => message.text)).toEqual(["next turn"]);
  });
});
