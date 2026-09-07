import { describe, expect, test } from "bun:test";
import { validateAppSearch } from "./app-search";

describe("Computer inspection route search", () => {
  test("keeps the session that launched Design Mode", () => {
    expect(
      validateAppSearch({
        inspectSession: "77db3233-b224-409b-9174-280e124a0166",
        embed: "1",
      }),
    ).toEqual({
      inspectSession: "77db3233-b224-409b-9174-280e124a0166",
      embed: true,
    });
  });

  test("drops empty or non-string inspection targets", () => {
    expect(validateAppSearch({ inspectSession: "" })).toEqual({});
    expect(validateAppSearch({ inspectSession: 42 })).toEqual({});
  });
});
