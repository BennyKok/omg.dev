// Transcript find: mapping a server search hit onto a virtualized row.
//
// Virtualizing the transcript (commit 38a0b1a) took the browser's own Ctrl+F
// away: only about 45 of ~1282 rows are in the DOM, so native find reaches
// roughly 6.5% of a loaded transcript from the bottom and 2% of the rows at
// the tail. The replacement asks the server
// (`POST /api/sessions/:id/transcript/search`) which MESSAGES match, and this
// module turns each of those message ids into the ROW index the virtualizer
// scrolls to.
//
// The two are not the same thing, which is the whole reason this is a separate,
// tested unit rather than one `indexByKey.get(id)` call:
//
//   - a run of tool calls collapses into ONE `tools` row whose key is only the
//     FIRST member's id, so a hit on the fourth tool_use in the run has no key
//     of its own;
//   - a display/publish tool and the artifact it produced collapse into one
//     `artifact_tool` row, and either half can be the hit;
//   - the focused ("user-lfg-output") view rewrites an id to `${id}:display`,
//     while the server still reports the raw id;
//   - a hit can be in a message the client has not paged in yet, which has no
//     row at all and must be reported rather than silently dropped.

import type { ChatRenderItem, ChatRenderMessage } from "./chat-render-items";

/** One hit as `POST /api/sessions/:id/transcript/search` returns it. */
export type TranscriptFindHit = {
  messageId: string;
  role: string;
  kind: string;
  ts: number | null;
  snippet: string;
  offset: number;
};

export type TranscriptSearchResponse = {
  id: string;
  query: string;
  /** How many hits this page carries. */
  total: number;
  /** How many messages match in total. Greater than `total` when clipped. */
  matchTotal: number;
  scanned: number;
  truncated: boolean;
  results: TranscriptFindHit[];
};

/**
 * The focused transcript view republishes an omg_output tool call as a plain
 * assistant message under a derived id. The server never saw that id, so the
 * map has to answer to the original as well.
 */
const DISPLAY_SUFFIX = ":display";

/**
 * Every message id that is currently on screen, mapped to the row that draws
 * it. Built from the same `items` array the virtualizer is counting, so a row
 * index out of here is always a valid `scrollToIndex` argument.
 *
 * First writer wins: ids are unique in a transcript, and pinning the first
 * occurrence keeps the answer stable when a duplicate slips through (a pending
 * echo alongside its delivered row, for instance).
 */
export function buildFindRowIndex<T extends ChatRenderMessage>(
  items: ChatRenderItem<T>[],
): Map<string, number> {
  const map = new Map<string, number>();
  const register = (id: string | null | undefined, index: number) => {
    if (!id) return;
    if (!map.has(id)) map.set(id, index);
    if (id.endsWith(DISPLAY_SUFFIX)) {
      const base = id.slice(0, -DISPLAY_SUFFIX.length);
      if (base && !map.has(base)) map.set(base, index);
    }
  };
  items.forEach((item, index) => {
    if (item.type === "msg") {
      register(item.message.id, index);
      return;
    }
    if (item.type === "artifact_tool") {
      // Either half can be the hit: the tool call carries the prompt text, the
      // artifact message carries the caption.
      register(item.tool.id, index);
      register(item.message.id, index);
      return;
    }
    // A collapsed run. Every member has to resolve to the pill, or a hit on
    // anything but the first tool call in the run looks unloaded.
    for (const member of item.items) register(member.id, index);
  });
  return map;
}

/**
 * Where a hit lives, or why it has no row.
 *
 * `unloaded` is a real state, not a failure: the transcript pages backwards
 * from the tail, so a hit older than the loaded window genuinely has no row
 * yet and the caller has to page until it appears.
 */
export type FindHitLocation =
  | { status: "row"; index: number }
  | { status: "unloaded" };

export function findHitRowIndex(
  rowIndex: Map<string, number>,
  hit: Pick<TranscriptFindHit, "messageId">,
): FindHitLocation {
  const index = rowIndex.get(hit.messageId);
  return index == null ? { status: "unloaded" } : { status: "row", index };
}

/**
 * Next/previous with wraparound, which is what a find bar does at either end.
 * Returns 0 for an empty list so the caller never indexes past it.
 */
export function stepFindHit(count: number, current: number, delta: number): number {
  if (count <= 0) return 0;
  return ((current + delta) % count + count) % count;
}

/**
 * The same tokenization the server applies (`searchTerms` in
 * src/transcript-index.ts): whitespace split, quotes stripped, at most 12
 * terms. Kept in step so the client highlights exactly what the server matched
 * — a term the server ignored must not be painted as a hit.
 */
export function transcriptFindTerms(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/"/g, ""))
    .filter(Boolean)
    .slice(0, 12);
}

/**
 * Half-open [start, end) ranges of every term occurrence in `text`, merged and
 * sorted. Case-insensitive, matching the server's LIKE. Overlapping terms
 * ("bug" and "debug") merge into one range so the highlight never paints twice
 * over the same characters.
 */
export function findMatchRanges(text: string, terms: string[]): Array<[number, number]> {
  if (!text || !terms.length) return [];
  const folded = text.toLowerCase();
  const raw: Array<[number, number]> = [];
  for (const term of terms) {
    const needle = term.toLowerCase();
    if (!needle) continue;
    let from = folded.indexOf(needle);
    while (from >= 0) {
      raw.push([from, from + needle.length]);
      from = folded.indexOf(needle, from + needle.length);
    }
  }
  if (!raw.length) return [];
  raw.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [raw[0]];
  for (const [start, end] of raw.slice(1)) {
    const last = merged[merged.length - 1];
    if (start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}
