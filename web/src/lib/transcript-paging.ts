// How much transcript the client asks for, and how much it keeps.
//
// Both are counted in RENDERED ROWS, not in raw messages, because the two are
// not the same number: buildChatRenderItems folds each run of tool_use /
// tool_result / thinking into one row, so 88 raw messages of a tool-heavy turn
// render as three rows. A page and a window measured in messages therefore
// produced an almost empty viewport. The row rule has one definition, in
// src/transcript-rows.ts.
import { transcriptRowWindowStart, type ChatRenderMessage } from "./chat-render-items";

// Rows a transcript page aims for. Two screens of rows on a phone, so the
// first paint is full and the first page back has somewhere to scroll.
export const TRANSCRIPT_PAGE_ROWS = 40;

// Raw messages a page still asks for as its chunk size. The server reads this
// many at a time and keeps reading backward until it has the rows.
export const TRANSCRIPT_PAGE_LIMIT = 80;

// Rows a streaming transcript keeps in memory. The old cap was 80 raw
// messages, which a single tool-heavy turn could fill, and which threw away
// pages the reader had deliberately loaded.
export const LIVE_WINDOW_ROWS = 150;

// Ceiling on the same window in raw messages. A row can hold an unbounded run
// of tool calls, so the row window alone is not a memory bound.
export const LIVE_WINDOW_MAX_MESSAGES = 3000;

// The `deferToolArgs` capability, as this client declares it on HTTP.
//
// The server sends the bare tool name instead of `Name: <json>` and marks the
// message with `toolArgsLen`. The arguments are 1 095 KB of the 1 690 KB a
// tool-heavy session used to send, and nothing shows them until a reader opens
// a pill, so they are fetched one at a time from `toolArgsPath` instead.
//
// It is a query parameter and not a setting: an older bundle simply omits it
// and receives the payload it has always received.
export const DEFER_TOOL_ARGS_PARAM = "deferToolArgs=1";

export function transcriptPagePath(sid: string): string {
  return `/api/sessions/${encodeURIComponent(sid)}/messages?limit=${TRANSCRIPT_PAGE_LIMIT}&rows=${TRANSCRIPT_PAGE_ROWS}&${DEFER_TOOL_ARGS_PARAM}`;
}

export function transcriptOlderPagePath(sid: string, before: number): string {
  return `/api/sessions/${encodeURIComponent(sid)}/messages?page=backward&before=${before}&limit=${TRANSCRIPT_PAGE_LIMIT}&rows=${TRANSCRIPT_PAGE_ROWS}&${DEFER_TOOL_ARGS_PARAM}`;
}

/** Where the arguments of one deferred tool call are fetched from. */
export function toolArgsPath(sid: string, messageId: string): string {
  return `/api/sessions/${encodeURIComponent(sid)}/messages/${encodeURIComponent(messageId)}/tool-args`;
}

/**
 * Trim a live transcript to the window.
 *
 * The old `.slice(-80)` ran on every draft delta and every optimistic send, so
 * a reader who had paged back lost the backlog the moment the agent typed a
 * character. The window is large and counted in rows, so ordinary paging back
 * survives streaming; the message ceiling still bounds memory.
 */
export function windowLiveMessages<T extends ChatRenderMessage>(messages: T[]): T[] {
  // Rows can never exceed messages, so a short list is always inside both
  // bounds and needs no grouping pass.
  if (messages.length <= LIVE_WINDOW_ROWS) return messages;
  const start = Math.max(
    transcriptRowWindowStart(messages, LIVE_WINDOW_ROWS),
    messages.length - LIVE_WINDOW_MAX_MESSAGES,
  );
  return start > 0 ? messages.slice(start) : messages;
}

export type LoadOlderIntent = "none" | "anchored" | "backfill";

// Distance from the top that counts as "the reader is at the top", and the
// slack that decides whether the transcript overflows at all.
const TOP_SLACK_PX = 80;

/**
 * Why (and whether) the transcript should load an older page.
 *
 * - `anchored`: the reader scrolled to the top of an overflowing transcript.
 *   The caller must hold the current row still across the prepend.
 * - `backfill`: the loaded rows do not fill the viewport. This is the case the
 *   old guard refused, which left a deep but heavily folded transcript with no
 *   way to reach its history: it sits at scrollTop 0 and at the bottom at the
 *   same time, so no scroll gesture could ever ask for more. The caller must
 *   NOT drop the pin to the bottom for this one, because there is no scroll
 *   position to preserve.
 */
export function loadOlderIntent(metrics: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}): LoadOlderIntent {
  // A collapsed or not-yet-laid-out transcript measures zero and would look
  // underfilled forever. It has no viewport to fill, so it asks for nothing.
  if (metrics.clientHeight <= 0) return "none";
  if (metrics.scrollHeight <= metrics.clientHeight + TOP_SLACK_PX) return "backfill";
  return metrics.scrollTop <= TOP_SLACK_PX ? "anchored" : "none";
}
