import { expect, test } from "bun:test";
import { TRANSCRIPT_PAGE } from "../mobile/src/omg/transcript-cache";
import { buildTranscriptItems, TranscriptWindow, INITIAL_TRANSCRIPT_ITEMS } from "../mobile/src/omg/transcript-items";

// First-render cache and refresh behaviour are mounted in
// mobile/scripts/transcript-page.native-check.tsx. The recorded performance
// plan covers native layout, opening at the newest row, and reopening.
test("the opening window ends at the newest message without mounting the full fetched page", () => {
  const messages = Array.from({ length: TRANSCRIPT_PAGE }, (_, i) => ({
    id: `m${i}`, role: "assistant" as const, text: `Reply ${i}`,
  }));
  const items = buildTranscriptItems(messages);
  const window = new TranscriptWindow();
  const opening = window.view(items, false);
  expect(opening.items.length).toBe(INITIAL_TRANSCRIPT_ITEMS);
  expect(opening.items.length).toBeLessThan(messages.length);
  expect(opening.items.at(-1)).toBe(items.at(-1));
  expect(opening.hasEarlier).toBe(true);
  const expanded = window.view(items, true);
  expect(expanded.items).toBe(items);
  expect(expanded.hasEarlier).toBe(false);
});
