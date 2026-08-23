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
  /**
   * Whether the timeout could signal the whole process GROUP rather than only
   * the shell. False when this box has no `setsid` (macOS), where anything the
   * command spawned may still be running.
   *
   * TRUE IS NOT A GUARANTEE THAT NOTHING SURVIVED. A command that starts its
   * own new session — `setsid foo &`, a daemon that double-forks — leaves the
   * group we signal, and measurably survives. `nohup ... &` and `disown` do
   * NOT escape, because neither creates a session. Containing a deliberate
   * escape needs a PID namespace or a cgroup, which is a box-provisioning
   * decision rather than something this endpoint can do; and a caller that can
   * reach this API can already start a coding agent that daemonizes anything
   * it likes. Reported so a caller knows which guarantee it has, not as proof
   * the work stopped.
   */
  killedGroup: boolean;
  durationMs: number;
  cwd: string;
}

/**
 * Drop an incomplete UTF-8 sequence from the END of a buffer.
 *
 * Head and tail are cut at byte offsets, which lands mid-codepoint on any
 * multibyte output. Decoding the halves separately then renders each severed
 * sequence as U+FFFD — a stream of `€` came back with replacement characters
 * at both seams. Trimming the partial bytes loses at most three bytes that
 * were already inside a truncation marker, and keeps the text valid.
 */
function trimPartialSequenceAtEnd(buf: Uint8Array): Uint8Array {
  // A sequence is at most 4 bytes, so a lead byte further back than 3 is
  // necessarily complete.
  for (let back = 1; back <= Math.min(4, buf.byteLength); back++) {
    const byte = buf[buf.byteLength - back]!;
    if ((byte & 0b1100_0000) === 0b1000_0000) continue; // continuation
    const needed =
      (byte & 0b1000_0000) === 0 ? 1 :
      (byte & 0b1110_0000) === 0b1100_0000 ? 2 :
      (byte & 0b1111_0000) === 0b1110_0000 ? 3 :
      (byte & 0b1111_1000) === 0b1111_0000 ? 4 : 1;
    // Complete: the whole sequence fits before the end. Otherwise cut it off.
    return needed <= back ? buf : buf.subarray(0, buf.byteLength - back);
  }
  return buf;
}

/** Drop orphaned continuation bytes from the START of a buffer. */
function trimPartialSequenceAtStart(buf: Uint8Array): Uint8Array {
  let at = 0;
  while (at < buf.byteLength && at < 3 && (buf[at]! & 0b1100_0000) === 0b1000_0000) at++;
  return at === 0 ? buf : buf.subarray(at);
}

/**
 * Read a stream to its end while never holding more than the cap in memory.
 *
 * THE BUG THIS REPLACES: the first version buffered the whole stream and
 * clipped afterwards, which caps the RESPONSE but not the READ. `yes | cat`
 * took the server from 220 MB to 2.5 GB of RSS in about ten seconds, and the
 * timeout could not save it because the buffering await never resolved. A
 * one-shot command endpoint is reachable by anything that can reach this API,
 * so unbounded accumulation here is a denial of service on the whole box.
 *
 * Keeps the head AND a rolling tail: a failure's cause is at the top (the
 * first error) and its verdict at the bottom (the summary line), so keeping
 * one end reliably discards the half the caller needed.
 */
