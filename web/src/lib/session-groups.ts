/**
 * How a session list is grouped, for every width.
 *
 * There is one answer now: by folder. The rail and the mobile list used to
 * disagree — the rail grouped by folder when nothing was scoped, mobile
 * grouped by Working and Idle and never by folder — so the same fleet read as
 * two different shapes depending on the window.
 *
 * Working/Idle is gone from both. It moved a session between two groups every
 * time it started or stopped, which reordered the list to say something the
 * row already says on its own mark, and it fought the folder grouping: scoped
 * to one folder you saw one scheme, scoped to all you saw the other.
 *
 * Pure so the two surfaces cannot drift again, and so the ordering is testable
 * without a DOM.
 */

export type ProjectGroupNode = { session: { project?: string | null } };

export type ProjectGroup<N> = {
  /** Stable React key. Sessions with no folder collapse into one group. */
  key: string;
  /** What the header shows, and what scoping to this group is called. */
  label: string;
  /** The raw project key to scope by. Empty for the no-folder group. */
  project: string;
  nodes: N[];
  /** Sessions in the group, counting a family's children, not just its root. */
  count: number;
};

/** The label a folder-less session's group carries. */
export const NO_PROJECT_LABEL = "No project";

export function groupNodesByProject<N extends ProjectGroupNode>(
  nodes: readonly N[],
  countOf: (node: N) => number,
  shortLabel: (project: string) => string,
): ProjectGroup<N>[] {
  const groups = new Map<string, ProjectGroup<N>>();
  for (const node of nodes) {
    const project = node.session.project || "";
    const key = project || "__no_project";
    const group = groups.get(key);
    if (group) {
      group.nodes.push(node);
      group.count += countOf(node);
      continue;
    }
    groups.set(key, {
      key,
      label: project ? shortLabel(project) : NO_PROJECT_LABEL,
      project,
      nodes: [node],
      count: countOf(node),
    });
  }
  // Sorted by label, not by insertion. `find`-style ordering would let two
  // refreshes return the folders in different orders and read as the list
  // shuffling itself.
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}
