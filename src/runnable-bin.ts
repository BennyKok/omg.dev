import { accessSync, closeSync, constants, openSync, readSync, realpathSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * True when the kernel can exec this path.
 *
 * `Bun.which` returns the first PATH hit even when that file is the OpenCode
 * npm placeholder: a text file with no shebang. `posix_spawn` then fails with
 * ENOEXEC, and model discovery records an empty catalog until the next probe
 * of the same stub. An ELF, a Mach-O, or a shebang script is runnable.
 */
export function isRunnableCommand(path: string): boolean {
  if (!path) return false;
  let fd: number | null = null;
  try {
    accessSync(path, constants.X_OK);
    fd = openSync(realpathSync(path), "r");
    const buf = Buffer.alloc(4);
    const n = readSync(fd, buf, 0, 4, 0);
    if (n < 2) return false;
    if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) return true;
    if (buf[0] === 0x23 && buf[1] === 0x21) return true;
    if (n < 4) return false;
    const magic = buf.readUInt32BE(0);
    return (
      magic === 0xfeedface ||
      magic === 0xfeedfacf ||
      magic === 0xcafebabe ||
      magic === 0xcefaedfe ||
      magic === 0xcffaedfe ||
      magic === 0xbebafeca
    );
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {}
    }
  }
}

/**
 * First runnable `name` on PATH, then the extras. A non-runnable PATH hit
 * does not hide a later real binary.
 */
export function whichRunnable(
  name: string,
  extra: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
  const seen = new Set<string>();
  for (const candidate of [...dirs.map((dir) => join(dir, name)), ...extra]) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    if (isRunnableCommand(candidate)) return candidate;
  }
  return null;
}
