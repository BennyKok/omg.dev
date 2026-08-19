/**
 * Building an OmgTransport for a phone.
 *
 * Everything the web dashboard does to reach a Computer is reused here rather
 * than reimplemented: `createGrantTransport` from @omg-dev/client already
 * attaches `Authorization: Bearer <grant>`, retries once on 401 with
 * forceRefresh, and opens the live socket with the `lfg-bearer.<grant>`
 * subprotocol. It takes injectable `fetch`/`WebSocket` and depends on nothing
 * from the DOM, so it runs unmodified on React Native.
 *
 * What this file adds is the part the dashboard keeps in host code: minting the
 * grant, and owning exactly one grant + one transport per binding.
 */

import {
  createGrantTransport,
  type OmgGrant,
  type OmgTransport,
} from "@omg-dev/client";

import { SESSION_AUTH_PATH, SESSION_ORIGIN } from "./config";
import { getAuthToken } from "./auth";
import {
  isSharedBindingId,
  mintTargetForBinding,
  SHARED_REVOKED_DETAIL,
} from "./computer-shared-binding";

export class ComputerGrantError extends Error {
  /**
   * Set only for a 403. readiness.ts reads this to tell "the server refused
   * this exact (owner, machine) pair" apart from "couldn't reach the session
   * origin at all" — the two errors this class otherwise flattens into one
   * shape. A 403 here is never transient: it means the mint's authorization
   * check failed (an unshared/unpaired binding, or a share that has since
   * been revoked), and retrying with the same grant will 403 again forever.
   */
  constructor(message: string, public readonly forbidden = false) {
    super(message);
  }
}

/**
 * Trade the account JWT for a signed, short-lived grant scoped to one machine.
 *
 * The session origin hands back a `cookie` field AND a Set-Cookie header. A
 * browser needs the header; we deliberately ignore it and use the field as a
 * bearer token, which the proxy's readSessionGrant() accepts precisely so
 * non-browser clients don't have to care about cookie policy.
 *
 * `bindingId` here is whatever this app has selected, which may be the
 * `shared:<ownerUserId>:<bindingId>` spelling from computer-shared-binding.ts.
 * The mint endpoint itself only understands the raw pair — decoding the
 * opaque id into `{bindingId, ownerUserId}` is this call's job, same as the
 * web dashboard's `mintTargetForBinding` does before it calls the identical
 * route.
 */
