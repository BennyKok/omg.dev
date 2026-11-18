import { closeSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { claudeProjectsDir } from "./claude-conversation.ts";
import { PATHS } from "./config.ts";

/**
 * Which release each Claude alias (`opus`, `fable`, `sonnet`, `haiku`) runs
 * today, learned from this box's own Claude transcripts.
 *
 * The pickers offer only the aliases, and the harness resolves each to the
 * newest release of its family. Claude Code has no command that lists what an
 * alias resolves to, but it stamps every assistant line with the full model
 * id (`"model":"claude-opus-5-5"`). The newest id seen per family is what the
 * alias runs, so the picker can say "Opus 5.5" and move to "Opus 5.6" by
 * itself after the first session that runs it. Nothing here is hard-coded.
 *
 * Bounded: the tail of the newest transcripts, cached for a few minutes. What
 * was seen is kept in a small file in the data directory, so a family used
 * weeks ago (Haiku, say) keeps its version. The first run, with no such file,
 * reads a short tail of every transcript from the last 30 days once. A box
 * with no transcripts gets an empty map and the picker shows the plain
 * family name.
 */

export type ClaudeAlias = "opus" | "fable" | "sonnet" | "haiku";
const ALIASES: readonly ClaudeAlias[] = ["opus", "fable", "sonnet", "haiku"];

const MAX_FILES = 200;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const TAIL_BYTES = 256 * 1024;
const BACKFILL_TAIL_BYTES = 64 * 1024;
const CACHE_MS = 5 * 60 * 1000;

const MODEL_RE = /"model":"(claude-(opus|fable|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?)"/g;

type Seen = { id: string; major: number; minor: number };

function newer(a: Seen, b: Seen | undefined): boolean {
  if (!b) return true;
  return a.major !== b.major ? a.major > b.major : a.minor > b.minor;
}

/** The newest full id per family in `text`. Exported for tests. */
export function newestClaudeIds(texts: Iterable<string>): Partial<Record<ClaudeAlias, string>> {
  const best: Partial<Record<ClaudeAlias, Seen>> = {};
  for (const text of texts) {
    for (const m of text.matchAll(MODEL_RE)) {
      const family = m[2] as ClaudeAlias;
      const seen = { id: m[1]!, major: Number(m[3]), minor: m[4] ? Number(m[4]) : 0 };
      if (newer(seen, best[family])) best[family] = seen;
    }
  }
  const out: Partial<Record<ClaudeAlias, string>> = {};
  for (const alias of ALIASES) if (best[alias]) out[alias] = best[alias]!.id;
  return out;
}

function tail(path: string, size: number, max: number): string {
  const length = Math.min(size, max);
  const buf = Buffer.alloc(length);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buf, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  return buf.toString("utf8");
}

function recentTranscripts(root: string, now: number): Array<{ path: string; size: number }> {
  const files: Array<{ path: string; size: number; mtime: number }> = [];
  let dirs: string[];
  try {
    dirs = readdirSync(root);
  } catch {
    return [];
  }
  for (const dir of dirs) {
    let names: string[];
    try {
      names = readdirSync(join(root, dir));
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue;
      const path = join(root, dir, name);
      try {
        const st = statSync(path);
        if (st.isFile() && now - st.mtimeMs <= MAX_AGE_MS) files.push({ path, size: st.size, mtime: st.mtimeMs });
      } catch {}
    }
  }
  return files.sort((a, b) => b.mtime - a.mtime);
}

let storeOverride: string | null = null;
const storePath = () => storeOverride ?? join(PATHS.data, "claude-alias-versions.json");

function readStore(): Partial<Record<ClaudeAlias, string>> | null {
  try {
    const parsed = JSON.parse(readFileSync(storePath(), "utf8")) as Record<string, unknown>;
    const out: Partial<Record<ClaudeAlias, string>> = {};
    for (const alias of ALIASES) {
      const id = parsed[alias];
      if (typeof id === "string" && /^claude-[a-z]+-[0-9a-z-]{1,40}$/.test(id)) out[alias] = id;
    }
    return out;
  } catch {
    return null;
  }
}

function writeStore(value: Partial<Record<ClaudeAlias, string>>): void {
  try {
    mkdirSync(dirname(storePath()), { recursive: true });
    writeFileSync(storePath(), JSON.stringify(value, null, 2) + "\n");
  } catch {}
}

/** The stored ids, as model lines, so they compete with the scan on version. */
function storedLines(stored: Partial<Record<ClaudeAlias, string>>): string {
  return Object.values(stored).map((id) => `"model":"${id}"`).join("\n");
}

let cache: { at: number; root: string; value: Partial<Record<ClaudeAlias, string>> } | null = null;

/** Alias -> the full id it runs on this box, e.g. `{ opus: "claude-opus-5-5" }`. */
export function claudeAliasVersions(now = Date.now()): Partial<Record<ClaudeAlias, string>> {
  const root = claudeProjectsDir();
  if (cache && cache.root === root && now - cache.at < CACHE_MS) return cache.value;
  const stored = readStore();
  const all = recentTranscripts(root, now);
  // First run: a short tail of every recent transcript. Later: the newest few.
  const files = stored ? all.slice(0, MAX_FILES) : all;
  const max = stored ? TAIL_BYTES : BACKFILL_TAIL_BYTES;
  function* texts() {
    if (stored) yield storedLines(stored);
    for (const file of files) {
      try {
        yield tail(file.path, file.size, max);
      } catch {}
    }
  }
  const value = newestClaudeIds(texts());
  if (JSON.stringify(value) !== JSON.stringify(stored ?? {}) || (!stored && all.length)) writeStore(value);
  cache = { at: now, root, value };
  return value;
}

export function resetClaudeAliasVersionsForTests(store: string | null = null): void {
  cache = null;
  storeOverride = store;
}
