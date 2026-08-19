/**
 * Layout + label logic for an overlapping user-icon stack ("facepile") —
 * kept apart from the rendering component (UserFacepile.tsx) so the ordering,
 * overflow, and accessible-label rules are unit-testable without a DOM, the
 * same split this repo already uses for sessionMatchesUserFilter /
 * resolveRosterUser.
 */
export type FacepileMember = {
  email: string;
  name: string;
  /** Absent/empty means "no uploaded or Gravatar photo" — render a fallback glyph. */
  avatar?: string;
};

export type FacepileLayout = {
  /** Members to render as circles, already in final display order. */
  visible: FacepileMember[];
  /** How many members beyond `visible` exist — 0 means no "+N" badge. */
  overflowCount: number;
  /** The single accessible label for the whole stack (not one per avatar). */
  label: string;
};

const fallbackDisplayName = (member: FacepileMember): string =>
  member.name.trim() || member.email.split("@")[0] || member.email;

/**
 * One label for the whole stack, not N redundant per-avatar ones — screen
 * readers get "Benny and Angel", not "Benny. Angel." from two child nodes.
 */
export function facepileLabel(members: FacepileMember[]): string {
  if (members.length === 0) return "No one on this machine";
  const names = members.map(fallbackDisplayName);
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * Build the stack's layout. Members are re-sorted by email rather than
 * trusting caller order — the caller's list order can legitimately vary
 * between requests/callers (roster insertion order vs. a future API's own
 * order), and a facepile that silently reshuffles on every poll reads as
 * broken. Sorting here makes "deterministic" a property of this function,
 * not an obligation on every caller.
 */
export function buildFacepile(members: FacepileMember[], maxVisible = 4): FacepileLayout {
  const ordered = [...members].sort((a, b) => a.email.localeCompare(b.email));
  const visible = ordered.slice(0, Math.max(0, maxVisible));
  const overflowCount = Math.max(0, ordered.length - visible.length);
  return { visible, overflowCount, label: facepileLabel(ordered) };
}
