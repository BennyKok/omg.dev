/** Public login state. Cookie values and claim tokens never appear here. */
export interface BrowserLoginRequest {
  id: string;
  sessionId: string;
  url: string;
  origin: string;
  computerName: string;
  reason: string;
  status: "pending" | "in_progress" | "importing" | "imported" | "cancelled" | "expired" | "failed";
  createdAt: number;
  expiresAt: number;
  cookieCount?: number;
  agentNotified?: boolean;
  message?: string;
}

export interface BrowserLoginSnapshot {
  requests: BrowserLoginRequest[];
  iosAvailable: boolean;
  desktopAvailable: boolean;
}

/**
 * Pick the request the UI should show without depending on response order.
 * Older servers and restored state can return rows in a different order, so
 * `.at(-1)` can let an old failure hide a newer request that still needs the
 * user. Creation time is the source of truth for which request supersedes it.
 */
export function latestBrowserLoginRequest(requests: readonly BrowserLoginRequest[]): BrowserLoginRequest | undefined {
  let latest: BrowserLoginRequest | undefined;
  for (const request of requests) {
    if (request.status === "cancelled" || request.status === "expired") continue;
    if (!latest || request.createdAt > latest.createdAt ||
      (request.createdAt === latest.createdAt && liveRequestRank(request) > liveRequestRank(latest))) {
      latest = request;
    }
  }
  return latest;
}

function liveRequestRank(request: BrowserLoginRequest): number {
  return request.status === "pending" || request.status === "in_progress" || request.status === "importing" ? 1 : 0;
}

/** Sent only by the approved native sheet over the computer transport. */
export interface BrowserLoginCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expires?: number;
  sameSite?: "Strict" | "Lax" | "None";
}
