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
});
