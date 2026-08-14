/**
 * Sessions are a FOREST, not a list — an agent that spawns subagents owns them.
 *
 * The web draws this (buildSessionTree in web/src/App.tsx) and the phone did
 * not, so a session that spawned three subagents showed up as four unrelated
 * rows with near-identical names, and the one you actually started was
 * indistinguishable from the work it delegated.
 *
 * Two rules are worth copying exactly, because getting either wrong is worse
 * than having no tree at all:
 *
 *   IDENTITY — a session is keyed by `sessionId || nativeSessionId`, and a
 *   parent is named by EITHER of those. The link is resolved through a map of
 *   both, so a child naming its parent's native id still finds it.
 *
 *   BUSY IS INHERITED — a parent whose subagent is working IS working, even
 *   though its own process is idle while it waits. Sectioning on the parent's
 *   own flag alone drops a live family into "Idle", which is exactly when you
 *   are looking for it.
 */

import type { OmgSession } from "@omg-dev/protocol";

export type SessionNode = { session: OmgSession; children: SessionNode[] };

export function sessionStableId(session: OmgSession): string {
  return session.sessionId || session.nativeSessionId || session.tmuxName || "";
}

export function buildSessionTree(sessions: OmgSession[]): SessionNode[] {
  const nodeById = new Map<string, SessionNode>();
  /** Either id form → the stable id, so a parent named by either resolves. */
  const keyToId = new Map<string, string>();

  for (const session of sessions) {
    const id = sessionStableId(session);
    if (!id) continue;
    nodeById.set(id, { session, children: [] });
    if (session.sessionId) keyToId.set(session.sessionId, id);
    if (session.nativeSessionId) keyToId.set(session.nativeSessionId, id);
  }

  const childIds = new Set<string>();
  for (const [id, node] of nodeById) {
    const parentKey = node.session.parentSessionId || node.session.parentNativeSessionId;
    const parentId = parentKey ? keyToId.get(parentKey) : undefined;
    // A session that names itself, or names a parent this machine is not
    // reporting, stays a root — an orphan is still worth showing.
    if (!parentId || parentId === id) continue;
    const parent = nodeById.get(parentId);
    if (!parent) continue;
    parent.children.push(node);
    childIds.add(id);
  }

  return sessions
    .map(sessionStableId)
    .filter((id) => id && nodeById.has(id) && !childIds.has(id))
    .map((id) => nodeById.get(id)!)
    .filter((node, index, all) => all.indexOf(node) === index);
}

/** A family is working if anyone in it is. See the header. */
export function nodeBusy(node: SessionNode): boolean {
  return !!node.session.busy || node.children.some(nodeBusy);
}

/** Every session in a subtree, parent first — for counting a section. */
export function flattenNodes(nodes: SessionNode[]): OmgSession[] {
  return nodes.flatMap((node) => [node.session, ...flattenNodes(node.children)]);
}
