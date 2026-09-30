import { describe, expect, test } from "bun:test";
import { hostedStartUserFilter } from "../mobile/src/omg/user-filter-start";

describe("hostedStartUserFilter (phone)", () => {
  const users = [{ email: "benny@example.com" }, { email: "angel@example.com" }];

  test("opens a shared Computer on the viewer's own sessions", () => {
    expect(hostedStartUserFilter({ saved: null, viewerEmail: "ITechBenny@gmail.com", users }))
      .toBe("benny@example.com");
  });

  test("a saved choice wins", () => {
    expect(hostedStartUserFilter({ saved: "__all", viewerEmail: "benny@example.com", users })).toBe("__all");
    expect(hostedStartUserFilter({ saved: "angel@example.com", viewerEmail: "benny@example.com", users }))
      .toBe("angel@example.com");
  });

  test("no roster keeps the current filter", () => {
    expect(hostedStartUserFilter({ saved: null, viewerEmail: "benny@example.com", users: [] })).toBeNull();
  });
});
