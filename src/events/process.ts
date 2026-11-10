// Running a script for an event hook, with hard bounds.
//
// Scripts run unattended on this box, often written by an agent, so each one
// gets as little as works:
//   - a minimal environment: no server secrets and no API keys from the
//     service's own env. A script that needs a credential reads it itself
//     (gh, for example, reads ~/.config/gh).
//   - a time limit, then SIGKILL,
//   - an output cap: a script that prints more fails instead of flooding,
//   - argv only, never string interpolation of event data into a command line.
//     Event data reaches an action script on stdin.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../config.ts";

export const SCRIPT_TIMEOUT_MS = 30_000;
export const SCRIPT_OUTPUT_MAX_BYTES = 256 * 1024;
export const SCRIPT_COMMAND_MAX_CHARS = 4_000;

/** A private folder for a hook's own scripts to keep state across runs. */
export function hookStateDir(hookId: string): string {
  return join(PATHS.data, "events", "state", hookId);
}

/** The whole environment a hook script sees. `extra` is for built-in sources only. */
export function hookEnv(
  hookId: string,
  extra: Record<string, string | undefined> = {},
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const out: Record<string, string> = {
    PATH: env.PATH || "/usr/local/bin:/usr/bin:/bin",
    HOME: env.HOME || "/",
    LANG: env.LANG || "C.UTF-8",
    OMG_EVENT_HOOK_ID: hookId,
    OMG_EVENT_STATE_DIR: hookStateDir(hookId),
  };
  for (const name of ["USER", "XDG_CONFIG_HOME"]) if (env[name]) out[name] = env[name]!;
  for (const [k, v] of Object.entries(extra)) if (v) out[k] = v;
  return out;
}

export type BoundedResult = { exitCode: number | null; stdout: string; stderr: string };

async function readCapped(stream: ReadableStream<Uint8Array>, max: number): Promise<{ text: string; capped: boolean }> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let capped = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.length > max) {
        chunks.push(value.subarray(0, max - size));
        capped = true;
        break;
      }
      chunks.push(value);
      size += value.length;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return { text: new TextDecoder().decode(Buffer.concat(chunks)), capped };
}

/**
 * Run argv with the hook's minimal env. Throws on a timeout, on too much
 * output, or on a non-zero exit, with the tail of stderr in the message.
 */
export async function runBounded(
  argv: string[],
  opts: { hookId: string; cwd: string; stdin?: string; env?: Record<string, string | undefined>; timeoutMs?: number },
): Promise<BoundedResult> {
  mkdirSync(hookStateDir(opts.hookId), { recursive: true, mode: 0o700 });
  const proc = Bun.spawn(argv, {
    cwd: opts.cwd,
    env: hookEnv(opts.hookId, opts.env),
    stdin: opts.stdin === undefined ? "ignore" : new Blob([opts.stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const timeoutMs = opts.timeoutMs ?? SCRIPT_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill("SIGKILL");
  }, timeoutMs);
  try {
    const [out, err] = await Promise.all([
      readCapped(proc.stdout as ReadableStream<Uint8Array>, SCRIPT_OUTPUT_MAX_BYTES),
      readCapped(proc.stderr as ReadableStream<Uint8Array>, 8 * 1024),
    ]);
    if (out.capped) proc.kill("SIGKILL");
    const exitCode = await proc.exited;
    if (timedOut) throw new Error(`${argv[0]} timed out after ${timeoutMs / 1000}s`);
    if (out.capped) throw new Error(`${argv[0]} printed more than ${SCRIPT_OUTPUT_MAX_BYTES} bytes`);
    if (exitCode !== 0) {
      const tail = err.text.trim().split("\n").slice(-3).join(" | ").slice(0, 300);
      throw new Error(`${argv[0]} exited ${exitCode}${tail ? `: ${tail}` : ""}`);
    }
    return { exitCode, stdout: out.text, stderr: err.text };
  } finally {
    clearTimeout(timer);
  }
}
