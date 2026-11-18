import { describe, expect, test } from "bun:test";
import { parseBtwCommand } from "./btw";

describe("parseBtwCommand", () => {
  test("matches bare /btw and /btw with question", () => {
    expect(parseBtwCommand("/btw")).toEqual({ matched: true, question: "" });
    expect(parseBtwCommand("  /BTW   why did sendq probe?  ")).toEqual({
      matched: true,
      question: "why did sendq probe?",
    });
  });

  test("ignores non-btw prompts and prefixes", () => {
    expect(parseBtwCommand("explain /btw")).toEqual({ matched: false });
    expect(parseBtwCommand("/btwsomething")).toEqual({ matched: false });
    expect(parseBtwCommand("/fast on")).toEqual({ matched: false });
  });
});
