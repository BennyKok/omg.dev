import { describe, expect, test } from "bun:test";
import { contentDisposition } from "./artifact-headers.ts";

describe("contentDisposition", () => {
  test("names an ordinary file both ways", () => {
    expect(contentDisposition("attachment", "q3-report.pdf")).toBe(
      `attachment; filename="q3-report.pdf"; filename*=UTF-8''q3-report.pdf`,
    );
    expect(contentDisposition("inline", "notes.txt")).toStartWith("inline; ");
  });

  // The name comes from a path the agent chose. A raw CR/LF here would let it
  // append headers or a body to the response.
  test("cannot inject a header break", () => {
    const header = contentDisposition("attachment", "a\r\nX-Injected: yes\r\n\r\nbody.pdf");
    expect(header).not.toContain("\r");
    expect(header).not.toContain("\n");
    expect(header).not.toContain("X-Injected: yes\r");
  });

  test("cannot escape the quoted filename parameter", () => {
    const header = contentDisposition("attachment", 'evil".pdf');
    // Exactly two quotes: the ones this function opened and closed.
    expect(header.match(/"/g)?.length).toBe(2);
    expect(contentDisposition("attachment", "back\\slash.pdf")).not.toContain("\\");
  });

  test("carries a non-ASCII name in filename* and degrades the ASCII copy", () => {
    const header = contentDisposition("attachment", "報告.pdf");
    expect(header).toContain(`filename="__.pdf"`);
    expect(header).toContain(`filename*=UTF-8''${encodeURIComponent("報告.pdf")}`);
  });

  test("never emits an empty ASCII filename", () => {
    expect(contentDisposition("attachment", "")).toContain(`filename="file"`);
    expect(contentDisposition("attachment", "\u0000\u0001")).toContain(`filename="__"`);
    // Whitespace is printable ASCII but is not a name.
    expect(contentDisposition("attachment", "   ")).toContain(`filename="file"`);
  });

  test("bounds a hostile length", () => {
    const header = contentDisposition("attachment", "a".repeat(5000));
    expect(header.length).toBeLessThan(600);
  });
});
