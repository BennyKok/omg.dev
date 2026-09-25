/** A just-created session's opener survives an empty first answer. */
import { expect, test } from "bun:test";
import { keepOpener } from "../src/omg/use-transcript-page";

const opener = [{ id: "local-create-s1", text: "Explain this error." }];

test("an empty answer keeps the local opener", () => {
  expect(keepOpener(opener, [])).toBe(opener);
});

test("a real answer replaces the opener", () => {
  const real = [{ id: "m1", text: "Explain this error." }];
  expect(keepOpener(opener, real)).toBe(real);
});

test("an empty answer still clears a transcript that is not just the opener", () => {
  const loaded = [{ id: "m1", text: "hi" }];
  expect(keepOpener(loaded, [])).toEqual([]);
});
