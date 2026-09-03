// Who is calling a shared MCP endpoint, and which role that gives them.
//
// One resolver for `/mcp`, `/mcp/computer` and `/mcp/executor`, so all three
// answer "which session, which role" the same way. The session comes from the
// `?session=` query or the `x-omg-session-id` header, as before. What is new
// is that a session whose registry row demands a token (`mcpTokenRequired`)
// must also present `x-omg-session-token`; a claim without a valid token is
// downgraded to anonymous rather than rejected, which is the same degradation
// an unknown id already gets, and keeps session-scoped tools failing loudly
// ("sessionId required") instead of acting on someone else's session.
//
// Role: the row's `role`, else owner. Anonymous callers are the owner: on a
// solo box every CLI session registered at user scope is anonymous, and this
// is what keeps that box behaving exactly as it did before roles existed. A
// team box that wants anonymous callers restricted sets `anonymousRole` in
// settings (phase 2 of docs/team-tooling-design.md leaves that to vibes sync).
import { listManaged, type ManagedSession } from "../managed.ts";
import { OWNER_ROLE, getRole, type Role } from "./roles.ts";
import { SESSION_TOKEN_HEADER, verifySessionToken } from "./session-token.ts";

export interface Caller {
  /** The session this request speaks for, or undefined when anonymous. */
  sessionId: string | undefined;
  role: Role;
  /** Why an id in the request was not honoured. For logs and tests. */
  downgraded?: "missing-token" | "bad-token";
}

function claimedSession(req: Request): string | undefined {
  const fromQuery = new URL(req.url).searchParams.get("session")?.trim();
  if (fromQuery) return fromQuery;
  return (
    req.headers.get("x-omg-session-id")?.trim() ||
    req.headers.get("x-lfg-session-id")?.trim() ||
    undefined
  );
}

function findRow(sessionId: string): ManagedSession | undefined {
  return listManaged().find((m) => m.sessionId === sessionId || m.nativeSessionId === sessionId);
}

/** Resolve the caller of one MCP request. Never throws. */
export function resolveCaller(
  req: Request,
  lookup: (sessionId: string) => ManagedSession | undefined = findRow,
): Caller {
  const claimed = claimedSession(req);
  if (!claimed) return { sessionId: undefined, role: OWNER_ROLE };
  const row = lookup(claimed);
  if (row?.mcpTokenRequired) {
    const token = req.headers.get(SESSION_TOKEN_HEADER);
    if (!token) return { sessionId: undefined, role: OWNER_ROLE, downgraded: "missing-token" };
    if (!verifySessionToken(claimed, token)) {
      return { sessionId: undefined, role: OWNER_ROLE, downgraded: "bad-token" };
    }
  }
  const role = (row?.role && getRole(row.role)) || OWNER_ROLE;
  return { sessionId: claimed, role };
}
