// Volumes the storage page should name. One row per real mount, so a second
// disk (session worktrees on /mnt/data) is not hidden behind the system disk.
import { statfsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { PATHS, WORKTREE_ROOT, worktreeRoots } from "./config.ts";

export type HostDisk = {
  /** Mount path. Rows are capacity, not a role name. */
  label: string;
  mount: string;
  totalBytes: number;
  /** Blocks a normal user can still write. Matches `df` Avail. */
  freeBytes: number;
  /** Small marker, set only on the disk new session worktrees open on. */
  badge: string | null;
};

type Mount = { mount: string };

/** Decode the octal escapes `/proc/mounts` uses for spaces and slashes. */
export function decodeMountPath(raw: string): string {
  return raw.replace(/\\([0-7]{3})/g, (_, octal: string) =>
    String.fromCharCode(parseInt(octal, 8)),
  );
}

export function parseMountTable(text: string): Mount[] {
  const mounts: Mount[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    const parts = line.split(" ");
    const mount = parts[1];
    if (!mount) continue;
    mounts.push({ mount: decodeMountPath(mount) });
  }
  return mounts;
}

/** Longest mount that contains `path`. `/` always wins over a shorter miss. */
export function mountForPath(path: string, mounts: readonly Mount[]): string {
  const abs = resolve(path);
  let best = "/";
  for (const { mount } of mounts) {
    if (mount.length < best.length) continue;
    if (abs === mount || abs.startsWith(mount === "/" ? "/" : `${mount}/`)) {
      best = mount;
    }
  }
  return best;
}

function bytesOf(path: string): { total: number; free: number } | null {
  try {
    const disk = statfsSync(path);
    const total = Number(disk.blocks) * Number(disk.bsize);
    // bavail is what `df` prints as Avail. bfree still counts root-reserved
    // blocks the agents cannot use.
    const free = Number(disk.bavail) * Number(disk.bsize);
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(free)) return null;
    return { total, free: Math.max(0, Math.min(total, free)) };
  } catch {
    return null;
  }
}

/**
 * Distinct volumes for the paths omg writes to.
 * `mountText` is `/proc/mounts` contents. Tests pass a fixture.
 */
export function hostDisks(mountText: string): HostDisk[] {
  const mounts = parseMountTable(mountText);
  const targets = ["/", PATHS.data, WORKTREE_ROOT, ...worktreeRoots()];
  const createMount = mountForPath(WORKTREE_ROOT, mounts);
  const seen = new Set<string>();
  const disks: HostDisk[] = [];
  for (const target of targets) {
    let mount = "/";
    try {
      statSync(target);
      mount = mountForPath(target, mounts);
    } catch {
      mount = mountForPath(target, mounts);
    }
    if (seen.has(mount)) continue;
    seen.add(mount);
    const bytes = bytesOf(mount);
    if (!bytes) continue;
    disks.push({
      label: mount,
      mount,
      totalBytes: bytes.total,
      freeBytes: bytes.free,
      badge: mount === createMount ? "worktree" : null,
    });
  }
  disks.sort((a, b) => {
    if (a.mount === "/") return -1;
    if (b.mount === "/") return 1;
    return a.mount.localeCompare(b.mount);
  });
  return disks;
}
