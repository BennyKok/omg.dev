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

/**
 * A stable, non-empty React key for one session, even when the machine sends
 * one with none of the three real identifiers.
 *
 * The three real ids come first and are preferred whenever any of them
 * exists. When NONE do, this used to return `""` and every call site fell
 * back to `|| index` — which is a key by POSITION, not by identity. Two
 * id-less sessions then keyed as `0`, `1`, … by array order, so a poll that
 * changed nothing but the order (or dropped a session earlier in the list)
 * made React reconcile row N's old content into row N's new session, which
 * reads as one row's card refusing to update, or two different sessions
 * sharing a single animated row that flickers between their content.
 *
 * The fallback is a hash of whatever the session DOES carry — title, agent,
 * cwd, last words said, parent — prefixed so it can never collide with a real
 * id. It is not guaranteed unique (two genuinely identical, id-less sessions
 * still collide), but it is deterministic across re-renders of the same
 * underlying data, which `index` never was, and collisions now require two
 * sessions to agree on every one of those fields rather than merely occupying
 * the same array slot.
 */
export function sessionStableId(session: OmgSession): string {
  const real = session.sessionId || session.nativeSessionId || session.tmuxName;
  if (real) return real;
  return `anon:${hashFields([
    session.title,
    session.lastUserText,
    session.agent,
    session.agentLabel,
    session.cwd,
    session.project,
    session.parentSessionId,
    session.parentNativeSessionId,
  ])}`;
}

/** A short, deterministic, non-cryptographic hash — good enough for a key. */
function hashFields(fields: Array<string | null | undefined>): string {
  let hash = 0;
  const joined = fields.map((f) => f ?? "").join(" ");
  for (let i = 0; i < joined.length; i++) {
    hash = (Math.imul(31, hash) + joined.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
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
