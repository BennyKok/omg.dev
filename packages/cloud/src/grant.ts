/**
 * Trade the account JWT for a signed, short-lived grant scoped to one machine.
 *
 * The session origin hands back a `cookie` field AND a Set-Cookie header. A
 * browser gets the header for free; every client here uses the field as a
 * bearer token, which the proxy's readSessionGrant() accepts precisely so
 * non-browser clients do not have to care about cookie policy.
 */

import type { OmgGrant } from "@omg-dev/client";

import {
  SESSION_AUTH_PATH,
  resolveCloudEndpoints,
  type CloudEndpoints,
  type FetchLike,
  type GetAuthToken,
} from "./config";
import { SHARED_REVOKED_DETAIL, isSharedBindingId, mintTargetForBinding } from "./shared-binding";

export type ComputerGrantErrorCode =
  | "unauthorized"
  | "forbidden"
  | "upgrade_required"
  | "unreachable"
  | "unavailable";

export class ComputerGrantError extends Error {
  readonly code: ComputerGrantErrorCode;
  constructor(message: string, code: ComputerGrantErrorCode = "unavailable") {
    super(message);
    this.name = "ComputerGrantError";
    this.code = code;
  }
  /**
   * A 403 is never transient: the mint's authorization check failed for this
   * exact (owner, machine) pair, and retrying with the same account will 403
   * forever. Readiness reads this to say "pick another machine" instead of
   * "try again".
   */
  get forbidden(): boolean {
    return this.code === "forbidden";
  }
}

export interface GrantMinterOptions {
  endpoints?: Partial<CloudEndpoints>;
  getAuthToken: GetAuthToken;
  fetch?: FetchLike;
  now?: () => number;
}

export type MintSessionGrant = (bindingId: string) => Promise<OmgGrant>;

/**
 * `bindingId` may be the `shared:<ownerUserId>:<bindingId>` spelling. The
 * mint endpoint only understands the raw pair, so decoding is this call's job.
 */
export function createGrantMinter(options: GrantMinterOptions): MintSessionGrant {
  const endpoints = resolveCloudEndpoints(options.endpoints);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;

  return async function mintSessionGrant(bindingId) {
    const authToken = await options.getAuthToken();
    if (!authToken) throw new ComputerGrantError("Please sign in again.", "unauthorized");

    let response: Response;
    try {
      response = await fetchImpl(`${endpoints.sessionOrigin}${SESSION_AUTH_PATH}`, {
        method: "POST",
        credentials: "include",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(mintTargetForBinding(bindingId)),
      });
    } catch {
      throw new ComputerGrantError(
        "Couldn't reach your Computer. Try again in a moment.",
        "unreachable",
      );
    }

    if (response.status === 401) {
      throw new ComputerGrantError("Please sign in again.", "unauthorized");
    }
    if (response.status === 403) {
      throw new ComputerGrantError(
        isSharedBindingId(bindingId)
          ? SHARED_REVOKED_DETAIL
          : "This computer isn't available to your account anymore.",
        "forbidden",
      );
    }
    // Billing wall: stop mint retries. Re-minting only spams session-auth.
    if (response.status === 402) {
      throw new ComputerGrantError(
        "Your included computer time is used up.",
        "upgrade_required",
      );
    }
    if (!response.ok) {
      throw new ComputerGrantError(
        "Couldn't open this Computer. Try again in a moment.",
        "unavailable",
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

    // Relative lifetime wins: client and server clocks differ, and an absolute
    // `exp` against a skewed clock either expires a fresh grant instantly or
    // trusts a dead one. `exp` stays as the fallback for a server mid-rollout.
    const expiresAt =
      typeof body.expiresInMs === "number"
        ? now() + body.expiresInMs
        : typeof body.exp === "number"
          ? body.exp
          : now();

    return { token: body.cookie, expiresAt };
  };
}
