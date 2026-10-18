import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PATHS } from "./config.ts";

const cache = new Map<string, { identity: string; expires: number; version: Promise<string | undefined> }>();
const FRESH_MS = 60_000;

// The answers outlive the process. A version cannot change unless the file
// does, and the identity below is the resolved file's own stat, so a stored
// answer for the same identity is still true after a restart. Without this
// the first /api/bootstrap after every start waited on each CLI's --version:
// `cursor-agent --version` alone takes 1.4 to 1.7 s, and it was about 94% of
// a cold bootstrap (2.1 s cold, 0.13 s with versions known).
type StoredVersion = { identity: string; version: string | null; probedAt: number };
let storePath: string | null = null;
let stored: Record<string, StoredVersion> | null = null;

function versionStorePath(): string {
  return storePath ?? join(PATHS.data, "coding-agent-versions.json");
}

function readStore(): Record<string, StoredVersion> {
  if (stored) return stored;
  try {
    const parsed = JSON.parse(readFileSync(versionStorePath(), "utf8")) as unknown;
    stored = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, StoredVersion> : {};
  } catch {
    stored = {};
  }
  return stored;
}

function remember(path: string, entry: StoredVersion): void {
  const all = readStore();
  all[path] = entry;
  const file = versionStorePath();
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(all));
    renameSync(tmp, file);
  } catch {
    // The store only saves time. A failed write costs one probe next start.
  }
}

/** Point the stored answers at another file, or back to the data folder. */
export function setCodingAgentVersionStoreForTests(path: string | null): void {
  storePath = path;
  stored = null;
  cache.clear();
}

function probe(path: string): Promise<string | undefined> {
  return new Promise<string | undefined>((resolve) => {
    // The bundled pi runtime is a JavaScript entry point, not a native CLI.
    const script = /\.[cm]?js$/.test(path);
    try {
      execFile(script ? process.execPath : path, script ? [path, "--version"] : ["--version"], {
        timeout: 3000,
        maxBuffer: 64 * 1024,
        env: { ...process.env, NO_COLOR: "1" },
      }, (error, stdout, stderr) => {
        if (error) return resolve(undefined);
        const output = (stdout || stderr).replace(/\x1b\[[0-9;]*m/g, "");
        // CLIs may prefix the version with their name or suffix it with build data.
        resolve(output.match(/\b\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?\b/)?.[0]);
      });
    } catch {
      // Bun can throw synchronously for an invalid executable.
      resolve(undefined);
    }
  });
}

function probeAndRemember(path: string, identity: string): Promise<string | undefined> {
  const version = probe(path).then((value) => {
    remember(path, { identity, version: value ?? null, probedAt: Date.now() });
    return value;
  });
  cache.set(path, { identity, expires: Date.now() + FRESH_MS, version });
  return version;
}

/** Probe the installed runtime, rather than the SDK used to talk to it. */
export function codingAgentVersion(path: string | null): Promise<string | undefined> {
  if (!path) return Promise.resolve(undefined);
  let identity: string;
  try {
    const resolved = realpathSync(path);
    const stat = statSync(resolved);
    identity = `${resolved}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
  } catch {
    cache.delete(path);
    return Promise.resolve(undefined);
  }
  const cached = cache.get(path);
  if (cached?.identity === identity && cached.expires > Date.now()) return cached.version;

  // A stored answer for this exact file answers now. A wrapper script can
  // still point at a new install without changing itself, so an answer older
  // than FRESH_MS is checked again behind the caller.
  const saved = readStore()[path];
  if (saved?.identity === identity) {
    const version = Promise.resolve(saved.version ?? undefined);
    if (Date.now() - saved.probedAt < FRESH_MS) {
      cache.set(path, { identity, expires: saved.probedAt + FRESH_MS, version });
      return version;
    }
    if (!cached || cached.identity !== identity) {
      // Serve the stored answer until the check finishes, so no caller waits.
      cache.set(path, { identity, expires: Date.now() + FRESH_MS, version });
      void probe(path).then((value) => {
        remember(path, { identity, version: value ?? null, probedAt: Date.now() });
        if (cache.get(path)?.identity === identity) {
          cache.set(path, { identity, expires: Date.now() + FRESH_MS, version: Promise.resolve(value) });
        }
      });
    }
    return version;
  }
  return probeAndRemember(path, identity);
}
