import { describe, expect, test } from "bun:test";
import { hostedStartUserFilter, newSessionOwner } from "../mobile/src/omg/user-filter-start";

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

describe("newSessionOwner (phone)", () => {
  const users = [{ email: "benny@example.com" }, { email: "angel@example.com" }];

  test("a person filter owns the new session", () => {
    expect(newSessionOwner("angel@example.com", users)).toBe("angel@example.com");
    expect(newSessionOwner("LyyLuiYanYan@gmail.com", users)).toBe("angel@example.com");
  });

  test("All and Unassigned name nobody", () => {
    expect(newSessionOwner("__all", users)).toBeUndefined();
    expect(newSessionOwner("__unassigned", users)).toBeUndefined();
  });

  test("an email off the roster is not sent", () => {
    expect(newSessionOwner("gone@example.com", users)).toBeUndefined();
    expect(newSessionOwner("angel@example.com", [])).toBeUndefined();
  });
});
