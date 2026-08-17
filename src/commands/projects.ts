import { listConfiguredRepos } from "../repo-list.ts";
import { maintainOwnershipMarkers, maintainProject } from "../project-maintenance.ts";

const HELP = `Usage: omg projects [status|clean]

Audit all projects shown in omg.dev, or remove safe stale Git state.

  status   Show session branches, worktrees, and dirty checkouts. This is the default.
  clean    Remove merged omg.dev session branches, stale worktree metadata, and orphan markers.

The clean command never changes working files. It keeps unmerged branches and checked-out branches.`;

export async function cmdProjects(args: string[]): Promise<void> {
  const [verb = "status", ...rest] = args;
  if (verb === "help" || verb === "--help" || verb === "-h") {
    console.log(HELP);
    return;
  }
  if (rest.length) throw new Error(`Unknown projects option: ${rest[0]}`);
  if (verb !== "status" && verb !== "clean") {
    throw new Error(`Unknown projects command: ${verb}`);
  }

  const apply = verb === "clean";
  const repos = await listConfiguredRepos();
  const reports = await Promise.all(repos.map(repo => maintainProject(repo, apply)));
  const markers = await maintainOwnershipMarkers(undefined, apply);

  for (const report of reports) {
    if (report.error) {
      console.log(`${report.name}: error: ${report.error}`);
      continue;
    }
    const merged = apply ? report.removedSessionBranches.length : report.mergedSessionBranches.length;
    const prunable = apply ? report.prunedWorktrees : report.prunableWorktrees.length;
    const action = apply ? "removed" : "removable";
    console.log(
      `${report.name}: ${report.sessionBranches} session branches, ${merged} ${action}; ` +
      `${report.worktrees} worktrees, ${prunable} ${apply ? "pruned" : "prunable"}; ` +
      `checkout ${report.dirty ? "dirty" : "clean"}`,
    );
    if (!report.sourceBranch) console.log(`  kept all branches: no local main branch`);
    if (report.checkedOutMergedBranches.length) {
      console.log(`  kept ${report.checkedOutMergedBranches.length} merged branches because they are checked out`);
    }
  }
  console.log(
    `ownership markers: ${markers.total} total, ` +
    `${apply ? markers.removed.length + " removed" : markers.orphaned.length + " removable"}`,
  );
}
