// Which repo the new-session composer starts on.
//
// The rule is "last selection, else the first available project". The subtlety
// is the *else*: a remembered `cwd` is only a valid default while it still
// names a project the server knows about. Projects get removed, and
// localStorage is per-device, so the remembered path can easily name a folder
// that is gone (or never existed on this machine). Before this validation the
// stale path won outright over `repos[0]`, so the composer pinned itself to a
// dead directory — the picker rendered the raw path instead of a project name,
// which is the visible tell that we fell through to `shortProject()`.
export function resolveComposerRepo(input: {
  /** Repo forced by a project-scoped live view. Wins outright when set. */
  scopedCwd?: string;
  /** Last selection, typically from localStorage. */
  lastCwd?: string | null;
  /** Known projects, server-ordered; `repos[0]` is the first available. */
  repos: { cwd: string }[];
}): string {
  const { scopedCwd, lastCwd, repos } = input;
  if (scopedCwd) return scopedCwd;
  // Repos not loaded yet: keep the remembered value rather than flashing the
  // wrong project. It gets validated on the next render, once the list lands.
  if (!repos.length) return lastCwd || "";
  if (lastCwd && repos.some((repo) => repo.cwd === lastCwd)) return lastCwd;
  return repos[0]?.cwd || "";
}
