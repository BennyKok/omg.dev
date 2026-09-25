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

test("the machine's first user row keeps the opener's row key, so it settles instead of remounting", () => {
  const opener = [{ id: "local-create-null", role: "user", text: "Anything to clean up" }];
  const real = [
    { id: "m1", role: "user", text: "=== omg.dev RUNTIME CONTRACT ===\n...\n=== USER TASK ===\nAnything to clean up" },
    { id: "m2", role: "assistant", text: "Looking." },
  ];
  const settled = keepOpener<{ id: string; role: string; text: string; localKey?: string }>(opener, real);
  expect(settled[0]).toEqual({ ...real[0]!, localKey: "local-create-null" });
  expect(settled[1]).toBe(real[1]!);
});

test("an unrelated answer replaces the opener without borrowing its key", () => {
  const opener = [{ id: "local-create-s1", role: "user", text: "Explain this error." }];
  const real = [{ id: "m1", role: "user", text: "Something else entirely" }];
  expect(keepOpener(opener, real)).toBe(real);
});
