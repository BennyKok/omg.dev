// Confirmed-delivery outbound message queue, one per Claude Code session.
//
// Driving an interactive TUI over tmux send-keys is racy: a fixed sleep before
// Enter loses messages when the TUI is busy, two quick sends interleave in the
// same input box, and a dropped Enter silently strands text in the composer
// while the caller is told "ok". This module turns send-and-pray into
// send-confirm-retry: it serializes one delivery at a time per session, types
// then waits until our text actually appears in the composer, presses Enter,
// then waits until the text *leaves* the box (the rendering-agnostic signal
// that Claude accepted it). It retries a stranded Enter, clears+retypes a
// dropped type, and only marks a message failed when it truly never landed.

import { randomBytes } from "node:crypto";
import {
  capturePane,
  parsePrompt,
  questionSelectorOpen,
  inputBoxText,
  tmuxType,
  tmuxEnter,
  tmuxClearInput,
  tmuxInterrupt,
  feedbackPromptOpen,
  tmuxDismissFeedback,
} from "./tmux.ts";
import { resolveTranscript, type SessionMsg } from "./sessions.ts";
import { listSessionsCached } from "./session-cache.ts";
import {
  enqueueTranscriptIndex,
  indexedMessagePage,
  indexedRecentMessages,
} from "./transcript-index.ts";
import { traceLog } from "./trace-log.ts";
import {
  actionableStoredQueueSessionIds,
  deleteStoredQueueMessages,
  readStoredQueue,
  resetSendQueueStoreConnectionForTests,
  writeStoredQueueMessage,
} from "./sendq-store.ts";

export type QueuedMsg = {
  id: string;
  text: string;
  // pending: waiting behind earlier sends. sending: actively being typed +
  // confirmed. delivered: accepted by Claude (left the input box). queued:
  // accepted while Claude was mid-turn — it's in Claude's own queue, not yet in
  // the transcript. failed: never left the box after retries.
  status: "pending" | "sending" | "delivered" | "queued" | "failed";
  error?: string;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  /** The agent was still on an earlier turn when this message was accepted. */
  queuedBehindTurn?: boolean;
};

type SessionQueue = { msgs: QueuedMsg[]; running: boolean };

const queues = new Map<string, SessionQueue>();

// Keep the per-session list from growing unbounded; resolved rows older than
// this many are pruned on each enqueue.
const KEEP_TERMINAL = 12;

function q(sessionId: string): SessionQueue {
  let s = queues.get(sessionId);
  if (!s) {
    s = { msgs: readStoredQueue(sessionId), running: false };
    queues.set(sessionId, s);
  }
  return s;
}

export function listQueue(sessionId: string): QueuedMsg[] {
  return q(sessionId).msgs;
}

export function getMessage(sessionId: string, id: string): QueuedMsg | null {
  return q(sessionId).msgs.find((m) => m.id === id) ?? null;
}

function persist(sessionId: string, message: QueuedMsg): void {
  writeStoredQueueMessage(sessionId, message);
}

// SQLite restores a queue by (created_at, id). random ids are not an ordering
// key, so two accepts in the same millisecond could reverse after a restart.
// Keep creation time strictly increasing inside each session queue.
function nextCreatedAt(s: SessionQueue): number {
  const previous = s.msgs.at(-1)?.createdAt ?? 0;
  return Math.max(Date.now(), previous + 1);
}

export function enqueueMessage(
  sessionId: string,
  text: string,
  opts: { queuedBehindTurn?: boolean } = {},
): QueuedMsg {
  const s = q(sessionId);
  const now = nextCreatedAt(s);
  const msg: QueuedMsg = {
    id: randomBytes(8).toString("hex"),
    text,
    status: "pending",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    ...(opts.queuedBehindTurn ? { queuedBehindTurn: true } : {}),
  };
  s.msgs.push(msg);
  persist(sessionId, msg);
  traceLog("sendq_enqueue", { sessionId, messageId: msg.id, chars: text.length });
  pruneTerminal(sessionId, s);
  kick(sessionId);
  return msg;
}

/**
 * Record a message accepted by a command-file harness.
 *
 * The harness owns delivery and ordering, so this skips the tmux delivery
 * worker. Keeping the row as `queued` lets a fresh UI connection hydrate it
 * until reconcileQueued observes the matching user transcript row.
 */
