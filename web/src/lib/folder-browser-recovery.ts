export type FolderRecoveryLocation = "parent" | "projects" | "home";

export type FolderBrowseResult<T> = {
  payload: T;
  unavailablePath: string | null;
  recoveryLocation: FolderRecoveryLocation | null;
};

function parentFolder(path: string): string | null {
  const normalized = path.replace(/\/+$/, "");
  const separator = normalized.lastIndexOf("/");
  if (separator <= 0) return null;
  return normalized.slice(0, separator);
}

/**
 * Open a folder and recover from a path that disappeared between listings.
 *
 * A directory row can become stale at any time. Try the nearest useful place
 * first, then the configured projects root, then the user's home directory.
 */
export async function browseFolderWithRecovery<T>(
  path: string | undefined,
  load: (path?: string) => Promise<T>,
): Promise<FolderBrowseResult<T>> {
  try {
    return {
      payload: await load(path),
      unavailablePath: null,
      recoveryLocation: null,
    };
  } catch (originalError) {
    const attempts: { path: string | undefined; location: FolderRecoveryLocation }[] = [];
    const parent = path ? parentFolder(path) : null;
    if (parent) attempts.push({ path: parent, location: "parent" });
    attempts.push({ path: undefined, location: "projects" });
    attempts.push({ path: "~", location: "home" });

    const seen = new Set<string>();
    for (const attempt of attempts) {
      const key = attempt.path ?? "<projects>";
      if (seen.has(key) || attempt.path === path) continue;
      seen.add(key);
      try {
        return {
          payload: await load(attempt.path),
          unavailablePath: path ?? "your projects folder",
          recoveryLocation: attempt.location,
        };
      } catch {
        // Keep trying from the nearest location to the broadest safe one.
      }
    }

    throw originalError;
  }
}

export function folderRecoveryNotice(
  unavailablePath: string,
  recoveryLocation: FolderRecoveryLocation,
): string {
  const destination = recoveryLocation === "parent"
    ? "its parent folder"
    : recoveryLocation === "projects"
      ? "your projects folder"
      : "your home folder";
  return `Folder “${unavailablePath}” is no longer available. Choose another folder. Showing ${destination} instead.`;
}
