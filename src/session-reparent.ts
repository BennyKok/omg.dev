import { patchManaged } from "./managed.ts";
import type { Session } from "./sessions.ts";

export async function handleSessionReparent(request: Request, options: {
  sessions: Session[];
  invalidate: () => void;
  notifyParent: (parent: Session, text: string) => Promise<{ ok: boolean; error?: string }>;
}): Promise<Response> {
  const fail = (status: number, error: string) => Response.json({ error }, { status });
  const body = await request.json().catch(() => null) as {
    sessionId?: unknown;
    parentSessionId?: unknown;
  } | null;
  if (typeof body?.sessionId !== "string" || !body.sessionId.trim())
    return fail(400, "sessionId required");
  if (body.parentSessionId != null && typeof body.parentSessionId !== "string")
    return fail(400, "parentSessionId must be a string or null");

  const { sessions } = options;
  const matches = (session: Session, id: string) =>
    session.sessionId === id || session.nativeSessionId === id;
  const childId = body.sessionId.trim();
  const child = sessions.find((session) => matches(session, childId));
  if (!child) return fail(404, "session not found");
  if (!child.managed || !child.tmuxName)
    return fail(400, "session is not lfg-managed; its parentage cannot be changed");

  const newParentId = typeof body.parentSessionId === "string" ? body.parentSessionId.trim() || null : null;
  const parent = newParentId ? sessions.find((session) => matches(session, newParentId)) : undefined;
  if (newParentId && !parent) return fail(404, "parent session not found");
  if (parent) {
    const seen = new Set<Session>();
    let cursor: Session | undefined = parent;
    while (cursor) {
      if (cursor === child) return fail(400, cursor === parent
        ? "cannot parent a session to itself" : "reparent would create a cycle");
      if (seen.has(cursor)) return fail(400, "parent session has a cycle");
      seen.add(cursor);
      const up: string | null | undefined = cursor.parentSessionId ?? cursor.parentNativeSessionId;
      cursor = up ? sessions.find((session) => matches(session, up)) : undefined;
    }
  }

  const parentSessionId = parent?.sessionId ?? parent?.nativeSessionId ?? null;
  const previousParentId = child.parentSessionId ?? child.parentNativeSessionId;
  if (parent ? !!previousParentId && matches(parent, previousParentId) : !previousParentId)
    return Response.json({ ok: true, sessionId: childId, parentSessionId, changed: false });

  patchManaged(child.tmuxName, {
    parentSessionId: parent?.sessionId ?? undefined,
    parentNativeSessionId: parent?.nativeSessionId ?? undefined,
    parentAgent: parent?.agent ?? undefined,
  });
  options.invalidate();
  if (!parent) return Response.json({ ok: true, sessionId: childId, parentSessionId: null, changed: true });

  // The relationship is already saved. A notification failure must not make
  // the client report that the move failed, or invite a duplicate move.
  let notification: { ok: boolean; error?: string };
  try {
    notification = await options.notifyParent(parent,
      `[session reparented]\nSession ${child.sessionId ?? child.nativeSessionId ?? childId}` +
      `${child.title ? ` (${child.title})` : ""} is now a child of your session.\n` +
      `The user moved this session under you. You can read its history with ` +
      `omg_get_session_messages and send it a message with omg_send_session_message.`);
  } catch (error) {
    notification = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  return Response.json({
    ok: true, sessionId: childId, parentSessionId, changed: true,
    parentNotified: notification.ok,
    ...(!notification.ok && { notificationError: notification.error || "Could not notify the parent session" }),
  });
}
