/**
 * A project folder links to one hosted app through `.omg/project.json`. The
 * runtime puts that link on each repo row as `deploy`. Web and iOS both show it
 * for the session's project, so the matching rule lives here once.
 */
export type AppLink = { slug: string; url: string; name?: string; projectId?: string };

type RepoWithLink = { cwd: string; project?: string; deploy?: AppLink };

/** The repo a session runs in: its folder, or the repo that holds its worktree. */
export function sessionAppRepo<R extends RepoWithLink>(
  session: { cwd?: string | null; project?: string | null },
  repos: readonly R[],
): R | undefined {
  const cwd = session.cwd?.trim();
  if (!cwd) return undefined;
  const byFolder = repos
    .filter((repo) => cwd === repo.cwd || cwd.startsWith(`${repo.cwd}/`))
    .sort((a, b) => b.cwd.length - a.cwd.length)[0];
  if (byFolder) return byFolder;
  // A worktree lives outside its repo folder. The project label still names it.
  return session.project ? repos.find((repo) => repo.project === session.project) : undefined;
}

/** The app's page in the developer console. */
export function consoleAppUrl(slug: string): string {
  return `https://console.omg.dev/apps/${encodeURIComponent(slug)}`;
}
