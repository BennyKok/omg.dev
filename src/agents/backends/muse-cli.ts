// Headless one-shot Muse Code run for scheduled auto agents: `muse exec --json`
// prints one JSONL record per runtime event, and the run's terminal record
// carries the final reply. Recorded against muse 1.0.2.
import { museReasoningEffort, musePath } from "./muse-msp-session.ts";

type MuseExecRecord = {
  payload_type?: string;
  payload?: { text?: string; terminal?: string; reason?: string | null; message?: string };
};

export type MuseExecOutcome = {
  text: string;
  terminal: string | null;
  reason: string | null;
};

/**
 * Fold the JSONL stream: the `run.terminal.*` record is authoritative for the
 * terminal and its `text`; `run.output.delta` records are the streamed fallback
 * when the terminal record omits the text.
 */
export function parseMuseExecOutput(stdout: string): MuseExecOutcome {
  let deltas = "";
  let terminal: string | null = null;
  let reason: string | null = null;
  let text: string | null = null;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let record: MuseExecRecord;
    try {
      record = JSON.parse(trimmed) as MuseExecRecord;
    } catch {
      continue;
    }
    const type = record.payload_type ?? "";
    const payload = record.payload ?? {};
    if (type === "run.output.delta" && typeof payload.text === "string") deltas += payload.text;
    if (type.startsWith("run.terminal.")) {
      terminal = payload.terminal ?? type.slice("run.terminal.".length);
      reason = payload.reason ?? payload.message ?? null;
      if (typeof payload.text === "string" && payload.text) text = payload.text;
    }
  }
  return { text: (text ?? deltas).trim(), terminal, reason };
}

export function museExecArgv(opts: {
  cwd: string;
  model?: string;
  thinkingLevel?: string;
  writable?: boolean;
  provider?: string;
}): string[] {
  const argv = [musePath(), "exec", "--json", "--workspace", opts.cwd, "--user-input-auto-resolve"];
  if (opts.writable) {
    // A scheduled run has nobody to answer an approval prompt.
    argv.push("--yolo");
  } else {
    argv.push("--disable-approval", "--disable-sandbox", "--disable-write", "--disable-shell");
  }
  if (opts.model && opts.model !== "auto") argv.push("--model", opts.model);
  const effort = museReasoningEffort(opts.thinkingLevel);
  if (effort) argv.push("--reasoning-effort", effort);
  if (opts.provider) argv.push("--provider", opts.provider);
  return argv;
}

export async function pipeToMuseCli(
  prompt: string,
  log: (s: string) => void,
  opts: {
    model?: string;
    thinkingLevel?: string;
    cwd?: string;
    /** When true, allow writes/shell (default is read-only). */
    writable?: boolean;
  } = {},
): Promise<string> {
  const cwd = opts.cwd ?? process.cwd();
  const argv = museExecArgv({
    cwd,
    model: opts.model,
    thinkingLevel: opts.thinkingLevel,
    writable: opts.writable,
    // Test hook: the echo provider answers without a Meta login.
    provider: process.env.LFG_MUSE_PROVIDER?.trim() || undefined,
  });
  argv.push("--prompt-file", "/dev/stdin");

  log(`[runner] piping ${prompt.length} chars to muse exec (${opts.model ?? "default"})`);
  const proc = Bun.spawn({
    cmd: argv,
    cwd,
    stdin: new TextEncoder().encode(prompt),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (err.trim()) log(`[runner] muse stderr: ${err.slice(0, 400)}`);

  const result = parseMuseExecOutput(out);
  if (result.terminal && result.terminal !== "completed") {
    throw new Error(`muse exec ${result.terminal}: ${result.reason ?? result.text.slice(0, 1000) ?? "no output"}`);
  }
  if (code !== 0 && !result.terminal) {
    throw new Error(`muse exec exited ${code}: ${err.slice(0, 1000) || out.slice(0, 1000)}`);
  }
  if (!result.text) throw new Error("muse exec produced empty output");
  log(`[runner] muse done (${result.text.length} chars)`);
  return result.text;
}
