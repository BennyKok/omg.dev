import { hermesBin } from "../../tmux.ts";

export async function pipeToHermesCli(
  prompt: string,
  log: (s: string) => void,
  opts: { model?: string; cwd?: string } = {},
): Promise<string> {
  const cwd = opts.cwd ?? process.cwd();
  const argv = [hermesBin(), "--yolo", "--cli", "chat"];
  if (opts.model) argv.push("--model", opts.model);
  const provider = process.env.LFG_HERMES_PROVIDER?.trim();
  if (provider) argv.push("--provider", provider);
  argv.push("-q", prompt);

  log(
    `[runner] piping ${prompt.length} chars to hermes chat -q${opts.model ? ` (${opts.model})` : ""}${
      provider ? ` via ${provider}` : ""
    }`,
  );
  const proc = Bun.spawn({
    cmd: argv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`hermes chat exited ${code}: ${err.slice(0, 1000) || out.slice(0, 1000)}`);
  }
  if (err.trim()) log(`[runner] hermes stderr: ${err.slice(0, 400)}`);
  const text = out.trim();
  if (!text) throw new Error("hermes chat produced empty output");
  log(`[runner] hermes done (${text.length} chars)`);
  return text;
}
