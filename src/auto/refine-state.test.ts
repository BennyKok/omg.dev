// The in-memory state a feedback-driven rewrite publishes while the refine
// route has already answered 202 (see store.ts "in-flight refines").
import { describe, expect, test } from "bun:test";
import { markRefining, refineStatus, settleRefine } from "./store.ts";

describe("refine state", () => {
  test("nothing is in flight for an agent nobody asked about", () => {
    expect(refineStatus("never")).toBeUndefined();
  });

  test("claiming an agent publishes running; a second claim while running is refused", () => {
    expect(markRefining("a")).toBe(true);
    expect(refineStatus("a")?.state).toBe("running");
    expect(markRefining("a")).toBe(false);
  });

  test("settling without an error reads done, and frees the agent for the next rewrite", () => {
    markRefining("b");
    settleRefine("b");
    expect(refineStatus("b")?.state).toBe("done");
    expect(markRefining("b")).toBe(true);
  });

  test("settling with an error keeps the message for the poll to surface", () => {
    markRefining("c");
    settleRefine("c", "refiner produced no output");
    expect(refineStatus("c")).toMatchObject({ state: "failed", error: "refiner produced no output" });
  });
});
