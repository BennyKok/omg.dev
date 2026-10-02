import { describe, expect, test } from "bun:test";
import { COMPUTER_START_FALLBACK, computerStartErrorMessage } from "./computer-start-error";

describe("computerStartErrorMessage", () => {
  test("shows the server sentence instead of raw JSON", () => {
    expect(computerStartErrorMessage('{"error":"The Computer could not start its browser. Try again."}'))
      .toBe("The Computer could not start its browser. Try again.");
  });

  test("keeps a plain text body", () => {
    expect(computerStartErrorMessage("no Chrome binary found")).toBe("no Chrome binary found");
  });

  test("falls back for an empty body, JSON without an error, or an HTML page", () => {
    expect(computerStartErrorMessage("")).toBe(COMPUTER_START_FALLBACK);
    expect(computerStartErrorMessage('{"ok":false}')).toBe(COMPUTER_START_FALLBACK);
    expect(computerStartErrorMessage("<html><body>502 Bad Gateway</body></html>")).toBe(COMPUTER_START_FALLBACK);
  });
});
