// `omg doctor` — one command a user can run and paste when something is wrong.
//
// Why this exists: on 2026-08-18 a user reported "it is stuck" with a
// screenshot of a spinner. That was true and useless — the real cause was a
// harness that had already exited 1 in total silence, and finding it took a
// clean VM, a traced subprocess, and several hours. Nothing the user could see
// or send would have shortened that, because the failure produced no output at
// all. The bugs behind that report are fixed, but the reporting gap is its own
// defect: a self-hosted install has no way to describe itself.
//
// So this collects the things that actually decide whether a session can start
// — versions, which agent binaries exist, which accounts are connected, whether
// the server is up, and the tail of the harness log — into one block of text.
//
// Two rules shape everything here:
//
//   1. It must run when omg.dev is broken. It reads files and probes PATH; it
//      does not require the server, and every probe is individually guarded, so
//      a doctor that hits an unexpected error still prints what it did learn.
//      A diagnostic that dies on a broken box is worthless precisely when it
//      matters.
//
//   2. It must be safe to paste in public. Users will put this in Discord and
//      GitHub issues. Anything that could carry a token is redacted by pattern
//      rather than by an allowlist of known key names, because the next secret
//      to appear in a log will not be on any list we wrote today.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Strip anything that looks like a credential.
 *
 * Deliberately pattern-based, not name-based. An allowlist of known variable
 * names ("ANTHROPIC_API_KEY", …) only protects against the secrets we already
 * thought of; the token that leaks will be the one added next week under a name
 * nobody updated here. These patterns match the SHAPE of a secret, so a new
 * provider's key is covered on the day it appears.
 */
export function redact(text: string): string {
  return text
    // Provider keys: sk-…, sk-ant-…, omg_sk_…, xai-…, ghp_…, github_pat_…
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|omg_sk_[A-Za-z0-9_-]{8,}|xai-[A-Za-z0-9_-]{8,})/g, "[redacted-key]")
    .replace(/\b(gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})/g, "[redacted-token]")
    // Tailscale auth keys and OAuth client secrets.
    .replace(/\btskey-[A-Za-z0-9-]{8,}/g, "[redacted-tailscale-key]")
    // Credentials embedded in a URL (https://user:pass@host). These reach logs
    // through git remotes and proxy settings, and no key-name pattern sees them
    // because the secret is positional rather than named.
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, "$1$2:[redacted]@")
    // Bearer tokens and anything assigned to a key/token/secret/password name.
    .replace(/\b(bearer\s+)[A-Za-z0-9._~+/-]{12,}=*/gi, "$1[redacted]")
    .replace(
      /\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Za-z0-9_]*)(\s*[=:]\s*)("?)([^"\s,}]{6,})\3/gi,
      "$1$2$3[redacted]$3",
    )
    // JWTs, which carry identity even when no name gives them away.
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[redacted-jwt]")
    // Long hex/base64 runs are almost never useful in a report and are exactly
    // what an unrecognised secret looks like.
    .replace(/\b[A-Fa-f0-9]{40,}\b/g, "[redacted-hash]");
}

/** Replace the user's home directory with ~, so paths do not leak a username. */
export function shortenHome(text: string, home = homedir()): string {
  if (!home || home === "/") return text;
  return text.split(home).join("~");
}

/** Everything a report line goes through before it is printed. */
export function sanitize(text: string, home = homedir()): string {
  return redact(shortenHome(text, home));
}

type Probe = { label: string; value: string; ok?: boolean };

/**
 * Run one probe, and never let it take the report down with it.
 *
 * The whole point of a doctor is that it runs on a broken machine, so a probe
 * that throws must degrade to a line saying so rather than an unhandled
 * rejection that loses every other finding.
 */
async function probe(label: string, fn: () => string | Promise<string>): Promise<Probe> {
  try {
    return { label, value: await fn() };
  } catch (e) {
    return { label, value: `(failed: ${e instanceof Error ? e.message : String(e)})`, ok: false };
  }
}

function commandVersion(bin: string, args: string[] = ["--version"]): string {
  const which = Bun.which(bin);
  if (!which) return "not found";
  try {
    const r = Bun.spawnSync({ cmd: [which, ...args], stdout: "pipe", stderr: "pipe" });
    const out = (new TextDecoder().decode(r.stdout) || new TextDecoder().decode(r.stderr)).trim();
    return `${which} (${out.split("\n")[0] || "no version output"})`;
  } catch {
    return which;
  }
}

