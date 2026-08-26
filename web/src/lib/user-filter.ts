/**
 * Does a session belong in the list for the currently selected owner filter?
 *
 * "__all" shows everything and "__unassigned" isolates the unclaimed pile.
 * Picking a PERSON shows their sessions plus every unassigned one, and that
 * inclusion is the whole point of this helper.
 *
 * Sessions created through the relay carry no owner at all. The native app
 * authenticates by omg account id and never sends a roster email — there is no
 * identity header on the request, so on a box that DOES have a roster
 * (LFG_USERS) the server has nobody to attribute the session to and leaves it
 * unassigned. `POST /api/sessions/new` only inherits an owner from the nearest
 * assigned ANCESTOR, so a root session from the phone stays ownerless forever.
 *
 * Filtering those out meant live work — a running agent, mid-task — was
 * invisible on the web while the phone showed it, with nothing on screen
 * indicating anything had been hidden. "Unassigned" means nobody has claimed
 * it, not "somebody else's", and hiding a running session from every person
 * view is never the safer default.
 */
export function sessionMatchesUserFilter(
  session: { assignedUser?: string | null },
  userFilter: string,
): boolean {
  if (userFilter === "__all") return true;
  if (userFilter === "__unassigned") return !session.assignedUser;
  return session.assignedUser === userFilter || !session.assignedUser;
}

/**
 * A hosted surface can remember an explicit session filter. It must never use
 * the standalone profile as its default because the signed host claim owns the
 * viewer identity there.
 */
export function initialUserFilter({
  savedFilter,
  standaloneProfile,
  hosted,
}: {
  savedFilter: string | null;
  standaloneProfile: string | null;
  hosted: boolean;
}): string {
  if (savedFilter) return savedFilter;
  if (hosted) return "__all";
  return standaloneProfile || "__all";
}

/** Filtering a hosted roster must not impersonate the selected person. */
export function userFilterUpdatesStandaloneIdentity(value: string, hosted: boolean): boolean {
  return !hosted && value !== "__all" && value !== "__unassigned";
}
