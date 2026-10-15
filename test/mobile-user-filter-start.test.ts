import { describe, expect, test } from "bun:test";
import { hostedStartUserFilter, newSessionOwner } from "../mobile/src/omg/user-filter-start";

describe("hostedStartUserFilter (phone)", () => {
  const users = [{ email: "itechbenny@gmail.com" }, { email: "lyyluiyanyan@gmail.com" }];

  test("opens a shared Computer on the viewer's own sessions", () => {
    expect(hostedStartUserFilter({ saved: null, viewerEmail: "ITechBenny@gmail.com", users }))
      .toBe("itechbenny@gmail.com");
  });

  test("a saved choice wins", () => {
    expect(hostedStartUserFilter({ saved: "__all", viewerEmail: "itechbenny@gmail.com", users })).toBe("__all");
    expect(hostedStartUserFilter({ saved: "lyyluiyanyan@gmail.com", viewerEmail: "itechbenny@gmail.com", users }))
      .toBe("lyyluiyanyan@gmail.com");
  });

  test("no roster keeps the current filter", () => {
    expect(hostedStartUserFilter({ saved: null, viewerEmail: "itechbenny@gmail.com", users: [] })).toBeNull();
  });
});

describe("newSessionOwner (phone)", () => {
  const users = [{ email: "itechbenny@gmail.com" }, { email: "lyyluiyanyan@gmail.com" }];

  test("a person filter owns the new session", () => {
    expect(newSessionOwner("lyyluiyanyan@gmail.com", users)).toBe("lyyluiyanyan@gmail.com");
    expect(newSessionOwner("LyyLuiYanYan@gmail.com", users)).toBe("lyyluiyanyan@gmail.com");
  });

  test("All and Unassigned name nobody", () => {
    expect(newSessionOwner("__all", users)).toBeUndefined();
    expect(newSessionOwner("__unassigned", users)).toBeUndefined();
  });

  test("an email off the roster is not sent", () => {
    expect(newSessionOwner("gone@example.com", users)).toBeUndefined();
    expect(newSessionOwner("lyyluiyanyan@gmail.com", [])).toBeUndefined();
  });
});
