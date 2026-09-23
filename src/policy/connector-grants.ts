// A connection given to a role is permission for that role to use it.
//
// Restricted roles block every tool by default. Without this, adding Gmail
// "for the Growth role" saved a connection that Growth's own agents could not
// see: the tools/list filter dropped all seven tools because no rule allowed
// them, and the owner had to find the Tools page and write `connectors.*` by
// hand. The act of choosing a role in the connector picker already says who
// may use it, so it is read here as an allow, not stored as a second rule.
//
// Derived at request time from the connector store, the single owner of
// "which connection belongs to which bucket": deleting the connection removes
// the grant with it, and no rule is left behind. The grant is an ordinary
// allow rule appended to the role, so an explicit block the owner wrote
// (`connectors.gmail.send_email`) still wins, as block always does.
//
// Team connections count too: "Whole team" includes every role. A member's
// personal connections do not, because a restricted member adding their own
// server must not route around the owner's default.
import type { Role } from "./roles.ts";

export const TEAM_BUCKET = "*org*";
const ROLE_BUCKET_PREFIX = "role:";

type GrantSource = { owner: string; slug: string };

/** `role` plus an allow rule for each connection its bucket or the team holds. */
export function withConnectorGrants(role: Role, connectors: readonly GrantSource[]): Role {
  if (role.id === "owner") return role;
  const bucket = `${ROLE_BUCKET_PREFIX}${role.id}`;
  const granted = connectors.filter((c) => c.owner === bucket || c.owner === TEAM_BUCKET);
  if (granted.length === 0) return role;
  return {
    ...role,
    rules: [
      ...role.rules,
      ...granted.map((c) => ({ pattern: `connectors.${c.slug}.*`, action: "allow" as const })),
    ],
  };
}
