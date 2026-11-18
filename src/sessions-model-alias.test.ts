import { expect, test } from "bun:test";
import { modelAlias } from "./sessions.ts";

test("the session list shows the family alias the picker offers", () => {
  expect(modelAlias("claude-opus-5-5")).toBe("opus");
  expect(modelAlias("claude-fable-5-1")).toBe("fable");
  expect(modelAlias("claude-opus-4-8")).toBe("opus");
  expect(modelAlias("claude-sonnet-4-6")).toBe("sonnet");
});
