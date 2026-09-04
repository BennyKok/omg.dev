/**
 * Addressing someone else's machine.
 *
 * A binding id identifies a machine everywhere: it keys the transport cache,
 * the grant owner, and the persisted preference. A shared machine needs to be
 * addressable by the same KIND of string, so it is spelled
 * `shared:<ownerUserId>:<bindingId>`, exactly as the control plane expects it
 * (`control-plane/lib/computer-access.ts` in BennyKok/vibes). Both halves are
 * needed because sharing is PER MACHINE. This is a contract with the server,
 * not a client convention. Do not change the format here alone.
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

/**
 * Detail for a revoked share — mint 403 or a `shared:` preference that is no
 * longer in `listSharedComputers`. The empty-state TITLE is already
 * "No longer available"; this line says why, instead of restating that title.
 */
export const SHARED_REVOKED_DETAIL = "This computer is no longer shared with you.";

/**
 * Optional machine identity the share row may carry. A guest never gets the
 * owner's live `computerUrl` for transport, but the list payload can still
 * name the box so two shares from one person are not the same string.
 */
export type SharedComputerIdentity = {
  hostname?: string;
  computerName?: string;
  machineName?: string;
  machineLabel?: string;
  defaultFolder?: string | null;
  computerUrl?: string | null;
  binding?: {
    hostname?: string;
    computerName?: string;
    machineName?: string;
    computerUrl?: string | null;
    defaultFolder?: string | null;
  };
};

/** What `listSharedComputers` returns for one machine shared with the signed-in account. */
export type SharedComputerView = SharedComputerIdentity & {
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

/** Fields the label helpers read — a list row or the synthesized binding. */
export type SharedComputerLabelSource = SharedComputerIdentity & {
  ownerUserId?: string;
  bindingId?: string;
  id?: string;
  email?: string;
  name?: string;
  ownerName?: string;
  ownerLabel?: string;
  ownerBindingId?: string;
  online?: boolean;
};

/** "Ada" / "ada@example.com" — whichever the share row actually carries. */
export function sharedComputerOwnerLabel(
  computer: Pick<SharedComputerView, "name" | "email">,
): string {
  return computer.name?.trim() || computer.email;
}

export function looksLikeEmail(value: string): boolean {
  return value.includes("@");
}

/**
 * First name from a real display name. Never an email — possessivizing
 * `ada@example.com` produced "ada@example.com's computer", which is the
 * string this helper exists to stop shipping.
 */
export function sharedComputerFirstName(computer: SharedComputerLabelSource): string | null {
  const named = computer.name?.trim() || computer.ownerName?.trim();
  const fromName = firstNameToken(named);
  if (fromName) return fromName;
  return firstNameToken(computer.ownerLabel?.trim());
}

function firstNameToken(raw?: string): string | null {
  if (!raw || looksLikeEmail(raw)) return null;
  const first = raw.split(/\s+/)[0] ?? "";
  if (!first || looksLikeEmail(first)) return null;
  return `${first.charAt(0).toUpperCase()}${first.slice(1)}`;
}

/**
 * Which machine this share is, when the server said. Hostname first, then
 * an explicit name, then the same URL/folder fallbacks `bindingLabel` uses
 * for a box you own. Missing is fine — the title falls back to "computer"
 * and collisions get a short tail.
 */
export function sharedComputerMachineIdentity(
  computer: SharedComputerLabelSource,
): string | undefined {
  const nested = computer.binding;
  const candidates = [
    computer.machineLabel,
    computer.hostname,
    computer.computerName,
    computer.machineName,
    nested?.hostname,
    nested?.computerName,
    nested?.machineName,
    hostnameFromUrl(computer.computerUrl),
    hostnameFromUrl(nested?.computerUrl),
    folderBasename(computer.defaultFolder),
    folderBasename(nested?.defaultFolder),
  ];
  for (const candidate of candidates) {
    const trimmed = typeof candidate === "string" ? candidate.trim() : "";
    if (trimmed && !looksLikeEmail(trimmed)) return trimmed;
  }
  return undefined;
}

function hostnameFromUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname.split(".")[0];
    if (host && host !== "localhost" && !/^\d+$/.test(host)) return host;
  } catch {
    /* fall through */
  }
  return undefined;
}

function folderBasename(folder?: string | null): string | undefined {
  const name = folder?.split("/").filter(Boolean).pop()?.trim();
  return name || undefined;
}

function ownerBindingId(computer: SharedComputerLabelSource): string {
  if (computer.ownerBindingId?.trim()) return computer.ownerBindingId.trim();
  if (computer.bindingId?.trim()) {
    const parsed = parseSharedBindingId(computer.bindingId);
    return parsed?.bindingId ?? computer.bindingId.trim();
  }
  if (computer.id) {
    const parsed = parseSharedBindingId(computer.id);
    if (parsed) return parsed.bindingId;
  }
  return "";
}

function uniqueTail(computer: SharedComputerLabelSource): string {
  const compact = ownerBindingId(computer).replace(/[^a-zA-Z0-9]/g, "");
  if (compact.length >= 6) return compact.slice(-6);
  if (compact.length > 0) return compact;
  return "share";
}

/**
 * Title for a shared machine.
 *
 * - Owner has a name: first-name possessive + machine identity when we have
 *   one ("Ada's MacBook" / "Ada's studio"), else "Ada's computer".
 * - Owner is email-only: "Shared computer". Never `"ada@example.com's computer"`.
 * - Two rows that would otherwise match get a short unique tail.
 *
 * Distinct from `bindingLabel` (format.ts), which reads a machine YOU own.
 * Never call that on a synthesized shared binding: a guest has no
 * `computerUrl` of their own, and it would fall through to a truncated id.
 */
export function sharedBindingLabel(
  computer: SharedComputerLabelSource,
  siblings: SharedComputerLabelSource[] = [],
): string {
  const title = sharedBindingBaseTitle(computer);
  const collisions = siblings.filter((other) => sharedBindingBaseTitle(other) === title);
  if (collisions.length <= 1) return title;
  return `${title} · ${uniqueTail(computer)}`;
}

export function sharedBindingBaseTitle(computer: SharedComputerLabelSource): string {
  const first = sharedComputerFirstName(computer);
  if (!first) return "Shared computer";
  const machine = sharedComputerMachineIdentity(computer);
  return `${first}’s ${machine ?? "computer"}`;
}

/**
 * Second line on the manage screen.
 *
 * Attribution is the section + title. A named owner gets liveness
 * (Online / Offline). Email-only puts the email here — that is the only
 * place the address belongs, and possessivizing it as a title is the
 * thing this policy forbids.
 */
export function sharedComputerSubtitle(computer: SharedComputerLabelSource): string {
  if (!sharedComputerFirstName(computer)) {
    const email = computer.email?.trim();
    if (email) return email;
    const label = computer.ownerLabel?.trim();
    if (label && looksLikeEmail(label)) return label;
    return computer.online === false ? "Offline" : "Online";
  }
  return computer.online === false ? "Offline" : "Online";
}

/** Picker row: the title, plus a title-case "Offline" suffix when down. */
export function sharedComputerPickerLabel(
  computer: SharedComputerLabelSource,
  siblings: SharedComputerLabelSource[] = [],
): string {
  const title = sharedBindingLabel(computer, siblings);
  return computer.online === false ? `${title} — Offline` : title;
}
