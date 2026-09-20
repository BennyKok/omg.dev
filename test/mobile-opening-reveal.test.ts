import { expect, test } from "bun:test";
import { openingReveal } from "../mobile/src/omg/opening-reveal";
test("reveals after two stable frames; layout changes restart the frame count", () => {
  let next = 0; let revealed = 0;
  const frames = new Map<number, () => void>();
  const tick = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(fn => fn()); };
  const opening = openingReveal(() => { revealed++; }, cb => { frames.set(++next, cb); return next; }, id => { frames.delete(id); });
  tick(); expect(revealed).toBe(0);
  opening.changed(); tick(); expect(revealed).toBe(0);
  tick(); expect(revealed).toBe(1);
  opening.changed(); tick(); expect(revealed).toBe(1); opening.cancel();
});
test("cancelled screens never reveal", () => {
  let revealed = false;
  const opening = openingReveal(() => { revealed = true; }, () => 1, () => {});
  opening.cancel(); expect(revealed).toBe(false);
});

test("a continuous stream has a bounded reveal wait", async () => {
  let revealed = 0;
  const opening = openingReveal(() => { revealed++; }, () => 1, () => {}, 5);
  opening.changed(); opening.changed();
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(revealed).toBe(1); opening.cancel();
});
