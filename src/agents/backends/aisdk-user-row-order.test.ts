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

    rows.send("steer now", true);
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

    rows.send("steer now", true);
    rows.sdk([row("marker", "user", "[Request interrupted by user]")]);
    rows.sdk([row("echo", "user", "steer now")]);
    rows.turnEnded();

    expect(committed.map((message) => message.id)).toEqual(["marker", "echo"]);
  });

  test("keeps an ordinary send immediate", () => {
    const committed: SessionMsg[] = [];
    const rows = new AisdkUserRowCommitter((messages) => committed.push(...messages));

    rows.send("ordinary", false);

    expect(committed.map((message) => message.text)).toEqual(["ordinary"]);
  });

  test("stamps a deferred steering row after the interrupted turn it now follows", () => {
    const committed: SessionMsg[] = [];
    let clock = 1_000;
    const rows = new AisdkUserRowCommitter((messages) => committed.push(...messages), () => clock);

    rows.send("steer now", true); // typed at 1000
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
});
