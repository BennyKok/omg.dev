/**
 * How a session list is grouped, for every surface.
 *
 * A HAND-MAINTAINED COPY of web/src/lib/session-groups.ts. React Native cannot
 * import from web/src, and this repository's answer to that is a copy plus a
 * guard rather than a copy alone — see scripts/check-theme-drift.ts for the
 * same arrangement around the palette. Keep the two in step; the web file is
 * the source of truth for the RULE, this file only restates it.
 *
 * There is one answer now: by folder. The rail and the mobile list used to
 * disagree — the rail grouped by folder when nothing was scoped, mobile
 * grouped by Working and Idle and never by folder — so the same fleet read as
 * two different shapes depending on the window. The phone was the last surface
 * still on the old scheme.
 *
 * Working/Idle is gone. It moved a session between two groups every time it
 * started or stopped, which reordered the list to say something the row
 * already says on its own mark, and it fought the folder grouping: scoped to
 * one folder you saw one scheme, scoped to all you saw the other.
 *
 * Pure so the two surfaces cannot drift again, and so the ordering is testable
 * without a renderer.
 */

export type ProjectGroupNode = { session: { project?: string | null } };

export type ProjectGroup<N> = {
  /** Stable list key. Sessions with no folder collapse into one group. */
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

/**
 * Strip the legacy `…-repos-<name>` prefix a project key can still carry, so a
 * folder reads as its own name. Mirrors shortProject() in web/src/App.tsx; the
 * phone showed the raw key and so disagreed with the rail on the same folder.
 */
export function shortProject(project: string): string {
  const legacy = project.match(/(?:^|-)repos-(.+)$/)?.[1];
  if (legacy) return legacy;
  return project;
}

export function groupNodesByProject<N extends ProjectGroupNode>(
  nodes: readonly N[],
  countOf: (node: N) => number,
  label: (project: string) => string = shortProject,
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
      label: project ? label(project) : NO_PROJECT_LABEL,
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
