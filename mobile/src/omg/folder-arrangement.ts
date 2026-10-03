/**
 * The folder rail's arrangement, as the machine stores it.
 *
 * The machine owns the order and hidden set (GlobalSettings.folderOrder and
 * hiddenFolders in /api/settings), so the iOS rail and the web folder menu
 * show the same thing. The machine stores PROJECT KEYS, the identity the web
 * and sessions use. The rail works in cwds. These two functions translate.
 *
 * Free of React Native imports so it can be checked without a renderer.
 */
import { projectKey, type ProjectRepo } from "./project-filter";

/** In cwds: what the rail renders. */
export type RailArrangement = { order: string[]; hidden: string[] };
/** In project keys: what the machine stores. */
export type StoredArrangement = { order: string[]; hidden: string[] };

/** Stored keys to the cwds of the folders this machine lists. Unknown keys drop out. */
export function toRail(stored: StoredArrangement, repos: readonly ProjectRepo[]): RailArrangement {
  const byKey = new Map<string, string>();
  for (const repo of repos) {
    const key = projectKey(repo);
    if (!byKey.has(key)) byKey.set(key, repo.cwd);
  }
  const cwds = (keys: string[]) =>
    keys.map((key) => byKey.get(key)).filter((cwd): cwd is string => !!cwd);
  return { order: cwds(stored.order), hidden: cwds(stored.hidden) };
}

/**
 * The rail's arrangement back to keys, merged into what the machine has.
 *
 * The web menu can arrange keys the rail never sees (a project known only
 * from its sessions). Those are kept: hidden ones stay hidden, and ordered
 * ones keep their place after the rail's own folders.
 */
export function toStored(
  rail: RailArrangement,
  repos: readonly ProjectRepo[],
  previous: StoredArrangement,
): StoredArrangement {
  const byCwd = new Map(repos.map((repo) => [repo.cwd, projectKey(repo)] as const));
  const known = new Set(byCwd.values());
  const keys = (cwds: string[]) =>
    cwds.map((cwd) => byCwd.get(cwd)).filter((key): key is string => !!key);
  const order = [...new Set([...keys(rail.order), ...previous.order.filter((key) => !known.has(key))])];
  const hidden = [...new Set([...keys(rail.hidden), ...previous.hidden.filter((key) => !known.has(key))])];
  return { order, hidden };
}