export function recordCommandFileMessage(
  sessionId: string,
  text: string,
  queuedBehindTurn = false,
): QueuedMsg {
  const s = q(sessionId);
  const now = nextCreatedAt(s);
  const msg: QueuedMsg = {
    id: randomBytes(8).toString("hex"),
    text,
    status: "queued",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    ...(queuedBehindTurn ? { queuedBehindTurn: true } : {}),
  };
  s.msgs.push(msg);
  persist(sessionId, msg);
  traceLog("sendq_command_file_accepted", {
    sessionId,
    messageId: msg.id,
    chars: text.length,
    queuedBehindTurn,
  });
  pruneTerminal(sessionId, s);
  return msg;
}

export function retryMessage(sessionId: string, id: string): QueuedMsg | null {
  const s = q(sessionId);
  const msg = s.msgs.find((m) => m.id === id);
  if (!msg) return null;
  if (msg.status !== "failed") return msg;
  msg.status = "pending";
  msg.error = undefined;
  msg.attempts = 0;
  msg.updatedAt = Date.now();
  persist(sessionId, msg);
  kick(sessionId);
  return msg;
}

// Drop messages the user no longer needs to see — everything that's reached a
// terminal state (delivered/queued/failed). In-flight messages (pending/
// sending) stay so a clear never silently abandons a send mid-delivery.
export function clearResolved(sessionId: string): number {
  const s = q(sessionId);
  const before = s.msgs.length;
  const removed = s.msgs
    .filter((m) => m.status !== "pending" && m.status !== "sending")
    .map((m) => m.id);
  s.msgs = s.msgs.filter((m) => m.status === "pending" || m.status === "sending");
  deleteStoredQueueMessages(sessionId, removed);
  return before - s.msgs.length;
}

/**
 * Remove and return the sends that never reached the agent, so a caller can
 * re-address them at a replacement session.
 *
 * A bot restart retires the runtime a queue was addressed to. `pending` and
 * `queued` rows are undelivered by definition — one never entered the
 * composer, the other sits in the harness's own queue behind a turn that is
 * about to be destroyed with it — so leaving them here strands them in a
 * session no UI watches again. They are removed rather than copied: the caller
 * re-enqueues them on the new session, and one message must not be live in two
 * queues at once.
 *
 * A `sending` row is deliberately left behind. It may already have been
 * submitted, and its delivery worker still owns it; taking it would risk a
 * duplicate user turn, which is the same tradeoff `resumePersistedQueues`
 * makes for an interrupted send.
 */
export function takeUndeliveredQueue(sessionId: string): QueuedMsg[] {
  const s = q(sessionId);
  const taken = s.msgs.filter((m) => m.status === "pending" || m.status === "queued");
  if (!taken.length) return [];
  const ids = new Set(taken.map((m) => m.id));
  s.msgs = s.msgs.filter((m) => !ids.has(m.id));
  deleteStoredQueueMessages(sessionId, [...ids]);
  traceLog("sendq_taken_for_handoff", { sessionId, count: taken.length });
  return taken;
}

// Bounded retention applies only to truly resolved rows. A `queued` row is
// still waiting to be reconciled against the transcript, and a `failed` row is
// still waiting for the user to retry or clear it — pruning either would
// silently drop a send the UI is expected to keep showing.
function pruneTerminal(sessionId: string, s: SessionQueue) {
  const terminal = s.msgs.filter((m) => m.status === "delivered");
  if (terminal.length <= KEEP_TERMINAL) return;
  const drop = new Set(
    terminal
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(0, terminal.length - KEEP_TERMINAL),
  );
  deleteStoredQueueMessages(sessionId, [...drop].map((m) => m.id));
  s.msgs = s.msgs.filter((m) => !drop.has(m));
}

function kick(sessionId: string) {
  const s = q(sessionId);
  if (s.running) return;
  s.running = true;
  (async () => {
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const next = s.msgs.find((m) => m.status === "pending");
        if (!next) break;
        next.status = "sending";
        next.updatedAt = Date.now();
        persist(sessionId, next);
        try {
          await deliver(sessionId, next);
        } catch (e) {
          next.status = "failed";
          next.error = e instanceof Error ? e.message : String(e);
        }
        next.updatedAt = Date.now();
        persist(sessionId, next);
      }
    } finally {
      s.running = false;
    }
  })();
}

/**
 * Resume queue work after the serve process restarts.
 *
 * A `pending` row has not entered the terminal composer and is safe to retry.
 * A `sending` row may already have submitted immediately before the old serve
 * process stopped. Mark it failed instead of risking a duplicate user turn.
 */
