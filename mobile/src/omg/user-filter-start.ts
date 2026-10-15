// Pure, so it can be tested without React Native.

/**
 * Port of hostedStartUserFilter in web/src/lib/user-filter.ts. Where a
 * managed Computer opens the filter, or null to keep the current one:
 * the viewer's saved choice when it still means something, else their own
 * sessions when they are on the roster.
 */
export function hostedStartUserFilter({
  saved,
  viewerEmail,
  users,
}: {
  saved: string | null | undefined;
  viewerEmail: string | null | undefined;
  users: readonly { email: string }[];
}): string | null {
  const find = (email: string) => {
    const want = email.trim().toLowerCase();
    return users.find((user) => user.email.trim().toLowerCase() === want)?.email ?? null;
  };
  if (saved === "__all" || saved === "__unassigned") return saved;
  if (saved) {
    const match = find(saved);
    if (match) return match;
  }
  return viewerEmail ? find(viewerEmail) : null;
}

/**
 * The owner a session started from the phone is tagged with: the person the
 * header filter names, when that person is on the box's roster. The web
 * composer does the same on a hosted surface (composerDefaultOwner).
 *
 * Without it the request carries no `user`, and POST /api/sessions/new falls
 * back to the paired box account. With Angel picked, her new session landed
 * in the owner's list.
 *
 * "All" and "Unassigned" name nobody. An email the roster does not list
 * (a stale filter before the roster answers) is left out, because the server
 * rejects an unknown email with a 400.
 */
export function newSessionOwner(
  filter: string,
  users: readonly { email: string }[],
): string | undefined {
  if (filter === "__all" || filter === "__unassigned") return undefined;
  const want = filter.trim().toLowerCase();
  if (!want) return undefined;
  return users.find((user) => user.email.trim().toLowerCase() === want)?.email;
}
