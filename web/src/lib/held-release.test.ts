import { describe, expect, test } from "bun:test";
import { createHeldRelease } from "./held-release";

const a = { id: "a", text: "after that, say done" };
const b = { id: "b", text: "and then this" };

describe("a released held card does not come back", () => {
  test("a frame sent before the delete landed does not redraw it", () => {
    const release = createHeldRelease();
    release.change([a, b], [b]); // Send now on `a`
    expect(release.frame([a, b])).toEqual([b]); // stale frame still lists `a`
    expect(release.frame([b])).toEqual([b]); // the server agrees
    // Settled: if the server ever lists that id again, it is a real row.
    expect(release.frame([a, b])).toEqual([a, b]);
  });

  test("a delete that failed puts the card back", () => {
    const release = createHeldRelease();
    release.change([a], []);
    expect(release.frame([a])).toEqual([]);
    // fail() re-reads the queue and hands the server's list back.
    release.change([], [a]);
    expect(release.frame([a])).toEqual([a]);
  });

  test("a card that is still held is untouched", () => {
    const release = createHeldRelease();
    expect(release.frame([a, b])).toEqual([a, b]);
    release.change([a, b], [{ ...a, text: "edited" }, b]);
    expect(release.frame([a, b])).toEqual([a, b]);
  });
});
