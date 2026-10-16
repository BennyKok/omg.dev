/**
 * Which subagent groups are open in the session list.
 *
 * A parent session's subagents fold behind one "N subagents" row, as in the
 * iOS app (mobile/src/omg/subagent-group.tsx). A group with no choice yet is
 * shut, unless one of its sessions is open on the stage: hiding the row you
 * are reading would leave nothing in the list marking where you are.
 *
 * One live copy for the whole app. The rail rows and the rail's keyboard
 * order are built in different places and must agree, or j/k walks rows that
 * are not on screen. It is not persisted: iOS keeps the same choice in
 * component state, and session ids churn too fast to keep a stored list
 * meaningful.
 */
let choices: ReadonlyMap<string, boolean> = new Map();
const listeners = new Set<() => void>();

/** Stable snapshot: identity changes only when a choice changes. */
export function getSubagentGroupChoices(): ReadonlyMap<string, boolean> {
  return choices;
}

export function subscribeSubagentGroupChoices(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Record the reader's choice for one parent. `open` is the wanted state. */
export function setSubagentGroupOpen(parentId: string, open: boolean): void {
  if (!parentId || choices.get(parentId) === open) return;
  const next = new Map(choices);
  next.set(parentId, open);
  choices = next;
  for (const listener of listeners) listener();
}

export function isSubagentGroupOpen(
  parentId: string,
  descendantIds: readonly string[],
  activeIds: ReadonlySet<string>,
  current: ReadonlyMap<string, boolean> = choices,
): boolean {
  const choice = current.get(parentId);
  if (choice !== undefined) return choice;
  return descendantIds.some((id) => activeIds.has(id));
}

type TreeNode<S> = { session: S; children: TreeNode<S>[] };

export function flattenDescendants<S>(node: TreeNode<S>): S[] {
  return node.children.flatMap((child) => [child.session, ...flattenDescendants(child)]);
}

/**
 * Sessions in the order the list draws them: each root, then its whole
 * subtree only when its subagent group is open. Grandchildren live in the
 * root's group, flat, as on iOS.
 */
export function visibleTreeSessions<S>(
  roots: readonly TreeNode<S>[],
  isOpen: (root: TreeNode<S>, descendants: S[]) => boolean,
): S[] {
  return roots.flatMap((root) => {
    const descendants = flattenDescendants(root);
    if (!descendants.length) return [root.session];
    return isOpen(root, descendants) ? [root.session, ...descendants] : [root.session];
  });
}

/** Tests only. */
export function resetSubagentGroupChoices(): void {
  choices = new Map();
}
