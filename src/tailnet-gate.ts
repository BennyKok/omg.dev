// Tailnet entry point for `lfg serve`.
//
// `lfg serve` has no login of its own (see SECURITY.md): its API trusts every
// caller that can reach the port. That is correct for loopback callers (agent
// tools on this box). It is wrong for a tailnet: any device on the tailnet (a
// shared Mac, a tagged server, another person's phone) could list sessions,
// start agents and send them input.
//
// When LFG_TAILNET_PORT is set, `lfg serve` opens a second loopback listener
// for `tailscale serve` to point at. Every request on it came from the
// tailnet, so the gate below applies to all of them, with no header guessing:
//
// - The connector OAuth callback passes through: the provider redirects the
//   browser there, and the handler only accepts a state this box issued.
// - Everything else, page loads, the API and websockets included, gets 401.
//
// Linked devices (src/devices) are handled before this gate: `/api/devices/link/*`
// goes to their own handler, which requires a device signature on every call
// except pairing (a one-use code). Nothing else on the API opens.

export const TAILNET_PASSTHROUGH_PATHS = new Set(["/api/connectors/oauth/callback"]);

/**
 * Returns the response for a tailnet request, or null when the request may
 * reach the normal `lfg serve` handler.
 */
export function tailnetGateResponse(req: Request): Response | null {
  const path = new URL(req.url).pathname;
  if (req.method === "GET" && TAILNET_PASSTHROUGH_PATHS.has(path)) return null;
  return Response.json(
    {
      error: "sign-in required",
      detail: "This computer is not open to the tailnet. Open it on this computer.",
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
