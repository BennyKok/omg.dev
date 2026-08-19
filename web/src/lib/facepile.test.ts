import { describe, expect, test } from "bun:test";
import { buildFacepile, facepileLabel } from "./facepile";

const benny = { email: "benny@example.com", name: "Benny", avatar: "https://x/benny.webp" };
const angel = { email: "angel@example.com", name: "Angel", avatar: "https://x/angel.webp" };
const cass = { email: "cass@example.com", name: "", avatar: undefined }; // no photo, no name

describe("facepileLabel", () => {
  test("the single-user case", () => {
    expect(facepileLabel([benny])).toBe("Benny");
  });

  test("two members read as a conjunction", () => {
    expect(facepileLabel([benny, angel])).toBe("Benny and Angel");
  });

  test("three+ members get an oxford-comma list", () => {
    expect(facepileLabel([benny, angel, cass])).toBe("Benny, Angel, and cass");
  });

  test("a member with no name falls back to the email's local part", () => {
    expect(facepileLabel([cass])).toBe("cass");
  });

  test("nobody on the machine still gets one coherent label", () => {
    expect(facepileLabel([])).toBe("No one on this machine");
  });
});

describe("buildFacepile", () => {
  test("the single-user case: one visible circle, no overflow", () => {
    const layout = buildFacepile([benny], 4);
    expect(layout.visible).toEqual([benny]);
    expect(layout.overflowCount).toBe(0);
    expect(layout.label).toBe("Benny");
  });

  test("the shared-machine case within the visible cap: no overflow badge", () => {
    const layout = buildFacepile([benny, angel], 4);
    expect(layout.visible.map((m) => m.email)).toEqual(["angel@example.com", "benny@example.com"]);
    expect(layout.overflowCount).toBe(0);
  });

  test("beyond the visible cap: +N overflow, N counts everyone past the cap", () => {
    const dana = { email: "dana@example.com", name: "Dana" };
    const eli = { email: "eli@example.com", name: "Eli" };
    const layout = buildFacepile([benny, angel, cass, dana, eli], 3);
    expect(layout.visible).toHaveLength(3);
    expect(layout.overflowCount).toBe(2);
    // Label still names everyone, independent of how many circles render.
    expect(layout.label).toContain("Eli");
  });

  test("a member with no photo is still included — the caller renders a fallback glyph", () => {
    const layout = buildFacepile([cass], 4);
    expect(layout.visible[0]!.avatar).toBeUndefined();
  });

  test("ordering is deterministic regardless of input order", () => {
    const a = buildFacepile([angel, benny, cass], 4);
    const b = buildFacepile([cass, benny, angel], 4);
    expect(a.visible.map((m) => m.email)).toEqual(b.visible.map((m) => m.email));
  });

  test("empty input never crashes and reports no overflow", () => {
    const layout = buildFacepile([], 4);
    expect(layout.visible).toEqual([]);
    expect(layout.overflowCount).toBe(0);
  });
});
