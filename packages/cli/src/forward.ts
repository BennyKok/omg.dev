import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type ForwardDependencies = {
  which?: (name: string) => string | null;
  exists?: (path: string) => boolean;
  spawn?: (argv: string[]) => Promise<number>;
  homedir?: () => string;
};

export function defaultExists(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The install always exposes `lfg`. `omg` may be this npm wrapper, so looking
 * it up would recurse. Prefer `lfg`, then the well-known launcher path.
 */
export function findInstall(dependencies: ForwardDependencies = {}): string | null {
  const which = dependencies.which ?? ((name: string) => Bun.which(name));
  const exists = dependencies.exists ?? defaultExists;
  const found = which("lfg");
  if (found) return found;
  const fallback = join((dependencies.homedir ?? homedir)(), ".local", "bin", "lfg");
  return exists(fallback) ? fallback : null;
}

export async function forwardToInstall(
  argv: string[],
  dependencies: ForwardDependencies = {},
): Promise<{ forwarded: boolean; exitCode: number; binary: string | null }> {
  const binary = findInstall(dependencies);
  if (!binary) return { forwarded: false, exitCode: 1, binary: null };
  const spawn =
    dependencies.spawn ??
    (async (command: string[]) => {
      const child = Bun.spawn(command, { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
      return await child.exited;
    });
  return { forwarded: true, exitCode: await spawn([binary, ...argv]), binary };
}
