/**
 * Which project a session belongs to, and whether it belongs to the selected
 * one. Import-free on purpose so it can be checked without a renderer.
 *
 * ── The bug this was extracted for ────────────────────────────────────────
 *
 * A repo carries TWO names and they are not the same name:
 *
 *   { name: "personal", cwd: "/home/user/project", project: "project" }
 *
 * `name` is the label a person sees and can rename. `project` is the key the
 * box stamps onto every session it starts. `src/repo-list.ts` returns both.
 *
 * The picker used to derive its filter from `name` and compare it against
 * `session.project`. For a repo whose label still matched its folder those two
 * strings were equal by coincidence, so the filter worked and nothing said it
 * was resting on a coincidence. Rename the repo -- which `custom: true` repos
 * exist to let you do -- and the strings diverge, every comparison goes false,
 * and the session list renders EMPTY.
 *
 * Empty is the worst possible failure here because it is indistinguishable
 * from a new account. Nothing errors and nothing is missing from the screen;
 * the screen is simply the same one a person with no sessions would see. It
 * was found on the App Store demo account, whose repo is named `personal` and
 * lives in `/home/user/project`: three real sessions on the box, one of them
 * answered minutes earlier, and the app showed none of them.
 *
 * So take `project` when the box sent it, and fall back only when it did not.
 */

export type ProjectRepo = { name: string; cwd: string; project?: string };

export function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

/**
 * The key a session would be stamped with for this repo. The box's own
 * `project` wins; `name` is a label and is only a guess at the key.
 */
export function projectKey(repo: ProjectRepo): string {
  return repo.project || repo.name || basename(repo.cwd);
}

/**
 * Does this session belong to the selected project? `cwd` is the fallback for
 * a session that predates the `project` stamp.
 */
export function sessionMatchesProject(
  session: { project?: string; cwd?: string },
  activeFilter: string | null,
): boolean {
  if (!activeFilter) return false;
  if (session.project) return session.project === activeFilter;
  return !!session.cwd && basename(session.cwd) === activeFilter;
}