/**
 * The most recent lines that look like a problem, from the newest log.
 *
 * A raw tail is the wrong thing to paste: these logs are dominated by per-request
 * timing rows, so 40 lines of tail is 40 lines of healthy noise that pushes the
 * one interesting line out of view. Filter to lines that carry a failure signal
 * and fall back to a plain tail only when nothing matches — an absence of errors
 * is itself worth seeing.
 */
export function recentLogTail(logDir: string, lines = 25): string {
  if (!existsSync(logDir)) return "(no log directory)";
  const files = readdirSync(logDir)
    .map((name) => join(logDir, name))
    .filter((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    })
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!files.length) return "(no log files)";
  const body = readFileSync(files[0], "utf8").split("\n").filter(Boolean);
  const interesting = body.filter((l) =>
    /error|fail|fatal|could not|cannot|not found|denied|refused|exit(ed)? [1-9]|unexpected/i.test(l),
  );
  const chosen = interesting.length ? interesting.slice(-lines) : body.slice(-5);
  const header = interesting.length
    ? `${files[0]} (${interesting.length} problem lines, newest last)`
    : `${files[0]} (no problem lines found; last 5 shown)`;
  return `${header}\n${chosen.join("\n")}`;
}

export async function cmdDoctor(argv: string[] = []): Promise<void> {
  const json = argv.includes("--json");
  const { PATHS, installInfo } = await import("../config.ts");
  const probes: Probe[] = [];

  probes.push(await probe("omg.dev", () => {
    const info = installInfo();
    const pkg = JSON.parse(readFileSync(join(PATHS.root, "package.json"), "utf8")) as { version?: string };
    return `${pkg.version ?? "unknown"} (${info.channel} install${info.release ? `, ${info.release}` : ""})`;
  }));
  probes.push(await probe("platform", () => `${process.platform}-${process.arch}, bun ${Bun.version}`));
  probes.push(await probe("install root", () => PATHS.root));

  // Which agent binaries exist. A session cannot start without one, and this is
  // the single most common reason a fresh install cannot do anything.
  for (const bin of ["claude", "codex", "opencode", "jcode", "grok", "cursor-agent", "fx", "muse"]) {
    probes.push(await probe(`agent: ${bin}`, () => commandVersion(bin)));
  }

  // The Agent SDK's own native binary — absent from pruned bundles, which is
  // exactly the failure that produced a silent exit and an endless spinner.
  probes.push(await probe("claude-agent-sdk native binary", () => {
    const base = join(PATHS.root, "node_modules", "@anthropic-ai");
    if (!existsSync(base)) return "(no @anthropic-ai packages)";
    const platform = readdirSync(base).filter((n) => n.startsWith("claude-agent-sdk-"));
    return platform.length
      ? platform.join(", ")
      : "MISSING — the SDK cannot spawn its own runtime; install the Claude CLI or connect an account";
  }));

  // Connected accounts, by presence only. Never read the credentials.
  probes.push(await probe("connected accounts", async () => {
    const { listCodingAgents } = await import("../coding-agents.ts");
    const agents = await listCodingAgents();
    const connected = agents
      .filter((a) => a.status.accountConnected || a.status.configured)
      .map((a) => `${a.label}${a.status.accountConnected ? "" : " (configured, not signed in)"}`);
    return connected.length ? connected.join(", ") : "none — no agent can start a session";
  }));

  probes.push(await probe("server", async () => {
    const port = process.env.OMG_PORT ?? process.env.LFG_PORT ?? "8766";
    const host = process.env.OMG_HOST ?? process.env.LFG_HOST ?? "127.0.0.1";
    try {
      const r = await fetch(`http://${host}:${port}/api/sessions`, {
        signal: AbortSignal.timeout(3000),
      });
      const body = (await r.json()) as { sessions?: unknown[] };
      return `responding on ${host}:${port} (${body.sessions?.length ?? 0} sessions)`;
    } catch (e) {
      return `NOT responding on ${host}:${port} (${e instanceof Error ? e.message : e})`;
    }
  }));

  probes.push(await probe("recent log", () => recentLogTail(join(PATHS.data, "logs"))));

  if (json) {
    console.log(sanitize(JSON.stringify(Object.fromEntries(probes.map((p) => [p.label, p.value])), null, 2)));
    return;
  }

  // Fenced, because the destination is a GitHub issue or a Discord message and
  // an unfenced log tail is unreadable in both.
  const lines = [
    "```",
    "omg.dev doctor",
    ...probes.map((p) => `${p.label.padEnd(32)} ${p.value.includes("\n") ? `\n${p.value}` : p.value}`),
    "```",
    "",
    "Paste the block above into your bug report. Keys and tokens are already removed.",
  ];
  console.log(sanitize(lines.join("\n")));
}
