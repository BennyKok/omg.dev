const DEFAULT_RUNTIME_ORIGIN = "http://127.0.0.1:8766";
const READY_PATH = "/api/install?ready=1";

export type DesktopEnvironment = Record<string, string | undefined>;

export type RuntimeFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type RuntimeWaitOptions = {
  fetch?: RuntimeFetch;
  intervalMs?: number;
  signal?: AbortSignal;
};

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

/**
 * Resolve the one service origin the desktop shell may load.
 *
 * The local control plane has no application-layer authentication. Keeping the
 * shell on loopback is therefore a security boundary, not only a default.
 */
export function runtimeOrigin(env: DesktopEnvironment = process.env): string {
  const configured = env.OMG_DESKTOP_URL?.trim();
  const port = env.OMG_PORT?.trim() || env.LFG_PORT?.trim() || "8766";
  const url = new URL(configured || `http://127.0.0.1:${port}`);

  if (url.protocol !== "http:" || !isLoopbackHostname(url.hostname)) {
    throw new Error("OMG_DESKTOP_URL must be an HTTP loopback URL.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("OMG_DESKTOP_URL must contain only an origin and optional path.");
  }

  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.href.replace(/\/$/, "");
}

export async function runtimeIsReady(
  origin: string,
  fetcher: RuntimeFetch = fetch,
): Promise<boolean> {
  try {
    const response = await fetcher(new URL(READY_PATH, `${origin}/`), {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { bootId?: unknown };
    return typeof body.bootId === "string" && body.bootId.length > 0;
  } catch {
    return false;
  }
}

export async function waitForRuntime(
  origin: string,
  options: RuntimeWaitOptions = {},
): Promise<boolean> {
  const fetcher = options.fetch ?? fetch;
  const intervalMs = options.intervalMs ?? 1_500;

  while (!options.signal?.aborted) {
    if (await runtimeIsReady(origin, fetcher)) return true;
    await Bun.sleep(intervalMs);
  }
  return false;
}

export const DEFAULT_DESKTOP_RUNTIME_ORIGIN = DEFAULT_RUNTIME_ORIGIN;