export async function mintSessionGrant(bindingId: string): Promise<OmgGrant> {
  const authToken = await getAuthToken();
  if (!authToken) throw new ComputerGrantError("Please sign in again.");

  const target = mintTargetForBinding(bindingId);

  let response: Response;
  try {
    response = await fetch(`${SESSION_ORIGIN}${SESSION_AUTH_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(target),
    });
  } catch {
    throw new ComputerGrantError(
      "Couldn't reach your Computer. Try again in a moment.",
    );
  }

  if (response.status === 401) throw new ComputerGrantError("Please sign in again.");
  if (response.status === 403) {
    // The one case that is not "try again": the server does not consider this
    // account authorized for this machine, whether that is a binding that was
    // never yours or a share that was just revoked. See the `forbidden` flag's
    // doc comment above.
    throw new ComputerGrantError(
      isSharedBindingId(bindingId)
        ? SHARED_REVOKED_DETAIL
        : "This computer isn't available to your account anymore.",
      true,
    );
  }
  if (response.status === 402) {
    throw new ComputerGrantError("Your included computer time is used up.");
  }
  if (!response.ok) {
    throw new ComputerGrantError(
      "Couldn't open this Computer. Try again in a moment.",
    );
  }

  const body = (await response.json().catch(() => null)) as {
    cookie?: string;
    exp?: number;
    expiresInMs?: number;
  } | null;
  if (!body?.cookie) {
    throw new ComputerGrantError("Your Computer is updating. Try again in a moment.");
  }

  // Relative lifetime wins: a phone's clock can be minutes off a server's, and
  // an absolute `exp` compared against a skewed Date.now() either expires a
  // fresh grant instantly or trusts a dead one. `exp` stays as the fallback for
  // a server mid-rollout that doesn't send expiresInMs yet.
  const expiresAt =
    typeof body.expiresInMs === "number"
      ? Date.now() + body.expiresInMs
      : typeof body.exp === "number"
        ? body.exp
        : Date.now();

  return { token: body.cookie, expiresAt };
}

/**
 * One grant per binding, and one mint in flight at a time.
 *
 * Without this, every independent consumer that boots at once (session list,
 * transcript, settings) observes an empty cache and mints its own grant. That
 * exact bug shipped on the web and cost five /token + five /__omg/session-auth
 * calls on every cold open.
 */
type GrantOwner = {
  get: (input: { forceRefresh: boolean }) => Promise<OmgGrant>;
  reset: () => void;
};

function createGrantOwner(bindingId: string): GrantOwner {
  let cached: OmgGrant | null = null;
  let pending: Promise<OmgGrant> | null = null;

  return {
    async get({ forceRefresh }) {
      // 30s of slack so a grant that is about to die isn't handed to a request
      // that will outlive it.
      if (!forceRefresh && cached && cached.expiresAt - Date.now() > 30_000) {
        return cached;
      }
      if (!forceRefresh && pending) return pending;
      pending = mintSessionGrant(bindingId)
        .then((grant) => {
          cached = grant;
          return grant;
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
    reset() {
      cached = null;
      pending = null;
    },
  };
}

const transports = new Map<string, { transport: OmgTransport; owner: GrantOwner }>();

/**
 * The hosted transport for a machine, shared across every screen that talks to
 * it. Cached at module scope on purpose — React context would give each
 * subtree its own copy of the grant cache, which is the thing being shared.
 */
export function getHostedTransport(bindingId: string): OmgTransport {
  const existing = transports.get(bindingId);
  if (existing) return existing.transport;

  const owner = createGrantOwner(bindingId);
  const transport = createGrantTransport({
    baseUrl: SESSION_ORIGIN,
    getGrant: owner.get,
  });
  transports.set(bindingId, { transport, owner });
  return transport;
}

/**
 * A transport for a box reachable directly on the network (`lfg serve` over
 * Tailscale). That server has no application-layer auth, so this is plain
 * HTTP/WS against the given origin — the perimeter is the network, and the
 * Settings screen says so out loud.
 */
export function createDirectTransport(baseUrl: string): OmgTransport {
  const origin = baseUrl.replace(/\/+$/, "");
  const socketUrl = (path: string) =>
    `${origin.replace(/^http/, "ws")}${path}`;

  const doFetch = (path: string, init?: RequestInit) =>
    fetch(`${origin}${path}`, init);

  return {
    fetch: doFetch,
    async request<T>(path: string, init: RequestInit = {}): Promise<T> {
      const response = await doFetch(path, init);
      const text = await response.text().catch(() => "");
      let data: unknown = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }
      if (!response.ok) {
        const message =
          (data as { error?: string })?.error ??
          `${init.method ?? "GET"} ${path} failed (${response.status})`;
        throw new Error(message);
      }
      return data as T;
    },
    async openSocket(path: string) {
      return new WebSocket(socketUrl(path)) as unknown as Awaited<
        ReturnType<OmgTransport["openSocket"]>
      >;
    },
    async openLiveSocket() {
      return new WebSocket(socketUrl("/api/live/ws")) as unknown as Awaited<
        ReturnType<OmgTransport["openLiveSocket"]>
      >;
    },
  };
}

/** Drop a machine's cached transport, e.g. after sign-out or unpairing. */
export function forgetTransport(bindingId: string): void {
  transports.get(bindingId)?.owner.reset();
  transports.delete(bindingId);
}

export function forgetAllTransports(): void {
  for (const entry of transports.values()) entry.owner.reset();
  transports.clear();
}
