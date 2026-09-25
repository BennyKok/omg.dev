import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { settledParagraphs as web } from "../web/src/lib/paragraph-stream";
import { settledParagraphs as mobile } from "../mobile/src/omg/paragraph-stream";

for (const [name, settledParagraphs] of [["web", web], ["mobile", mobile]] as const) {
  describe(`settledParagraphs (${name})`, () => {
    test("holds a paragraph until it ends", () => {
      expect(settledParagraphs("Hello wor")).toBe("");
      expect(settledParagraphs("Hello world.\nSecond line")).toBe("");
      expect(settledParagraphs("Hello world.\n\nNext para")).toBe("Hello world.");
      expect(settledParagraphs("One.\n\nTwo.\n\nThr")).toBe("One.\n\nTwo.");
    });

    test("headings, list items and table rows complete at their newline", () => {
      expect(settledParagraphs("## Plan\n- one\n- two\n- thr")).toBe("## Plan\n- one\n- two");
      expect(settledParagraphs("1. a\n2) b\n")).toBe("1. a\n2) b");
      expect(settledParagraphs("| a | b |\n|---|---|\n| 1 | 2")).toBe("| a | b |\n|---|---|");
    });

    test("code fences grow line by line and ignore blank-line rules", () => {
      const open = "Run:\n\n```ts\nconst a = 1;\n\nconst b";
      expect(settledParagraphs(open)).toBe("Run:\n\n```ts\nconst a = 1;");
      const closed = "```\n- not a list\n```\nAfter tex";
      expect(settledParagraphs(closed)).toBe("```\n- not a list\n```");
      // A shorter or different marker does not close the fence.
      expect(settledParagraphs("````\n```\nx\n")).toBe("````\n```\nx");
      expect(settledParagraphs("~~~\n```\n\nstill code\n")).toBe("~~~\n```\n\nstill code");
    });

    test("a prefix of the draft maps to the same string", () => {
      const full = "First paragraph here.\n\nSecond one is long";
      const seen = new Set<string>();
      for (let i = 0; i <= full.length; i++) seen.add(settledParagraphs(full.slice(0, i)));
      expect([...seen]).toEqual(["", "First paragraph here."]);
    });
  });
}

test("web and mobile copies stay identical", () => {
  const strip = (path: string) =>
    readFileSync(join(import.meta.dir, "..", path), "utf8").replace(/^\/\/ Kept in sync with .*$/m, "");
  expect(strip("mobile/src/omg/paragraph-stream.ts")).toBe(strip("web/src/lib/paragraph-stream.ts"));
});
