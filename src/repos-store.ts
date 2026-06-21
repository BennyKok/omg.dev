// Custom project paths — repos that live outside LFG_REPOS_ROOT. The repo
// picker normally only offers git repos discovered under LFG_REPOS_ROOT (plus
// lfg itself). This store lets a user pin an arbitrary path on the box so it
// shows up alongside the scanned ones. Persisted as a flat JSON array so it
// survives restarts; merged into listRepos() at request time.

import { mkdir, stat, realpath } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { homedir } from "node:os";
import { PATHS } from "./config.ts";

export type CustomRepo = { name: string; cwd: string };

const filePath = () => join(PATHS.data, "custom-repos.json");

async function ensure() {
  await mkdir(PATHS.data, { recursive: true });
}

export async function listCustomRepos(): Promise<CustomRepo[]> {
  const f = Bun.file(filePath());
  if (!(await f.exists())) return [];
  try {
    const parsed = JSON.parse(await f.text());
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is CustomRepo =>
        r && typeof r.name === "string" && typeof r.cwd === "string",
    );
  } catch {
    return [];
  }
}

// Expand a leading ~ and resolve to an absolute, canonical path. Throws if the
// path can't be resolved (doesn't exist) so the caller can surface a 400.
async function canonical(rawPath: string): Promise<string> {
  let p = rawPath.trim();
  if (!p) throw new Error("path is required");
  if (p === "~") p = homedir();
  else if (p.startsWith("~/")) p = join(homedir(), p.slice(2));
  const abs = resolve(p);
  try {
    return await realpath(abs);
  } catch {
    throw new Error(`path does not exist: ${abs}`);
  }
}

// Add a custom project path. Validates it exists and is a git repo (we only
// launch agents into git repos). Name defaults to the directory basename.
// Idempotent on cwd — re-adding an existing path just updates its name.
export async function addCustomRepo(
  rawPath: string,
  rawName?: string,
): Promise<CustomRepo> {
  const cwd = await canonical(rawPath);
  let info;
  try {
    info = await stat(cwd);
  } catch {
    throw new Error(`path does not exist: ${cwd}`);
  }
  if (!info.isDirectory()) throw new Error(`not a directory: ${cwd}`);
  try {
    await stat(join(cwd, ".git"));
  } catch {
    throw new Error(`not a git repo (no .git): ${cwd}`);
  }
  const name = (rawName?.trim() || basename(cwd) || cwd).slice(0, 60);
  const repo: CustomRepo = { name, cwd };
  await ensure();
  const existing = await listCustomRepos();
  const next = [...existing.filter((r) => r.cwd !== cwd), repo];
  next.sort((a, b) => a.name.localeCompare(b.name));
  await Bun.write(filePath(), JSON.stringify(next, null, 2));
  return repo;
}

export async function removeCustomRepo(rawCwd: string): Promise<void> {
  const cwd = rawCwd.trim();
  if (!cwd) return;
  const existing = await listCustomRepos();
  // Match on the stored value as-is, and also on the canonical form, so a
  // remove works whether the caller passes the raw or resolved path.
  let canon: string | null = null;
  try {
    canon = await canonical(cwd);
  } catch {}
  const next = existing.filter((r) => r.cwd !== cwd && r.cwd !== canon);
  if (next.length === existing.length) return;
  await ensure();
  await Bun.write(filePath(), JSON.stringify(next, null, 2));
}
