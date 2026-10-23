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
import { projectNameAsync, reposRoot } from "./projects.ts";
import {
  listCustomRepos,
  listHiddenRepos,
  type CustomRepo,
} from "./repos-store.ts";
import { deployLinkFromProjectAsync, type RepoDeployLink } from "./cloud-apps.ts";

export type { RepoDeployLink };

export type RepoListEntry = {
  name: string;
  cwd: string;
  project: string;
  custom?: boolean;
  /** Present after `omg deploy` writes `.omg/project.json`. */
  deploy?: RepoDeployLink;
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
      // Asynchronous reads: on a slow disk the synchronous ones stopped every
      // LFG request, and the bootstrap's part deadline could not fire.
      const project = await projectNameAsync(cwd);
      // One row per project. A git worktree collapses onto its owning checkout,
      // so without this the same project appears once per worktree.
      if (repos.some((r) => r.project === project)) return;
      const deploy = await deployLinkFromProjectAsync(cwd);
      repos.push({
        name,
        cwd,
        project,
        ...(custom ? { custom: true } : {}),
        ...(deploy ? { deploy } : {}),
      });
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

/**
 * One shared, short-lived copy of the project list.
 *
 * Every GET /api/repos and every bootstrap rebuilt the list from disk, and
 * concurrent requests did not share a build. After a service restart every
 * open app reconnects at once, so about six full scans ran together and each
 * took 3 to 9 seconds (trace log, 2026-10-23). In steady state the list was
 * rebuilt about 470 times an hour at 130 to 150 ms each.
 *
 * A cached list is reused only while the fingerprint (the repos root folder
 * and the pin and hidden files) is unchanged and it is younger than
 * `maxAgeMs`. Adding, cloning, pinning, hiding or removing a project changes
 * the fingerprint, so a write is seen at once. Changes the fingerprint cannot
 * see, such as a deploy link written inside a project, show within `maxAgeMs`.
 * Requests that arrive while a build runs with the same fingerprint share it.
 */
export function createRepoListCache<T>(options: {
  build: () => Promise<T>;
  fingerprint: () => Promise<string>;
  maxAgeMs: number;
  now?: () => number;
}) {
  const now = options.now ?? Date.now;
  let entry: { fingerprint: string; at: number; value: T } | null = null;
  let inflight: { fingerprint: string; promise: Promise<T> } | null = null;
  // A build that started before invalidate() must not refill the cache.
  let generation = 0;
  return {
    async get(): Promise<T> {
      const fingerprint = await options.fingerprint();
      if (entry && entry.fingerprint === fingerprint && now() - entry.at < options.maxAgeMs) return entry.value;
      if (inflight && inflight.fingerprint === fingerprint) return inflight.promise;
      const at = now();
      const started = generation;
      const promise = options.build().then((value) => {
        if (started === generation && (!entry || entry.at <= at)) entry = { fingerprint, at, value };
        return value;
      });
      const mine = { fingerprint, promise };
      inflight = mine;
      const clear = () => { if (inflight === mine) inflight = null; };
      promise.then(clear, clear);
      return promise;
    },
    invalidate() {
      generation++;
      entry = null;
      inflight = null;
    },
  };
}

/** The repo list fingerprint: what changes when a project is added or removed. */
export async function repoListFingerprint(paths: string[]): Promise<string> {
  const parts = await Promise.all(paths.map(async (path) => {
    try {
      const s = await stat(path);
      return `${s.mtimeMs}:${s.size}:${s.ino}`;
    } catch {
      return "-";
    }
  }));
  return parts.join("|");
}
