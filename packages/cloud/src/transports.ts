/**
 * One grant and one transport per machine.
 *
 * `createGrantTransport` from @omg-dev/client already attaches the bearer
 * grant, retries once on 401 with forceRefresh, and opens the live socket
 * with the `lfg-bearer.<grant>` subprotocol. What this file adds is the part
 * every host used to keep in its own code: owning exactly one grant mint in
 * flight per binding, and one transport that every screen shares.
 *
 * Module scope was the bug fix, not an accident. A hook shares code, never
 * state; several independent consumers booting at once each observed an empty
 * cache and minted their own grant. That shipped on the web and cost five
 * /token + five /__omg/session-auth calls on every cold open.
 */

import {
  createGrantTransport,
  type OmgGrant,
  type OmgTransport,
} from "@omg-dev/client";

import { resolveCloudEndpoints, type CloudEndpoints, type FetchLike } from "./config";
import type { MintSessionGrant } from "./grant";

type GrantOwner = {
  get: (input: { forceRefresh: boolean }) => Promise<OmgGrant>;
  prime: (grant: OmgGrant) => void;
  reset: () => void;
};

const GRANT_SKEW_MS = 30_000;

function createGrantOwner(
  bindingId: string,
  mint: MintSessionGrant,
  now: () => number,
): GrantOwner {
  let cached: OmgGrant | null = null;
  let pending: Promise<OmgGrant> | null = null;
  return {
    async get({ forceRefresh }) {
      // 30 s of slack so a grant about to die is not handed to a request
      // that will outlive it.
      if (!forceRefresh && cached && cached.expiresAt - now() > GRANT_SKEW_MS) return cached;
      if (!forceRefresh && pending) return pending;
      pending = mint(bindingId)
        .then((grant) => {
          cached = grant;
          return grant;
        })
        .finally(() => {
          pending = null;
        });
      return pending;
    },
    prime(grant) {
      cached = grant;
    },
    reset() {
      cached = null;
      pending = null;
    },
  };
}

export interface TransportCacheOptions {
  endpoints?: Partial<CloudEndpoints>;
  mintSessionGrant: MintSessionGrant;
  fetch?: FetchLike;
  WebSocket?: typeof globalThis.WebSocket;
  now?: () => number;
}

export interface MachineTransports {
  /** The hosted transport for a machine, shared by every consumer of it. */
  get(bindingId: string): OmgTransport;
  /** Seed a binding's grant from a value the server already handed over. */
  prime(bindingId: string, grant: OmgGrant): void;
  /** Drop a machine's cached transport, e.g. after sign-out or unpairing. */
  forget(bindingId: string): void;
  forgetAll(): void;
}

export function createMachineTransports(options: TransportCacheOptions): MachineTransports {
  const endpoints = resolveCloudEndpoints(options.endpoints);
  const now = options.now ?? Date.now;
  const entries = new Map<string, { transport: OmgTransport; owner: GrantOwner }>();

  const entryFor = (bindingId: string) => {
    const existing = entries.get(bindingId);
    if (existing) return existing;
    const owner = createGrantOwner(bindingId, options.mintSessionGrant, now);
    const transport = createGrantTransport({
      baseUrl: endpoints.sessionOrigin,
      getGrant: owner.get,
      ...(options.fetch ? { fetch: options.fetch as typeof globalThis.fetch } : {}),
      ...(options.WebSocket ? { WebSocket: options.WebSocket } : {}),
    });
    const entry = { transport, owner };
    entries.set(bindingId, entry);
    return entry;
  };

  return {
    get: (bindingId) => entryFor(bindingId).transport,
    prime: (bindingId, grant) => entryFor(bindingId).owner.prime(grant),
    forget(bindingId) {
      entries.get(bindingId)?.owner.reset();
      entries.delete(bindingId);
    },
    forgetAll() {
      for (const entry of entries.values()) entry.owner.reset();
      entries.clear();
    },
  };
}

/**
 * A transport for a box reachable directly on the network (`omg serve` on a
 * laptop, over Tailscale). That server has no application-layer auth, so this
 * is plain HTTP/WS against the given origin. The perimeter is the network.
 */
export function createDirectTransport(
  baseUrl: string,
  options: { fetch?: FetchLike; WebSocket?: typeof globalThis.WebSocket } = {},
): OmgTransport {
  const origin = baseUrl.trim().replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const WebSocketImpl = options.WebSocket ?? globalThis.WebSocket;
  const socketUrl = (path: string) => `${origin.replace(/^http/, "ws")}${path}`;
  const doFetch = (path: string, init?: RequestInit) => fetchImpl(`${origin}${path}`, init);

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
        throw new Error(
          (data as { error?: string })?.error ??
            `${init.method ?? "GET"} ${path} failed (${response.status})`,
        );
      }
      return data as T;
    },
    async openSocket(path: string) {
      return new WebSocketImpl(socketUrl(path)) as unknown as Awaited<
        ReturnType<OmgTransport["openSocket"]>
      >;
    },
    async openLiveSocket(query?: string) {
      const suffix = query ? `?${query.replace(/^\?/, "")}` : "";
      return new WebSocketImpl(socketUrl(`/api/live/ws${suffix}`)) as unknown as Awaited<
        ReturnType<OmgTransport["openLiveSocket"]>
      >;
    },
  };
}
