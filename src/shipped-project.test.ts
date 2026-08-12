import { describe, expect, test } from "bun:test";
import { resolveShipProject } from "./shipped.ts";

const KNOWN = ["lfg", "duet-app", "distributor"];

describe("resolveShipProject", () => {
  test("accepts a label that names a real project", () => {
    expect(resolveShipProject("duet-app", "lfg", KNOWN)).toBe("duet-app");
  });

  test("snaps a real project to its canonical casing", () => {
    expect(resolveShipProject("Duet-App", "lfg", KNOWN)).toBe("duet-app");
  });

  test("ignores an invented label in favour of the posting session's project", () => {
    // omg_ship takes free text, so an agent could file a post under a project
    // that does not exist on this box. A wrong label reads as provenance.
    expect(resolveShipProject("Q3 Roadmap", "lfg", KNOWN)).toBe("lfg");
  });

  test("leaves the post unlabelled rather than guessing", () => {
    expect(resolveShipProject("nonexistent", undefined, KNOWN)).toBeUndefined();
    expect(resolveShipProject(undefined, undefined, KNOWN)).toBeUndefined();
  });

  test("falls back to the session project for blank input", () => {
    expect(resolveShipProject("   ", "distributor", KNOWN)).toBe("distributor");
    expect(resolveShipProject(undefined, "distributor", KNOWN)).toBe("distributor");
  });

  test("still labels a session whose project is not in the picker", () => {
    // Shipping from an unlinked or worktree-backed project must not lose the
    // label — the session's own project is trusted, it just isn't listed.
    expect(resolveShipProject(undefined, "unlisted", KNOWN)).toBe("unlisted");
  });
});
