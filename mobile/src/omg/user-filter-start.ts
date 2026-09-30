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
