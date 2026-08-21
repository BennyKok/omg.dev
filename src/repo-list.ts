// Building the project picker.
//
// Three sources feed one list, and the interesting part is what happens when
// they disagree. Extracted from serve.ts so those collision rules are
// unit-testable — they were previously expressed only as the order of three
// loops in a 5000-line file, which is how the pin-vs-scan bug survived.

import { readdir, realpath, stat } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import { projectName, reposRoot } from "./projects.ts";
import {
  listCustomRepos,
  listHiddenRepos,
  type CustomRepo,
} from "./repos-store.ts";

export type RepoListEntry = {
  name: string;
  cwd: string;
  project: string;
  custom?: boolean;
};

export type RepoListSources = {
  /** Already-realpath'd repos root to scan one level deep. */
  reposRoot: string;
  /** LFG's own checkout, always offered as a trusted target. */
  selfRepo: string;
  /** User-pinned paths, typically outside the repos root. */
  customRepos: CustomRepo[];
  /** Canonical cwds the user explicitly unlinked. */
  hidden: string[];
};

export async function buildRepoList(sources: RepoListSources): Promise<RepoListEntry[]> {
  const repos: RepoListEntry[] = [];
  const hidden = new Set(sources.hidden);

  const addRepo = async (name: string, cwd: string, custom = false) => {
    if (repos.some((r) => r.cwd === cwd)) return;
    // Checked for every source, including the self repo: an unlink the picker
    // silently declines to honour is the bug this list exists to fix.
    if (hidden.has(cwd)) return;
    try {
      await stat(join(cwd, ".git"));
      const project = projectName(cwd);
      // One row per project. A git worktree collapses onto its owning checkout,
      // so without this the same project appears once per worktree.
      if (repos.some((r) => r.project === project)) return;
      repos.push(custom ? { name, cwd, project, custom: true } : { name, cwd, project });
    } catch {}
  };

  // Pins first, deliberately. Whichever source runs first wins a project-name
  // collision, and when the loser was a hand-pinned path the user watched a
  // folder they chose explicitly fail to appear, with no error raised anywhere
  // — `~/work/duet` silently lost to a `~/repos/duet` they had forgotten about.
  // A pin is a stated preference; a scan hit is an accident of where a folder
  // happens to sit. The stated preference wins.
  for (const r of sources.customRepos) await addRepo(r.name, r.cwd, true);

  let entries: Dirent[] = [];
  try {
    entries = await readdir(sources.reposRoot, { withFileTypes: true });
  } catch {}
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    await addRepo(entry.name, join(sources.reposRoot, entry.name));
  }

  await addRepo("lfg", sources.selfRepo);

  repos.sort((a, b) => a.name.localeCompare(b.name));
  return repos;
}

/**
 * The configured project list used by every command surface.
 *
 * Keep discovery here. A second scan in a CLI command can disagree with the
 * server about pins, hidden projects, symlinks, and worktree ownership. That
 * is especially dangerous for maintenance commands, which must act on exactly
 * the projects the UI presents.
 */
export async function listConfiguredRepos(input?: {
  reposRoot?: string;
  selfRepo?: string;
}): Promise<RepoListEntry[]> {
  const configuredRoot = input?.reposRoot ?? reposRoot();
  let root = configuredRoot;
  try {
    root = await realpath(configuredRoot);
  } catch {}
  return buildRepoList({
    reposRoot: root,
    selfRepo: input?.selfRepo ?? PATHS.root,
    customRepos: await listCustomRepos(),
    hidden: await listHiddenRepos(),
  });
}
