import { existsSync } from "node:fs";
import { localServeBaseUrl } from "./config.ts";
import { isDesktopEmbeddedRuntime } from "./desktop-parent.ts";

export type TailscaleCommandResult = {
  ok: boolean;
  text: string;
  available?: boolean;
};

export type TailscaleCommandRunner = (
  argv: string[],
) => Promise<TailscaleCommandResult>;

export type ServerAccessInfo = {
  runtime: "desktop" | "self-hosted";
  localUrl: string;
  tailscale: {
    installed: boolean;
    connected: boolean;
    dnsName: string | null;
    serveEnabled: boolean;
    serveUrl: string | null;
    command: string;
  };
};

type TailscaleStatus = {
  BackendState?: unknown;
  Self?: {
    DNSName?: unknown;
    Online?: unknown;
  };
};

function parseJsonObjectStrict(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

// The macOS app's command can print a notice (for example a client and
// daemon version mismatch) on stdout before the JSON document, so a failed
// parse retries on the outermost object.
function parseJsonObject(text: string): Record<string, unknown> | null {
  const strict = parseJsonObjectStrict(text);
  if (strict) return strict;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? parseJsonObjectStrict(text.slice(start, end + 1)) : null;
}

export function parseTailscaleStatus(text: string): {
  connected: boolean;
  dnsName: string | null;
} {
  const value = parseJsonObject(text) as TailscaleStatus | null;
  const rawName = value?.Self?.DNSName;
  const dnsName =
    typeof rawName === "string" && rawName.trim()
      ? rawName.trim().replace(/\.+$/, "")
      : null;
  // `Running` with a device name is a connected node. `Self.Online` is the
  // coordination server's view of this node and can lag or be false on the
  // macOS network extension while the tunnel works, so it is not required.
  return {
    connected: value?.BackendState === "Running" && dnsName != null,
    dnsName,
  };
}

function proxyTargets(value: unknown, targets: string[]): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) proxyTargets(entry, targets);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === "Proxy" && typeof entry === "string") targets.push(entry);
    else proxyTargets(entry, targets);
  }
}

export function tailscaleServeTargetsPort(text: string, port: number): boolean {
  const value = parseJsonObject(text);
  if (!value) return false;
  const targets: string[] = [];
  proxyTargets(value, targets);
  return targets.some((target) => {
    try {
      const url = new URL(target);
      const targetPort = Number(url.port || (url.protocol === "https:" ? "443" : "80"));
      return (
        url.protocol === "http:" &&
        (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1") &&
        targetPort === port
      );
    } catch {
      return false;
    }
  });
}

function tailscalePath(): string | null {
  const resolved = Bun.which("tailscale");
  if (resolved) return resolved;
  const candidates = [
    "/opt/homebrew/bin/tailscale",
    "/usr/local/bin/tailscale",
    "/usr/bin/tailscale",
    // The Mac App Store and standalone Tailscale apps ship the command inside
    // the bundle and install nothing on PATH until "Install CLI" is chosen.
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

const TAILSCALE_COMMAND_TIMEOUT_MS = 6_000;

async function runTailscaleCommand(argv: string[]): Promise<TailscaleCommandResult> {
  const executable = tailscalePath();
  if (!executable) return { ok: false, text: "", available: false };
  const child = Bun.spawn({
    cmd: [executable, ...argv],
    stdout: "pipe",
    stderr: "ignore",
  });
  const result = await Promise.race([
    child.exited.then((code) => ({ type: "exit" as const, code })),
    // The macOS app's command starts the app binary, which can take several
    // seconds on a cold start. A timeout reads as "not connected".
    Bun.sleep(TAILSCALE_COMMAND_TIMEOUT_MS).then(() => ({ type: "timeout" as const })),
  ]);
  if (result.type === "timeout") {
    try {
      child.kill();
    } catch {
      // The command can exit between the timeout and cleanup.
    }
    return { ok: false, text: "", available: true };
  }
  const text = await new Response(child.stdout).text();
  return { ok: result.code === 0, text, available: true };
}

export async function serverAccessInfo(options: {
  env?: Record<string, string | undefined>;
  localUrl?: string;
  run?: TailscaleCommandRunner;
} = {}): Promise<ServerAccessInfo> {
  const env = options.env ?? process.env;
  const localUrl = options.localUrl ?? localServeBaseUrl();
  const port = Number(new URL(localUrl).port || "80");
  const command = `tailscale serve --bg localhost:${port}`;
  const run = options.run ?? runTailscaleCommand;
  const statusResult = await run(["status", "--json"]);
  const status = statusResult.ok
    ? parseTailscaleStatus(statusResult.text)
    : { connected: false, dnsName: null };
  const serveResult = status.connected
    ? await run(["serve", "status", "--json"])
    : { ok: false, text: "" };
  const serveEnabled =
    serveResult.ok && tailscaleServeTargetsPort(serveResult.text, port);

  return {
    runtime: isDesktopEmbeddedRuntime(env) ? "desktop" : "self-hosted",
    localUrl,
    tailscale: {
      installed: statusResult.available ?? statusResult.ok,
      connected: status.connected,
      dnsName: status.dnsName,
      serveEnabled,
      serveUrl:
        serveEnabled && status.dnsName ? `https://${status.dnsName}` : null,
      command,
    },
  };
}

export async function handleServerAccessRequest(
  options: Parameters<typeof serverAccessInfo>[0] = {},
): Promise<Response> {
  return Response.json({ access: await serverAccessInfo(options) });
}
