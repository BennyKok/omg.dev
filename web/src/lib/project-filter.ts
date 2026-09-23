export const PROJECT_FILTER_STORAGE_KEY = "lfg_v2_project_filter";

type ProjectFilterStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): ProjectFilterStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readCachedProjectFilter(
  storage: ProjectFilterStorage | null = browserStorage(),
): string {
  try {
    return storage?.getItem(PROJECT_FILTER_STORAGE_KEY) || "__all";
  } catch {
    return "__all";
  }
}

export function cacheProjectFilter(
  projectFilter: string,
  storage: ProjectFilterStorage | null = browserStorage(),
): void {
  try {
    storage?.setItem(PROJECT_FILTER_STORAGE_KEY, projectFilter);
  } catch {
    // Storage can be unavailable in hardened/private browser contexts. The
    // current page still keeps the selection in React state.
  }
}

/**
 * The filter value for chats that were started without a project.
 *
 * It cannot be the empty string the server stores on the session, because
 * `readCachedProjectFilter` reads "" back as "no saved value" and falls to
 * "__all". It also cannot be a real project key, so it carries the same
 * "__"-prefix as "__all". It matches the group key `groupNodesByProject`
 * already uses for the folder-less group, so the rail group header and the
 * filter pill name the same thing.
 */
export const NO_PROJECT_FILTER = "__no_project";

/** What the no-project filter is called in the rail, the menu and the sheet. */
export const NO_PROJECT_FILTER_LABEL = "No project";

/**
 * Does this session belong in the list the current filter is showing?
 *
 * The no-project filter matches ONLY an explicit empty project. A legacy row
 * has no project field at all and still falls back to its working directory
 * (see docs/no-project-chat.md), so folding `undefined` in here would drag
 * every pre-project session into a list of scratch chats.
 */
export function sessionMatchesProjectFilter(
  session: { project?: string | null },
  projectFilter: string,
): boolean {
  if (projectFilter === "__all") return true;
  if (projectFilter === NO_PROJECT_FILTER) return session.project === "";
  return session.project === projectFilter;
}

/** The label for one entry of the project filter, sentinels included. */
export function projectFilterLabel(
  value: string,
  shortProject: (project: string) => string,
): string {
  if (value === "__all") return "All projects";
  if (value === NO_PROJECT_FILTER) return NO_PROJECT_FILTER_LABEL;
  return shortProject(value);
}

/**
 * The filter a rail press produces.
 *
 * Pressing the pill that is already selected clears the scope. The rail lost
 * its "All" pill, so this is the only way back to every folder from the rail
 * itself, and without it choosing a folder on a phone would be a one-way
 * door: the other clear control lives on the list's group headers, and a
 * scoped list has only one header.
 *
 * Here rather than in the rail because the rail owns no selection state, and
 * here rather than at each call site because there are two rails, one per
 * width, and they have already drifted once.
 */
export function projectFilterAfterPress(pressed: string, current: string): string {
  return pressed === current ? "__all" : pressed;
}
