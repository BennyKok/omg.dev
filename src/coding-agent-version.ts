import { execFile } from "node:child_process";
import { realpathSync, statSync } from "node:fs";

const cache = new Map<string, { identity: string; expires: number; version: Promise<string | undefined> }>();

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

  const version = new Promise<string | undefined>((resolve) => {
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
  cache.set(path, { identity, expires: Date.now() + 60_000, version });
  return version;
}
