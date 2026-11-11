import { closeSync, existsSync, mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const deviceIsLocked = (home: string) => existsSync(join(home, "run.lock"));

/** One receiver per device home, including a separately running CLI. */
export function lockDevice(home: string): () => void {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const path = join(home, "run.lock");
  let fd: number;
  try {
    fd = openSync(path, "wx", 0o600);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    throw new Error(`Device access is already owned by another process. Stop it first. After a crash, verify the PID in ${path} before removing that file.`);
  }
  writeFileSync(fd, `${process.pid}\n`);
  closeSync(fd);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    rmSync(path, { force: true });
  };
}
