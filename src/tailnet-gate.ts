// Tailnet entry point for `lfg serve`.
//
// `lfg serve` has no login of its own (see SECURITY.md): its API trusts every
// caller that can reach the port. That is correct for loopback callers (agent
// tools on this box, and the omg relay, which authenticates the user before it
// forwards anything onto 127.0.0.1). It is wrong for a tailnet: any device on
// the tailnet (a shared Mac, a tagged server, another person's phone) could
// list sessions, start agents and send them input.
//
// When LFG_TAILNET_PORT is set, `lfg serve` opens a second loopback listener
// for `tailscale serve` to point at. Every request on it came from the
// tailnet, so the gate below applies to all of them, with no header guessing:
//
// - A browser page load is redirected to the same place in the omg web app
//   (https://omg.dev/computers/<boxId>[/sessions/<id>]), which requires the
//   owner's omg sign-in, the same as every other public path.
// - The connector OAuth callback passes through: the provider redirects the
//   browser there, and the handler only accepts a state this box issued.
// - Everything else, the API and websockets included, gets 401.

export type TailnetGateOptions = {
  /** Relay binding id of this box, or null when the box is not paired. */
  boxId: string | null;
  /** Origin of the omg web app. */
  webOrigin: string;
};

export const TAILNET_PASSTHROUGH_PATHS = new Set(["/api/connectors/oauth/callback"]);

const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

function isPageLoad(req: Request, path: string): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (path.startsWith("/api/") || path === "/api") return false;
  if (req.headers.get("upgrade")) return false;
  if (path === "/" || path === "/index.html") return true;
  return (req.headers.get("accept") ?? "").includes("text/html");
}

export function omgWebTarget(url: URL, options: TailnetGateOptions): string | null {
  if (!options.boxId) return null;
  const origin = options.webOrigin.replace(/\/+$/, "");
  const box = encodeURIComponent(options.boxId);
  const session = url.searchParams.get("session")?.trim();
  if (session && SESSION_ID.test(session)) {
    return `${origin}/computers/${box}/sessions/${encodeURIComponent(session)}`;
  }
  return `${origin}/computers/${box}`;
}

/**
 * Returns the response for a tailnet request, or null when the request may
 * reach the normal `lfg serve` handler.
 */
export function tailnetGateResponse(req: Request, options: TailnetGateOptions): Response | null {
  const url = new URL(req.url);
  const path = url.pathname;
  if (req.method === "GET" && TAILNET_PASSTHROUGH_PATHS.has(path)) return null;

  if (isPageLoad(req, path)) {
    const target = omgWebTarget(url, options);
    if (target) {
      return new Response(null, {
        status: 302,
        headers: { location: target, "cache-control": "no-store" },
      });
    }
  }

  return Response.json(
    {
      error: "sign-in required",
      detail: "This computer is not open to the tailnet. Open it from the omg app while signed in.",
    },
    { status: 401, headers: { "cache-control": "no-store", "www-authenticate": 'Bearer realm="omg"' } },
  );
}

/** Parses LFG_TAILNET_PORT. 0 means off. Fails loud on a bad value. */
export function tailnetPortFromEnv(raw: string | undefined, mainPort: number): number {
  const value = raw?.trim();
  if (!value) return 0;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || port === mainPort) {
    throw new Error(`LFG_TAILNET_PORT must be a free TCP port other than LFG_PORT, got "${value}"`);
  }
  return port;
}
