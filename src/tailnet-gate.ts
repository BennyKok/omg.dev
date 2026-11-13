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
// - A linked omg.dev box (src/peer-machines.ts) passes with this box's peer
//   token, as `Authorization: Bearer` or a `lfg-bearer.<token>` websocket
//   subprotocol. The token exists for the gate only while the owner has turned
//   on "Allow linking" in Settings > Remote access. It still cannot reach
//   `/api/peers*`.
//
// Linked devices (src/devices) are handled before this gate: `/api/devices/link/*`
// goes to their own handler, which requires a device signature on every call
// except pairing (a one-use code). Nothing else on the API opens.

import { timingSafeEqual } from "node:crypto";

export const TAILNET_PASSTHROUGH_PATHS = new Set(["/api/connectors/oauth/callback"]);

export type TailnetGateOptions = {
  /** Shared peer bearer token accepted from linked remote omg.dev boxes. */
  peerToken?: string | null;
};

function matchesToken(candidate: string | null | undefined, expected: string): boolean {
  const trimmed = candidate?.trim();
  if (!trimmed || trimmed.length !== expected.length) return false;
  const a = Buffer.from(trimmed, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requestHasPeerToken(req: Request, expectedToken: string | null | undefined): boolean {
  const expected = expectedToken?.trim();
  if (!expected) return false;

  const auth = req.headers.get("authorization");
  if (auth && /^bearer\s+/i.test(auth)) {
    const token = auth.replace(/^bearer\s+/i, "").trim();
    if (matchesToken(token, expected)) return true;
  }

  const protocols = req.headers.get("sec-websocket-protocol");
  if (protocols) {
    for (const part of protocols.split(",")) {
      const protocol = part.trim();
      if (protocol.startsWith("lfg-bearer.")) {
        const token = protocol.slice("lfg-bearer.".length);
        if (matchesToken(token, expected)) return true;
      }
    }
  }

  return false;
}

/**
 * Returns the response for a tailnet request, or null when the request may
 * reach the normal `lfg serve` handler.
 */
export function tailnetGateResponse(req: Request, options: TailnetGateOptions = {}): Response | null {
  const path = new URL(req.url).pathname;
  if (req.method === "GET" && TAILNET_PASSTHROUGH_PATHS.has(path)) return null;
  if (requestHasPeerToken(req, options.peerToken)) {
    // A linked box controls this box's sessions. It does not manage links:
    // no reading or rotating this box's token, no turning inbound access off,
    // and no hop through this box's proxy to the boxes IT has linked.
    if (path === "/api/peers" || path.startsWith("/api/peers/")) {
      return Response.json(
        { error: "linked machines cannot manage links" },
        { status: 403, headers: { "cache-control": "no-store" } },
      );
    }
    return null;
  }
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
