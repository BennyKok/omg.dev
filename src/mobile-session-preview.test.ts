import { describe, expect, test } from "bun:test";

import { sessionPreview } from "../mobile/src/omg/session-preview";

describe("mobile sessionPreview", () => {
  test("skips tool output and falls back to user prose", () => {
    expect(
      sessionPreview({
        last: { kind: "tool_result", text: "thousands of log lines" },
        lastUserText: "Fix the download path",
      }),
    ).toBe("Fix the download path");
  });

  test("removes fenced code from a text turn", () => {
    expect(
      sessionPreview({
        last: { kind: "text", text: "Fixed.\n```ts\nconst value = 1;\n```\nVerified." },
      }),
    ).toBe("Fixed. Verified.");
  });
});