async function readCapped(
  stream: ReadableStream<Uint8Array>,
): Promise<{ text: string; truncated: boolean }> {
  const half = Math.floor(MAX_EXEC_OUTPUT_BYTES / 2);
  const head: Uint8Array[] = [];
  let headBytes = 0;
  // Rolling window. Chunks fall off the front as new ones arrive, so this
  // holds at most `half` bytes plus one chunk regardless of stream length.
  const tail: Uint8Array[] = [];
  let tailBytes = 0;
  let total = 0;

  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;

      if (headBytes < half) {
        const take = Math.min(half - headBytes, value.byteLength);
        head.push(value.subarray(0, take));
        headBytes += take;
        if (take === value.byteLength) continue;
        tail.push(value.subarray(take));
        tailBytes += value.byteLength - take;
      } else {
        tail.push(value);
        tailBytes += value.byteLength;
      }
      // Trim to EXACTLY `half`, slicing the oldest chunk rather than only
      // dropping whole ones. A pipe can hand over a single chunk far larger
      // than the window, and keeping it intact was letting the tail run to
      // ~245 KB against a 32 KB budget.
      while (tailBytes > half) {
        const first = tail[0]!;
        const excess = tailBytes - half;
        if (first.byteLength <= excess) {
          tail.shift();
          tailBytes -= first.byteLength;
        } else {
          tail[0] = first.subarray(excess);
          tailBytes -= excess;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const decoder = new TextDecoder();
  const joinBytes = (parts: Uint8Array[], bytes: number): Uint8Array => {
    const out = new Uint8Array(bytes);
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.byteLength;
    }
    return out;
  };

  // THREE cut points can land mid-codepoint, not two. The seams are obvious;
  // the third is the end of the stream itself, because SIGKILL stops the
  // producer wherever it happens to be — including halfway through writing a
  // character. That one bites the untruncated case too, so it is repaired on
  // every path rather than only when a seam exists.
  if (total <= MAX_EXEC_OUTPUT_BYTES) {
    const whole = trimPartialSequenceAtEnd(joinBytes([...head, ...tail], headBytes + tailBytes));
    return { text: decoder.decode(whole), truncated: false };
  }
  const headBytesTrimmed = trimPartialSequenceAtEnd(joinBytes(head, headBytes));
  const tailBytesTrimmed = trimPartialSequenceAtEnd(
    trimPartialSequenceAtStart(joinBytes(tail, tailBytes)),
  );
  const omitted = total - headBytesTrimmed.byteLength - tailBytesTrimmed.byteLength;
  return {
    text: `${decoder.decode(headBytesTrimmed)}\n… ${omitted} bytes omitted …\n${decoder.decode(tailBytesTrimmed)}`,
    truncated: true,
  };
}

/**
 * `setsid` puts the command in its own process group so the whole tree can be
 * signalled at once.
 *
 * Without it, killing the shell orphans everything it started: `yes | cat`
 * left both halves running after the timeout fired, burning a core until
 * someone noticed. Measured — group kill leaves 0 survivors, killing the
 * shell alone leaves 1.
 *
 * Resolved once at load. macOS has no setsid binary, so a box without it
 * degrades to killing the shell only rather than failing to run commands at
 * all; the orphan risk is named in ExecResult.killedGroup.
 */
const SETSID = Bun.which("setsid");

/**
 * Every live descendant of `pid`, deepest first.
 *
 * `pgrep -P` rather than /proc so this also works on macOS. Deepest first so a
 * parent cannot spawn a replacement between the moment we kill it and the
 * moment we reach its children.
 */
function descendantPids(pid: number): number[] {
  const out: number[] = [];
  const visit = (parent: number, depth: number): void => {
    // A tree deeper than this is pathological; stop rather than recurse
    // forever if the table is somehow cyclic.
    if (depth > 16) return;
    const result = Bun.spawnSync(["pgrep", "-P", String(parent)]);
    for (const line of result.stdout.toString().trim().split("\n")) {
      const child = Number(line);
      if (!Number.isInteger(child) || child <= 1) continue;
      visit(child, depth + 1);
      out.push(child);
    }
  };
  visit(pid, 0);
  return out;
}

/**
 * Stop a timed-out command as completely as this box allows.
 *
 * Two mechanisms, because neither alone is enough:
 *
 *   - The process GROUP catches an ordinary pipeline, whose members share the
 *     shell's group. This is the common case.
 *   - A DESCENDANT SWEEP catches a child that left the group but not the tree
 *     — anything that called setpgid without starting a new session. Group
 *     kill alone misses those entirely.
 *
 * Neither catches a true double-fork: `setsid foo &` inside the command starts
 * a new session AND reparents to init, so it is in no group we know and no
 * longer a descendant of anything we hold. Containing that needs a PID
 * namespace or a cgroup — `unshare --pid` is unavailable unprivileged on this
 * box, so it is a provisioning decision rather than something this file can
 * fix. Callers get `killedGroup` to say which guarantee they have.
 *
 * Returns how many strays the sweep killed beyond the group.
 */
function killCommandTree(pid: number, useGroup: boolean): { group: boolean; strays: number } {
  // Enumerate BEFORE killing: once a parent dies its children reparent to init
  // and become unfindable by this walk.
  const strays = descendantPids(pid);

  let group = false;
  if (useGroup) {
    try {
      process.kill(-pid, 9);
      group = true;
    } catch {
      // Group already gone.
    }
  }
  try {
    process.kill(pid, 9);
  } catch {
    // Already gone.
  }

  let killed = 0;
  for (const stray of strays) {
    try {
      process.kill(stray, 9);
      killed++;
    } catch {
      // Already died with the group — the common case, and not an error.
    }
  }
  return { group, strays: killed };
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

  const child = spawn([...(SETSID ? [SETSID] : []), "bash", "-lc", request.command], {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });

  let timedOut = false;
  let killedGroup = false;
  const timer = setTimeout(() => {
    timedOut = true;
    // SIGKILL, not SIGTERM. This is already past a deadline the caller is
    // blocked on, and a process that ignores TERM would hold them past it.
    // Killing the group also unblocks the reads above, which cannot finish
    // while any surviving child still holds the pipe open.
    killedGroup = killCommandTree(child.pid, SETSID !== null).group;
  }, timeoutMs);

  try {
    const [out, err, exitCode] = await Promise.all([
      readCapped(child.stdout as ReadableStream<Uint8Array>),
      readCapped(child.stderr as ReadableStream<Uint8Array>),
      child.exited,
    ]);
    return {
      exitCode: timedOut ? null : exitCode,
      stdout: out.text,
      stderr: timedOut
        ? `${err.text}${err.text ? "\n" : ""}Command exceeded ${timeoutMs}ms and was killed${killedGroup ? " (process group signalled)" : " (shell only — spawned processes may still be running)"}. Long work belongs in a session, not a one-shot command.`
        : err.text,
      truncated: out.truncated || err.truncated,
      timedOut,
      killedGroup: timedOut ? killedGroup : true,
      durationMs: Math.round(performance.now() - started),
      cwd,
    };
  } finally {
    clearTimeout(timer);
  }
}
