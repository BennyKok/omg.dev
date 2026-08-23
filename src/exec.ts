// One-shot command execution on this box.
//
// WHY THIS EXISTS AT ALL. An agent running ON this machine already has a
// shell; it does not need an HTTP endpoint to run `git status`. A REMOTE
// caller reaching this box through a relay has nothing, and without this its
// only way to look at a file is to spawn a whole coding-agent session — which
// costs a tmux pane, a model, and thirty seconds, to answer a question that
// takes ten milliseconds.
//
// ON THE SECURITY BOUNDARY. This does not widen it. `POST /api/sessions/new`
// already starts a coding agent with full shell on this box, so anything that
// can reach this API can already run arbitrary code. What changes is
// auditability, in the right direction: one recorded command with an exit code
// is far easier to reason about than an agent turn. The perimeter is, as ever,
// the loopback bind or whatever put this server behind a relay — see
// docs/remote-access.md.
//
// SHORT AND SYNCHRONOUS, ON PURPOSE. The whole point of a remote box is that
// work leaves the caller's process. A build that blocks the caller for four
// minutes defeats that, so this caps hard and tells the caller to delegate
// instead. Seconds here; minutes belong in a session.

import { resolve } from "node:path";

/** Long enough for a test file or a git command; short enough to never look hung. */
export const DEFAULT_EXEC_TIMEOUT_MS = 60_000;
export const MAX_EXEC_TIMEOUT_MS = 120_000;

/**
 * Per stream.
 *
 * Not a nicety. A relay frame caps at 16 MiB and base64 inflates it by 4/3, so
 * a full build log does not merely bloat a response — it exceeds the frame the
 * relay will accept and closes the box's socket with a 1009, taking the machine
 * offline. Truncation is a liveness requirement.
 */
export const MAX_EXEC_OUTPUT_BYTES = 64 * 1024;

export interface ExecRequest {
  command: string;
  cwd: string;
  timeoutMs?: number;
}

export interface ExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** True when either stream hit MAX_EXEC_OUTPUT_BYTES. Say so; never truncate silently. */
  truncated: boolean;
  timedOut: boolean;
  durationMs: number;
  cwd: string;
}

function clip(buf: Uint8Array): { text: string; truncated: boolean } {
  const decoder = new TextDecoder();
  if (buf.byteLength <= MAX_EXEC_OUTPUT_BYTES) {
    return { text: decoder.decode(buf), truncated: false };
  }
  // Keep the head AND the tail: a failing command's cause is usually at the
  // top (the first error) and its verdict at the bottom (the summary line).
  // Keeping only one end reliably discards the half the caller needed.
  const half = Math.floor(MAX_EXEC_OUTPUT_BYTES / 2);
  const head = decoder.decode(buf.slice(0, half));
  const tail = decoder.decode(buf.slice(buf.byteLength - half));
  const omitted = buf.byteLength - half * 2;
  return { text: `${head}\n… ${omitted} bytes omitted …\n${tail}`, truncated: true };
}

export function clampExecTimeout(raw: unknown): number {
  const value = typeof raw === "number" && Number.isFinite(raw) ? raw : DEFAULT_EXEC_TIMEOUT_MS;
  return Math.max(1_000, Math.min(MAX_EXEC_TIMEOUT_MS, Math.round(value)));
}

/**
 * Run `command` through a login shell and return everything about it.
 *
 * A login shell (`bash -lc`) rather than a bare exec: the caller's mental model
 * is a terminal on this machine, and the tools they expect — mise, nvm, a
 * PATH set in a profile — only exist in one.
 */
export async function runExecCommand(
  request: ExecRequest,
  spawn: typeof Bun.spawn = Bun.spawn,
): Promise<ExecResult> {
  const cwd = resolve(request.cwd);
  const timeoutMs = clampExecTimeout(request.timeoutMs);
  const started = performance.now();

  const child = spawn(["bash", "-lc", request.command], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    // SIGKILL, not SIGTERM. This is already past a deadline the caller is
    // blocked on, and a process that ignores TERM would hold them past it.
    try {
      child.kill(9);
    } catch {
      // Already gone.
    }
  }, timeoutMs);

  try {
    const [stdoutBuf, stderrBuf, exitCode] = await Promise.all([
      new Response(child.stdout).bytes(),
      new Response(child.stderr).bytes(),
      child.exited,
    ]);
    const out = clip(stdoutBuf);
    const err = clip(stderrBuf);
    return {
      exitCode: timedOut ? null : exitCode,
      stdout: out.text,
      stderr: timedOut
        ? `${err.text}${err.text ? "\n" : ""}Command exceeded ${timeoutMs}ms and was killed. Long work belongs in a session, not a one-shot command.`
        : err.text,
      truncated: out.truncated || err.truncated,
      timedOut,
      durationMs: Math.round(performance.now() - started),
      cwd,
    };
  } finally {
    clearTimeout(timer);
  }
}
