import { fxBin } from "../../tmux.ts";

/** The final object `fx ask --json` prints on stdout. */
type FxAskResult = {
  output?: string;
  exit_code?: number;
  model?: string;
  session_id?: string;
  steps?: number;
  error?: string;
};

/**
 * `fx ask` is fx's headless one-shot surface, and `--json` makes the last stdout
 * line a single result object. That is what scheduled auto-agent runs need.
 *
 * Permission handling differs from the interactive session on purpose:
 *   --auto  approves read-only work and reviews changes (a scheduled run has
 *           nobody to answer, so a review request simply ends the turn)
 *   --yolo  disables permission checks outright, for a writable run
 *
 * `--no-save` keeps a cron run out of the user's `fx resume` history.
 */
export async function pipeToFxCli(
  prompt: string,
  log: (s: string) => void,
  opts: {
    model?: string;
    cwd?: string;
    /** When true, allow writes/shell (default is read-only). */
    writable?: boolean;
  } = {},
): Promise<string> {
  const cwd = opts.cwd ?? process.cwd();
  const model = opts.model ?? "auto";
  const argv = [fxBin(), "ask", opts.writable ? "--yolo" : "--auto", "--json", "--no-save"];
  argv.push("--", prompt);

  log(`[runner] piping ${prompt.length} chars to fx ask (${model})`);
  const proc = Bun.spawn({
    cmd: argv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    // fx has no --model flag on `ask`; the model comes from its own settings.
    env: { ...process.env },
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (err.trim()) log(`[runner] fx stderr: ${err.slice(0, 400)}`);

  const result = parseFxAskResult(out);
  // A failed run still prints a well-formed result object, and it puts the
  // diagnostic in `output` — an auth failure reads as
  // {"output":"AI_GATEWAY_API_KEY authentication failed · HTTP 401\n",
  //  "exit_code":1,...}. Returning that would file the error as the agent's
  // answer, so `exit_code` decides the outcome, not the presence of text.
  if (result) {
    if (result.error) throw new Error(`fx ask failed: ${result.error}`);
    if (result.exit_code !== 0) {
      throw new Error(
        `fx ask exited ${result.exit_code}: ${(result.output ?? "").trim().slice(0, 1000) || "no output"}`,
      );
    }
  } else if (code !== 0) {
    throw new Error(`fx ask exited ${code}: ${err.slice(0, 1000) || out.slice(0, 1000)}`);
  }
  const text = (result?.output ?? out).trim();
  if (!text) throw new Error("fx ask produced empty output");
  log(`[runner] fx done (${text.length} chars)`);
  return text;
}

/**
 * fx streams progress before the final object, so take the last parseable JSON
 * line rather than the whole of stdout.
 */
export function parseFxAskResult(stdout: string): FxAskResult | null {
  const lines = stdout.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(line) as FxAskResult;
      if (typeof parsed === "object" && parsed !== null && "output" in parsed) return parsed;
    } catch {}
  }
  return null;
}
