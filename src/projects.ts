import { homedir } from "node:os";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

export function reposRoot(): string {
  return process.env.LFG_REPOS_ROOT ?? `${homedir()}/repos`;
}

function topFolderName(absCwd: string): string {
  const absRoot = resolve(reposRoot());
  const rel = relative(absRoot, absCwd);
  if (rel && !rel.startsWith("..") && rel !== ".." && !rel.startsWith("/")) {
    return rel.split(/[\\/]/).filter(Boolean)[0] || basename(absRoot) || absCwd;
  }
  return basename(absCwd) || absCwd;
}

function worktreeMainPath(absCwd: string): string | null {
  const gitPath = join(absCwd, ".git");
  if (!existsSync(gitPath)) return null;
  try {
    if (statSync(gitPath).isDirectory()) return absCwd;
    const text = readFileSync(gitPath, "utf8").trim();
    const rawGitDir = text.match(/^gitdir:\s*(.+)$/i)?.[1]?.trim();
    if (!rawGitDir) return null;
    const gitDir = resolve(absCwd, rawGitDir);
    const marker = "/.git/worktrees/";
    const idx = gitDir.indexOf(marker);
    if (idx === -1) return null;
    return gitDir.slice(0, idx);
  } catch {
    return null;
  }
}

// Project identity is the top-level repository project, not the full cwd.
// Nested directories and git worktrees collapse back to their main project so
// temporary branch/worktree folders do not become separate project filters.
export function projectName(cwd: string | null): string {
  if (!cwd) return "-";
  const absCwd = resolve(cwd);
  const main = worktreeMainPath(absCwd);
  return topFolderName(main ?? absCwd);
}
