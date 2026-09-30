import { describe, expect, test } from "bun:test";
import { hostedStartUserFilter } from "../mobile/src/omg/user-filter-start";

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
