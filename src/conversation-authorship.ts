/**
 * Out-of-band authorship for turns that are NOT delivered to a bot.
 *
 * The bot path records who wrote a turn by writing `[Message from <email> to
 * bot <name>]` at position zero of the delivered text (bots/authorship.ts),
 * and reads it back with a regex. That works because the marker survives the
 * round trip through an agent transcript this server does not control: the
 * text IS the durable record.
 *
 * An ordinary coding session cannot use that mechanism. Its text is typed
 * straight into the agent, so any marker becomes part of the prompt Claude
 * Code (or Codex, or any other adapter) actually reads. There is also no bot
 * to name, so the existing pattern would not match what it wrote. Attribution
 * therefore has to live beside the transcript instead of inside it.
 *
 * The join key is (sessionId, digest of the sent text), because that is the
 * only thing still true on both sides of the trip. `messageAuthorForSession`
 * is recomputed from `{ role, text }` on every reindex, so a key derived from
 * a rowid or an ingestion order would not survive a rebuild.
 *
 * The sharp edge is that the key is not unique. Two people can send the exact
 * same text in one session ("go", "yes", "ship it"), and a digest cannot tell
 * them apart. When that happens this module reports NOTHING rather than
 * picking the earlier or the likelier one: an unattributed turn renders as
 * today's honest "unknown" (see isOtherHumanMessageAuthor on the client),
 * whereas a wrong face is a lie the UI presents as server-verified. Repeats
 * from a single author stay attributed, because they agree on the answer.
 */

import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { PATHS } from "./config.ts";

/**
 * One recorded send. Keys are short because this file is rewritten whole on
 * every append and read on every transcript index pass.
 */
type AuthoredSend = {
  /** Runtime session id the text was sent to. */
  s: string;
  /** Digest of the sent text (see sendDigest). */
  h: string;
  /** Conversation participant id of the sender ("human:<digest>"). */
  p: string;
  /** Wall clock of the send, for pruning only. Never used for matching. */
  at: number;
};

/**
 * Total retained sends across all sessions.
 *
 * The file is rewritten whole on each append, so this bounds write cost as
 * well as disk. Attribution is only ever read for messages still in a
 * transcript, and the oldest entries are the ones whose sessions have gone
 * cold, so dropping them costs the face on a very old turn and nothing else.
 */
const MAX_ENTRIES = 5_000;

const storePath = () => join(PATHS.data, "conversations", "authored-sends.json");

/**
 * The join key.
 *
 * Trimmed because the composer trims before sending and an agent transcript
 * may record a trailing newline that the sender never typed. Versioned in the
 * preimage for the same reason botAuthorId is: so the scheme can change later
 * without silently matching ids written by an older build.
 */
export function sendDigest(text: string): string {
  const normalized = text.trim();
  if (!normalized) return "";
  return createHash("sha256").update(`omg-send-v1:${normalized}`).digest("hex").slice(0, 16);
}

function isAuthoredSend(value: unknown): value is AuthoredSend {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<AuthoredSend>;
  return (
    typeof row.s === "string" &&
    typeof row.h === "string" &&
    typeof row.p === "string" &&
    typeof row.at === "number"
  );
}

function readStore(): AuthoredSend[] {
  try {
    const parsed = JSON.parse(readFileSync(storePath(), "utf8"));
    return Array.isArray(parsed) ? parsed.filter(isAuthoredSend) : [];
  } catch {
    return [];
  }
}

/**
 * Lookup index, rebuilt only when the file actually changes.
 *
 * Reindexing a transcript calls the lookup once PER MESSAGE, so reading and
 * parsing the whole store each time turns a rebuild into thousands of reads of
 * the same hundreds of kilobytes. The cache key is the file's size and mtime
 * plus the store path, so an external write is picked up and a test that
 * repoints PATHS.data does not read another root's index.
 *
 * `null` in the map is a recorded ambiguity: more than one participant sent
 * that text, so the answer is "nobody", and it must be distinguishable from
 * "not present" during the build.
 */
type Index = { key: string; byKey: Map<string, string | null> };
let cachedIndex: Index | null = null;

function storeSignature(path: string): string {
  try {
    const stat = statSync(path);
    return `${path}:${stat.size}:${stat.mtimeMs}`;
  } catch {
    return `${path}:absent`;
  }
}

function lookupIndex(): Map<string, string | null> {
  const path = storePath();
  const key = storeSignature(path);
  if (cachedIndex?.key === key) return cachedIndex.byKey;
  const byKey = new Map<string, string | null>();
  for (const row of readStore()) {
    const rowKey = `${row.s}|${row.h}`;
    if (!byKey.has(rowKey)) byKey.set(rowKey, row.p);
    else if (byKey.get(rowKey) !== row.p) byKey.set(rowKey, null);
  }
  cachedIndex = { key, byKey };
  return byKey;
}

function invalidateIndex(): void {
  cachedIndex = null;
}

/** Atomic replace, matching conversations.ts so a crash cannot truncate it. */
function writeStore(rows: AuthoredSend[]): void {
  const path = storePath();
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(rows), { mode: 0o600 });
  try {
    const fd = openSync(temp, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
    try {
      const dirFd = openSync(dir, "r");
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    } catch {}
  } finally {
    try {
      unlinkSync(temp);
    } catch {}
  }
}

/**
 * Record that `participantId` sent `text` to `sessionId`.
 *
 * Call this ONLY for an identity the server resolved itself — a managed
 * caller's grant email, or an address validated against the roster. Never a
 * fallback placeholder: everything downstream reports these as
 * `verified: true`, which means "the box named the sender" and must never be
 * satisfied by a literal like "user". recordHumanTurn enforces that by
 * refusing anything that is not an address.
 *
 * Re-recording the same (session, digest, participant) is a no-op, so a retry
 * or a duplicate delivery does not turn a single author into an ambiguous
 * pair.
 */
export function recordAuthoredSend(input: {
  sessionId: string;
  participantId: string;
  text: string;
  at?: number;
}): void {
  const digest = sendDigest(input.text);
  if (!digest || !input.sessionId || !input.participantId) return;
  const rows = readStore();
  if (
    rows.some(
      (row) => row.s === input.sessionId && row.h === digest && row.p === input.participantId,
    )
  ) return;
  rows.push({ s: input.sessionId, h: digest, p: input.participantId, at: input.at ?? Date.now() });
  writeStore(rows.length > MAX_ENTRIES ? rows.slice(rows.length - MAX_ENTRIES) : rows);
  invalidateIndex();
}

/**
 * The participant who sent this exact text to this session, or null.
 *
 * Null covers three different situations on purpose, because the caller
 * treats them identically: nothing was recorded, the text is empty, or more
 * than one participant sent the same text and the digest cannot separate
 * them. See the module note on why ambiguity resolves to nothing.
 */
export function authoredSendParticipantId(
  sessionId: string,
  text: string,
): string | null {
  const digest = sendDigest(text);
  if (!digest || !sessionId) return null;
  return lookupIndex().get(`${sessionId}|${digest}`) ?? null;
}

/** Drop every send recorded for a session. Used when its data is deleted. */
export function forgetAuthoredSends(sessionId: string): void {
  const rows = readStore();
  const kept = rows.filter((row) => row.s !== sessionId);
  if (kept.length !== rows.length) {
    writeStore(kept);
    invalidateIndex();
  }
}

export function resetAuthoredSendsForTests(): void {
  invalidateIndex();
  try {
    unlinkSync(storePath());
  } catch {}
}
