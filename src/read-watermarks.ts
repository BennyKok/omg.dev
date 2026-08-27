// One durable "read through here" mark per person, per conversation.
//
// This is the storage half of `src/bots/unread.ts`, lifted out so the coding
// session roster can use the same model instead of inventing a second one. The
// bot half kept the bot-specific resolution (which bot owns a conversation,
// whose watermark that is); everything below is only "remember a rowid".
//
// The cursor is a transcript rowid, not a timestamp. `src/transcript-index.ts`
// owns the message table, so its rowid is the one ordering both sides already
// agree on, and it does not move when a clock does.

import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type ReadWatermark = {
  user: string;
  sessionId: string;
  readThroughRowid: number;
  updatedAt: number;
};

type WatermarkFile = { version: 1; reads: ReadWatermark[] };

/** The single-user install has no roster identity to key on. */
export const LOCAL_READ_USER = "__local__";

export function readWatermarkUser(user: string | null | undefined): string {
  return user?.trim().toLowerCase() || LOCAL_READ_USER;
}

export type ReadWatermarkStore = {
  /** True when `latestRowid` is past what this user has read. */
  unread(user: string, sessionId: string, latestRowid: number | null): boolean;
  /** Advance the mark. Never moves it backwards. */
  mark(user: string, sessionId: string, latestRowid: number | null, now?: number): ReadWatermark;
  /** Write a first mark only when none exists, so history does not become unread on upgrade. */
  ensureBaseline(user: string, sessionId: string, latestRowid: number | null, now?: number): void;
  /** The mark itself, for callers that compare several conversations at once. */
  readThrough(user: string, sessionId: string): number | null;
  /** Every mark this user holds, keyed by conversation. */
  readThroughAll(user: string): Map<string, number>;
};

/**
 * A watermark file at `path()`.
 *
 * The path is a thunk because `PATHS.data` is resolved from the environment at
 * call time; taking a string here would freeze the data directory at import.
 */
export function createReadWatermarkStore(path: () => string): ReadWatermarkStore {
  function readFile(): WatermarkFile {
    try {
      const parsed = JSON.parse(readFileSync(path(), "utf8")) as Partial<WatermarkFile>;
      return parsed.version === 1 && Array.isArray(parsed.reads)
        ? { version: 1, reads: parsed.reads }
        : { version: 1, reads: [] };
    } catch {
      return { version: 1, reads: [] };
    }
  }

  function writeFile(value: WatermarkFile): void {
    const target = path();
    const dir = dirname(target);
    mkdirSync(dir, { recursive: true });
    const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
    writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    try {
      const fd = openSync(temp, "r");
      try { fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temp, target);
      try {
        const dirFd = openSync(dir, "r");
        try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
      } catch {}
    } finally {
      try { unlinkSync(temp); } catch {}
    }
  }

  function find(reads: ReadWatermark[], user: string, sessionId: string): ReadWatermark | undefined {
    return reads.find((row) => row.user === user && row.sessionId === sessionId);
  }

  return {
    unread(user, sessionId, latestRowid) {
      if (latestRowid == null) return false;
      const key = readWatermarkUser(user);
      const read = find(readFile().reads, key, sessionId);
      return !read || latestRowid > read.readThroughRowid;
    },
    mark(user, sessionId, latestRowid, now = Date.now()) {
      const key = readWatermarkUser(user);
      const file = readFile();
      const prior = find(file.reads, key, sessionId);
      const next: ReadWatermark = {
        user: key,
        sessionId,
        readThroughRowid: Math.max(prior?.readThroughRowid ?? 0, latestRowid ?? 0),
        updatedAt: now,
      };
      file.reads = [...file.reads.filter((row) => !(row.user === key && row.sessionId === sessionId)), next];
      writeFile(file);
      return next;
    },
    ensureBaseline(user, sessionId, latestRowid, now = Date.now()) {
      const key = readWatermarkUser(user);
      const file = readFile();
      if (find(file.reads, key, sessionId)) return;
      file.reads.push({ user: key, sessionId, readThroughRowid: latestRowid ?? 0, updatedAt: now });
      writeFile(file);
    },
    readThrough(user, sessionId) {
      const read = find(readFile().reads, readWatermarkUser(user), sessionId);
      return read ? read.readThroughRowid : null;
    },
    readThroughAll(user) {
      const key = readWatermarkUser(user);
      const out = new Map<string, number>();
      for (const row of readFile().reads) {
        if (row.user === key) out.set(row.sessionId, row.readThroughRowid);
      }
      return out;
    },
  };
}
