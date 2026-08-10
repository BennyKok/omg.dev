// Mapping a requested cwd onto an entry in the repo picker.
//
// Extracted from serve.ts so the rules are unit-testable: the picker is built
// by scanning the repos root, and the ways a legitimate cwd can be missing
// from it are subtle enough that they earned their own tests.

import { isAbsolute, resolve } from "node:path";
import { projectName, worktreeOwnerCheckout } from "./projects.ts";

export type RepoEntry = { name: string; cwd: string; project: string; custom?: boolean };

// Only the fields repo resolution reads. Structural on purpose: serve.ts's
// Session is a much larger row, and this module has no business knowing it.
export type ParentRef = { cwd?: string | null; project?: string | null };

export function cwdIsWithin(absCwd: string, absRoot: string): boolean {
  return absCwd === absRoot || absCwd.startsWith(`${absRoot}/`);
}

export function resolveInputCwd(rawCwd: string, baseCwd?: string | null): string {
  return !isAbsolute(rawCwd) && baseCwd ? resolve(baseCwd, rawCwd) : resolve(rawCwd);
}

export function repoContainingCwd(
  repos: RepoEntry[],
  rawCwd: string | null | undefined,
  baseCwd?: string | null,
): RepoEntry | undefined {
  const cwd = rawCwd?.trim();
  if (!cwd) return undefined;
  const wanted = resolveInputCwd(cwd, baseCwd);
  return repos
    .filter((repo) => cwdIsWithin(wanted, resolve(repo.cwd)))
    .sort((a, b) => resolve(b.cwd).length - resolve(a.cwd).length)[0];
}

export function repoForParentSession(
  repos: RepoEntry[],
  parent: ParentRef | undefined,
): RepoEntry | undefined {
  if (!parent) return undefined;
  // Bound locally: narrowing on `parent.cwd` does not survive into the find()
  // callbacks, and projectName() does not accept undefined.
  const { cwd, project } = parent;
  return (
    repoContainingCwd(repos, cwd) ??
    (project ? repos.find((repo) => repo.project === project) : undefined) ??
    (cwd ? repos.find((repo) => repo.project === projectName(cwd)) : undefined)
  );
}

export function repoForRequestedSessionCwd(
  repos: RepoEntry[],
  rawCwd: string,
  parent: ParentRef | undefined,
): RepoEntry | undefined {
  const explicit = repoContainingCwd(repos, rawCwd, parent?.cwd);
  if (explicit) return explicit;

  // Subagent callers sometimes pass their current directory, which may be an
  // isolated /tmp/lfg-wt checkout that is deliberately absent from /api/repos.
  // If that path is inside the parent session's cwd, map it back to the parent
  // project instead of treating it as an arbitrary unknown repo.
  if (parent?.cwd && cwdIsWithin(resolveInputCwd(rawCwd, parent.cwd), resolve(parent.cwd))) {
    return repoForParentSession(repos, parent);
  }

  // A git worktree of a listed repo is a legitimate cwd that the picker will
  // never contain. listRepos() drops it on purpose: projectName() collapses a
  // worktree onto its owning checkout, and the picker keeps one entry per
  // project. So `~/repos/vibes-e2e` (a worktree of vibes) is absent even though
  // vibes itself is right there, and it is not *inside* vibes either — path
  // containment alone can never match it.
  //
  // That is not a hypothetical: auto agents run in exactly such worktrees, and
  // the finding sheet's "Execute" posts the agent's own cwd. Every finding from
  // house-computer-e2e (~/repos/vibes-e2e) and video-ideas (~/distributor) died
  // on a 400 "unknown repo" for months, while the same worktree resolved fine
  // everywhere else — withAutoAgentMeta already calls projectName() to group
  // those agents under their owning project in the UI.
  //
  // Resolve via the worktree's own git metadata rather than by matching
  // projectName() strings: an unrelated /tmp/vibes would share the derived name
  // and get silently redirected into the real repo, whereas only a genuine
  // linked worktree has an owning checkout to point at. A standalone repo that
  // is missing from the picker stays a 400 — it is a different repo, not a view
  // of a listed one.
  const owner = worktreeOwnerCheckout(resolveInputCwd(rawCwd, parent?.cwd));
  if (owner) return repoContainingCwd(repos, owner);

  return undefined;
}
