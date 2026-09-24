import { expect, test } from "bun:test";
import { modelAlias } from "./sessions.ts";

test("the session list keeps pinned Claude versions", () => {
  expect(modelAlias("claude-opus-5-5")).toBe("claude-opus-5-5");
  expect(modelAlias("claude-fable-5-1")).toBe("claude-fable-5-1");
  expect(modelAlias("claude-opus-4-8")).toBe("opus");
  expect(modelAlias("claude-sonnet-4-6")).toBe("sonnet");
});
