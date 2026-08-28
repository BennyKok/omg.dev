import { existsSync } from "node:fs";
import { localServeBaseUrl } from "./config.ts";

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

function parseJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
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
  return {
    connected:
      value?.BackendState === "Running" && value?.Self?.Online === true && dnsName != null,
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
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

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
    Bun.sleep(2_000).then(() => ({ type: "timeout" as const })),
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
    runtime: env.OMG_DESKTOP_PARENT_PID?.trim() ? "desktop" : "self-hosted",
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