export function resumePersistedQueues(): number {
  let resumed = 0;
  for (const sessionId of actionableStoredQueueSessionIds()) {
    const s = q(sessionId);
    for (const message of s.msgs) {
      if (message.status === "sending") {
        message.status = "failed";
        message.error = "delivery was interrupted by an LFG server restart; check the transcript before retrying";
        message.updatedAt = Date.now();
        persist(sessionId, message);
      } else if (message.status === "pending") {
        resumed++;
      }
    }
    if (s.msgs.some((message) => message.status === "pending")) kick(sessionId);
  }
  return resumed;
}

export function resetSendQueueForTests(): void {
  queues.clear();
  resetSendQueueStoreConnectionForTests();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export function jcodeAcceptedStatus(
  queuedBehindTurn: boolean,
): "queued" | "delivered" {
  return queuedBehindTurn ? "queued" : "delivered";
}

// We match a normalized prefix rather than the whole message: the composer
// wraps long input across lines, so a full-string compare against the capture
// would never match.
const NEEDLE_LEN = 48;
// Below this length, a head-only match is enough — short messages can't lose a
// trailing "answer" body the way long multi-line asks can.
const LONG_MSG_CHARS = NEEDLE_LEN * 3;

/** Head (+ optional tail) needles for long-message delivery confirmation. */
export function messageNeedles(fullNorm: string): { head: string; tail: string | null } {
  const head = fullNorm.slice(0, NEEDLE_LEN);
  if (fullNorm.length <= LONG_MSG_CHARS) return { head, tail: null };
  return { head, tail: fullNorm.slice(-NEEDLE_LEN) };
}

/** True when a user transcript/box string contains our delivery markers. */
export function textHasMessageNeedles(
  text: string,
  head: string,
  tail: string | null,
): boolean {
  const n = norm(text);
  if (!n.includes(head)) return false;
  return !tail || n.includes(tail);
}

// Does the composer currently show our message? Two probes, in order:
//
// 1. Needle: our normalized prefix is visible in the box. Definitive for short
//    drafts and unscrolled viewports. For LONG drafts the head alone is not
//    enough — a partial type-in (Grok multi-line truncations were the live
//    incident) also shows the first 48 chars, so we also require the tail, a
//    near-complete prefix, or fall through to the inverted scrolled check.
// 2. Inverted (the codex long-draft case): the codex composer viewport scrolls
//    for long drafts, so NEITHER the head nor the tail of the draft is
//    guaranteed on screen — the needle probe false-negatives, and the queue
//    would clear + retype a message that was sitting there fine, then fail.
//    What IS guaranteed is that every visible composer line is a contiguous
//    slice of our draft, so check that direction: a non-empty box matches when
//    every visible line is a substring of the normalized message. A foreign
//    draft or placeholder ("Add a follow-up") fails this; a scrolled viewport
//    of ours passes. Checked per-line rather than joined, because a mid-word
//    wrap has no space at the seam — joining visible lines with a space would
//    fabricate one and break the substring match.
//
// Partial PREFIX drafts are rejected: if the visible box is a short prefix of
// the intended message, typing is incomplete and we must not Enter yet.
//
// Exported for tests: pure logic over a captured box string.
export function boxTextMatches(box: string, fullNorm: string, needle: string): boolean {
  const normBox = norm(box);
  if (!normBox) return false;

  const { tail } = messageNeedles(fullNorm);
  if (normBox.includes(needle)) {
    // Short messages: head is decisive.
    if (!tail) return true;
    // Long messages: head + tail both on screen (unscrolled, fully typed).
    if (normBox.includes(tail)) return true;
    // Fully typed and still showing the start (cursor may have jumped home):
    // accept a near-complete prefix so we don't retype a finished draft.
    if (fullNorm.startsWith(normBox) && normBox.length >= Math.floor(fullNorm.length * 0.85)) {
      return true;
    }
    // Head only on a long draft → either partial type-in or scrolled mid-body.
    // Fall through to the inverted check.
  }

  const lines = box
    .split("\n")
    .map(norm)
    .filter(Boolean);
  if (!lines.length || !lines.every((l) => fullNorm.includes(l))) return false;

  // Reject incomplete type-in: every visible line is ours, but the whole box is
  // still just a short PREFIX of the intended message. A true mid-scroll of a
  // complete draft is NOT a prefix (it starts somewhere in the middle).
  if (fullNorm.startsWith(normBox) && normBox.length < Math.floor(fullNorm.length * 0.85)) {
    return false;
  }
  return true;
}

function boxShowsMessage(target: string, fullNorm: string, needle: string): boolean | null {
  const box = inputBoxText(target);
  if (box == null) return null; // composer not visible (modal up, or unknown)
  return boxTextMatches(box, fullNorm, needle);
}

async function transcriptUserMatchCount(
  sessionId: string,
  transcriptPath: string | null,
  head: string,
  tail: string | null,
): Promise<number> {
  if (!transcriptPath) return 0;
  try {
    enqueueTranscriptIndex(transcriptPath, sessionId);
    const msgs = await indexedRecentMessages(transcriptPath, sessionId, 120);
    return msgs.filter(
      (m) =>
        m.role === "user" &&
        m.kind === "text" &&
        textHasMessageNeedles(m.text, head, tail),
    ).length;
  } catch {
    return 0;
  }
}

// A "queued" message left the input box while Claude was busy, so it sat in
// Claude's own queue rather than the transcript — deliver() can't wait for it
// to surface without blocking the per-session queue behind a turn that may run
// for minutes. So we reconcile lazily: whenever the UI polls, promote any
// queued message that has since shown up in the transcript to "delivered" (the
// UI then drops it). Returns true if anything changed so the caller re-emits.
//
// The scan pages backwards instead of reading one fixed "recent" window: once
// the queued message is read, the turn it starts can bury its user row under
// hundreds of tool rows before the next reconcile tick, and a 40-row window
// never sees it. Paging stops once rows predate the oldest unreconciled send.
const RECONCILE_PAGE_ROWS = 200;
const RECONCILE_MAX_ROWS = 4000;
// The transcript row is stamped by the harness when it writes the line, which
// can land a beat before this process stamped the queue row — allow that much
// skew when a repeated identical message must claim its OWN row.
const RECONCILE_TS_SKEW_MS = 5_000;

async function collectReconcileRows(
  transcriptPath: string,
  sessionId: string,
  oldestCreatedAt: number,
): Promise<SessionMsg[]> {
  const collected: SessionMsg[] = [];
  let before: number | null = null;
  for (;;) {
    const page = await indexedMessagePage(transcriptPath, sessionId, {
      ...(before == null ? {} : { before }),
      limit: RECONCILE_PAGE_ROWS,
    });
    collected.unshift(...page.messages);
    const oldestRow = page.messages[0];
    const covered =
      !page.nextBefore ||
      (oldestRow?.ts != null && oldestRow.ts < oldestCreatedAt - RECONCILE_TS_SKEW_MS);
    if (covered || collected.length >= RECONCILE_MAX_ROWS || !page.messages.length) {
      return collected;
    }
    before = page.nextBefore;
  }
}

export async function reconcileQueued(sessionId: string): Promise<boolean> {
  const s = q(sessionId);
  const pending = s.msgs.filter((m) => m.status === "queued");
  if (!pending.length) return false;
  // Delivered rows must also claim their transcript rows. Otherwise a second
  // identical follow-up can reuse the first row on a later reconcile tick and
  // become delivered before the agent reads it.
  const matchable = s.msgs.filter(
    (m) => m.status === "queued" || m.status === "delivered",
  );
  const transcriptPath = await resolveTranscript(sessionId);
  if (!transcriptPath) return false;
  let rows: SessionMsg[];
  try {
    enqueueTranscriptIndex(transcriptPath, sessionId);
    rows = await collectReconcileRows(
      transcriptPath,
      sessionId,
      Math.min(...matchable.map((m) => m.createdAt)),
    );
  } catch {
    return false;
  }
  // Match one-to-one, oldest queue row first: two identical queued messages
  // must each claim their own transcript user row. Sharing one would promote a
  // follow-up the agent has not actually read yet.
  const candidates = rows.filter((r) => r.role === "user" && r.kind === "text");
  const claimed = new Set<number>();
  let changed = false;
  for (const m of matchable) {
    const { head, tail } = messageNeedles(norm(m.text));
    const index = candidates.findIndex(
      (r, i) =>
        !claimed.has(i) &&
        (r.ts == null || r.ts >= m.createdAt - RECONCILE_TS_SKEW_MS) &&
        textHasMessageNeedles(r.text, head, tail),
    );
    if (index < 0) continue;
    claimed.add(index);
    if (m.status === "delivered") continue;
    m.status = "delivered";
    m.updatedAt = Date.now();
    persist(sessionId, m);
    traceLog("sendq_reconciled", { sessionId, messageId: m.id });
    changed = true;
  }
  return changed;
}

// If the session-rating overlay is up it swallows Enter, so clear it before we
// type/submit. Returns true if it dismissed one (caller can give the TUI a beat
// to settle).
function clearFeedbackPrompt(target: string): boolean {
  const pane = capturePane(target);
  if (pane && feedbackPromptOpen(pane)) {
    tmuxDismissFeedback(target);
    return true;
  }
  return false;
}

async function deliver(sessionId: string, msg: QueuedMsg): Promise<void> {
  const started = performance.now();
  const sess = (await listSessionsCached()).find(
    (s) => s.sessionId === sessionId || s.nativeSessionId === sessionId,
  );
  const target = sess?.tmuxTarget ?? null;
  if (!target) {
    msg.status = "failed";
    msg.error = "session is not in a tmux pane";
    traceLog("sendq_failed", { sessionId, messageId: msg.id, error: msg.error });
    return;
  }
  const transcriptPath = await resolveTranscript(sessionId);
  const fullNorm = norm(msg.text);
  const { head: needle, tail: tailNeedle } = messageNeedles(fullNorm);
  const transcriptMatchesBefore = await transcriptUserMatchCount(
    sessionId,
    transcriptPath,
    needle,
    tailNeedle,
  );
  traceLog("sendq_deliver_start", {
    sessionId,
    messageId: msg.id,
    transcriptPath,
    target,
    chars: msg.text.length,
  });

  // Jcode's simple REPL uses stdin.read_line(). It has no editable TUI box,
  // and submitted prompts remain visible in pane history. The normal visual
  // confirmation would mistake that history for a stranded draft and submit
  // it again. tmux serializes these writes, while the terminal line discipline
  // buffers complete follow-up lines until Jcode finishes the active turn.
  if (sess?.agent === "jcode") {
    const typed = tmuxType(target, msg.text);
    if (typed) await sleep(80);
    const submitted = typed && tmuxEnter(target);
    if (!submitted) {
      msg.status = "failed";
      msg.error = "failed to send the message to the Jcode REPL";
      traceLog("sendq_failed", { sessionId, messageId: msg.id, error: msg.error });
      return;
    }
    // Jcode accepts complete lines into stdin while a turn is running, but it
    // does not read them until that turn ends. Keep that line visible as queued
    // until reconcileQueued() sees its later user row in the journal.
    msg.status = jcodeAcceptedStatus(msg.queuedBehindTurn === true);
    msg.error = undefined;
    traceLog(msg.status === "queued" ? "sendq_accepted" : "sendq_delivered", {
      sessionId,
      messageId: msg.id,
      via: "jcode_repl",
      status: msg.status,
      attempts: 1,
      durationMs: Math.round((performance.now() - started) * 1000) / 1000,
    });
    return;
  }

  // Clear any session-rating overlay first — it swallows Enter and would
  // otherwise strand every send with "never left the input box".
  if (clearFeedbackPrompt(target)) await sleep(300);

  // "Chat about this": when a selector (permission / plan / question dialog) is
  // open, sending a message means the user chose to type a reply instead of
  // clicking an option. Dismiss the selector (Escape) so the composer is
  // reachable, then fall through to the normal type+submit path. We used to
  // refuse and fail the send ("answer it first"), which dead-ended every
  // chat-instead-of-answer. Up to two Escapes (the first can be dropped by a
  // busy TUI); each is gated on the selector still being open, so we never Esc
  // an idle composer (which would trip the rewind-history overlay).
  //
  // We detect "selector open" two ways: parsePrompt catches permission/plan
  // dialogs (whose active option carries a `❯` cursor), and questionSelectorOpen
  // catches AskUserQuestion dialogs whose active option is highlighted via
  // reverse-video — capture-pane strips the highlight, so NO option line reads
  // as selected and parsePrompt returns null. Gating dismissal on parsePrompt
  // alone skipped the Escape for those question dialogs, fell through to typing
  // into a composer that isn't reachable, and stranded the send with "message
  // never left the input box after retries". The footer-based detector fixes it.
  const selectorOpen = (p: string) => !!parsePrompt(p) || questionSelectorOpen(p);
  for (let attempt = 0; attempt < 2; attempt++) {
    const pane = capturePane(target);
    if (!pane || !selectorOpen(pane)) break;
    tmuxInterrupt(target); // single Escape — cancels the open selector
    let cleared = false;
    for (let i = 0; i < 14; i++) {
      await sleep(150);
      const p = capturePane(target);
      if (!p || !selectorOpen(p)) {
        cleared = true;
        break;
      }
    }
    if (cleared) break;
    if (attempt === 1) {
      msg.status = "failed";
      msg.error = "a prompt/selector wouldn't dismiss — answer it first";
      traceLog("sendq_failed", { sessionId, messageId: msg.id, error: msg.error });
      return;
    }
  }

  const MAX_ATTEMPTS = 3;
  while (msg.attempts < MAX_ATTEMPTS) {
    msg.attempts++;
    msg.updatedAt = Date.now();
    traceLog("sendq_attempt", { sessionId, messageId: msg.id, attempt: msg.attempts });

    // Only type when our text isn't already sitting in the box (a previous
    // attempt may have typed it but failed to submit — retyping would double it).
    if (boxShowsMessage(target, fullNorm, needle) !== true) {
      // Wipe any foreign draft first. The composer may already hold text the
      // user (or a stranded earlier send) left there; tmuxType appends, so
      // without this our message fuses onto it and the merged line submits as
      // one garbled message. Ctrl-U on an empty box is a harmless no-op.
      tmuxClearInput(target);
      await sleep(120);
      tmuxType(target, msg.text);
      let settled = false;
      for (let i = 0; i < 20; i++) {
        await sleep(150);
        if (boxShowsMessage(target, fullNorm, needle) === true) {
          settled = true;
          break;
        }
      }
      if (!settled) {
        // Typing didn't register (cold TUI, lost keys). Clear any partial and
        // loop to retry from scratch.
        tmuxClearInput(target);
        await sleep(200);
        traceLog("sendq_type_retry", { sessionId, messageId: msg.id, attempt: msg.attempts });
        continue;
      }
    }

    // The rating overlay can surface between turns, right as we're about to
    // submit; clear it again so this Enter isn't swallowed.
    if (clearFeedbackPrompt(target)) await sleep(300);

    // Submit, then confirm acceptance. Claude clears the composer when it
    // accepts a message. Codex keeps the submitted `› ...` prompt visible while
    // it works, so transcript growth is also an accept signal.
    tmuxEnter(target);
    for (let i = 0; i < 24; i++) {
      await sleep(150);
      const inBox = boxShowsMessage(target, fullNorm, needle);
      const transcriptMatchesNow = await transcriptUserMatchCount(
        sessionId,
        transcriptPath,
        needle,
        tailNeedle,
      );
      if (transcriptMatchesNow > transcriptMatchesBefore) {
        msg.status = "delivered";
        msg.error = undefined;
        traceLog("sendq_delivered", {
          sessionId,
          messageId: msg.id,
          via: "transcript_index",
          attempts: msg.attempts,
          durationMs: Math.round((performance.now() - started) * 1000) / 1000,
        });
        return;
      }
      // inBox === false: the composer is visible and our text is gone.
      // inBox === null: the composer vanished entirely — a selector/overlay
      //   opened right after our Enter (the message triggered a permission
      //   prompt, or the rating overlay surfaced). Either way the text is no
      //   longer sitting pending in the box, so the submit landed. Only
      //   inBox === true (text still there) means the Enter didn't take.
      if (inBox === false || inBox === null) {
        // Accepted. A slash command (/clear, /compact, …) executes immediately
        // and never surfaces as a user-text turn — /clear even wipes the
        // transcript — so the transcript probe would never confirm it and it
        // would hang at "queued" forever. Treat it as delivered the moment it
        // leaves the box. Otherwise it may be queued behind the current turn
        // (reconcileQueued promotes it once it surfaces).
        const isCommand = msg.text.trimStart().startsWith("/");
        msg.status = isCommand
          ? "delivered"
          : "queued";
        msg.error = undefined;
        traceLog("sendq_accepted", {
          sessionId,
          messageId: msg.id,
          status: msg.status,
          attempts: msg.attempts,
          durationMs: Math.round((performance.now() - started) * 1000) / 1000,
        });
        return;
      }
    }
    // Still in the box → the Enter didn't submit. Loop: we'll skip retyping
    // (needle present) and press Enter again.
  }

  msg.status = "failed";
  msg.error = "message never left the input box after retries";
  traceLog("sendq_failed", {
    sessionId,
    messageId: msg.id,
    error: msg.error,
    attempts: msg.attempts,
    durationMs: Math.round((performance.now() - started) * 1000) / 1000,
  });
}
