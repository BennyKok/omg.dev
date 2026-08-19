/**
 * Addressing someone else's machine from the phone.
 *
 * This is a PORT, not a reinvention. The web dashboard already worked out (and
 * broke, and fixed) this format:
 * apps/web/src/components/computer/computer-shared-binding.ts in
 * BennyKok/vibes, mirrored server-side by
 * control-plane/lib/computer-access.ts's own `SHARED_BINDING_PREFIX`. A
 * binding id already identifies a machine everywhere in this app — it keys
 * the transport cache (transport.ts), the grant owner, the persisted
 * preference (AsyncStorage `STORAGE_KEYS.binding`) — so a shared machine needs
 * to be addressable by the same KIND of string, or every one of those would
 * have to learn a second dimension.
 *
 * So a shared machine is spelled `shared:<ownerUserId>:<bindingId>`, exactly
 * as the control plane expects it. Both halves are needed because sharing is
 * PER MACHINE: the owner alone would not say which of their machines, and the
 * binding alone would not say whose. This is a documented CONTRACT with the
 * server, not a client convention — the first version of this on web invented
 * its own client-only spelling and the server could not parse it. Do not
 * change this format without changing control-plane/lib/computer-access.ts to
 * match; that file is out of scope here (read-only, different repo).
 */

export const SHARED_BINDING_PREFIX = "shared:";

export interface SharedBindingTarget {
  ownerUserId: string;
  bindingId: string;
}

export function sharedBindingId(ownerUserId: string, bindingId: string): string {
  return `${SHARED_BINDING_PREFIX}${ownerUserId}:${bindingId}`;
}

export function isSharedBindingId(bindingId: string): boolean {
  return bindingId.startsWith(SHARED_BINDING_PREFIX);
}

/**
 * The (owner, machine) pair behind a shared binding id, or null for an
 * ordinary machine.
 *
 * Splits on the FIRST colon only: the owner is a uuid and never contains one,
 * while the trailing binding id is passed through untouched so it survives
 * whatever spelling relay chooses for it.
 */
export function parseSharedBindingId(bindingId: string): SharedBindingTarget | null {
  if (!isSharedBindingId(bindingId)) return null;
  const rest = bindingId.slice(SHARED_BINDING_PREFIX.length);
  const split = rest.indexOf(":");
  if (split <= 0) return null;
  const ownerUserId = rest.slice(0, split).trim();
  const target = rest.slice(split + 1).trim();
  if (!ownerUserId || !target) return null;
  return { ownerUserId, bindingId: target };
}

/**
 * What the session-auth mint endpoint should be asked for, for any binding id
 * this app might have selected. The mint route (control-plane
 * `handleSessionAuthMint`, POST /__omg/session-auth) takes the RAW binding id
 * plus an optional `ownerUserId` — it does not understand the `shared:`
 * spelling itself, that decoding is entirely this app's job.
 */
export function mintTargetForBinding(bindingId: string): {
  bindingId: string;
  ownerUserId?: string;
} {
  const shared = parseSharedBindingId(bindingId);
  return shared ? { bindingId: shared.bindingId, ownerUserId: shared.ownerUserId } : { bindingId };
}

/** What `listSharedComputers` returns for one machine shared with the signed-in account. */
export type SharedComputerView = {
  ownerUserId: string;
  bindingId: string;
  email: string;
  name?: string;
  image?: string;
  sharedAt: number;
  /**
   * Liveness of the OWNER's machine, resolved server-side. This app cannot
   * ask relay itself — relay only answers "which machines are YOURS", and a
   * shared one never is. Undefined means the server could not resolve it
   * either; treat that as reachable rather than rendering a false "offline",
   * same as the web dashboard does.
   */
  online?: boolean;
};

/** "Ada" / "ada@example.com" — whichever the share row actually carries. */
export function sharedComputerOwnerLabel(
  computer: Pick<SharedComputerView, "name" | "email">,
): string {
  return computer.name?.trim() || computer.email;
}

/** "Ada's computer" — how a shared machine is named in the picker and the
 *  manage screen, distinct from how this app labels its OWN machines
 *  (bindingLabel in format.ts). Never call bindingLabel on a synthesized
 *  shared binding: it has no computerUrl/defaultFolder of its own to read,
 *  and would fall back to a truncated id. */
export function sharedBindingLabel(ownerLabel: string): string {
  return `${ownerLabel}’s computer`;
}
