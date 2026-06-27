// On-disk store for saved browser-login profiles. Each profile is a captured
// Playwright storageState (cookies + localStorage origins) that an agent's
// browser can reuse to act as a logged-in user. Metadata lives in a single
// index.json; the (sensitive) storageState for each profile is its own
// <id>.json, chmod 0600 since it holds session cookies.
//
// Mirrors the JSON-store style in src/users.ts and reuses the same data dir
// (PATHS.data) so everything stays under ~/.lfg/data.
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { PATHS } from "../config.ts";

export type ProfileMeta = {
  id: string;
  name: string;
  origins: string[];
  createdAt: number;
  lastUsedAt: number | null;
  status: "active" | "expired";
};

const DIR = join(PATHS.data, "browser-profiles");
const INDEX = join(DIR, "index.json");

function ensureDir(): void {
  mkdirSync(DIR, { recursive: true });
}

function readIndex(): ProfileMeta[] {
  try {
    const parsed = JSON.parse(readFileSync(INDEX, "utf8"));
    return Array.isArray(parsed) ? (parsed as ProfileMeta[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(all: ProfileMeta[]): void {
  ensureDir();
  writeFileSync(INDEX, JSON.stringify(all, null, 2));
}

// Absolute path to a profile's storageState file. Exported so session.ts /
// tool.ts can hand it straight to Playwright's { storageState } option.
export function profileStatePath(id: string): string {
  return join(DIR, `${id}.json`);
}

export async function listProfiles(): Promise<ProfileMeta[]> {
  return readIndex();
}

export async function getProfile(id: string): Promise<ProfileMeta | null> {
  return readIndex().find((p) => p.id === id) ?? null;
}

// Persist a storageState snapshot under `id`, creating or updating its metadata.
// The state file is written first (0600), then the index is updated, so a saved
// profile in the index always has a backing state file.
export async function saveProfileState(
  id: string,
  name: string,
  storageState: unknown,
  origins: string[],
): Promise<ProfileMeta> {
  ensureDir();
  const statePath = profileStatePath(id);
  writeFileSync(statePath, JSON.stringify(storageState, null, 2));
  chmodSync(statePath, 0o600);

  const all = readIndex();
  const now = Date.now();
  const existing = all.find((p) => p.id === id);
  let meta: ProfileMeta;
  if (existing) {
    existing.name = name;
    existing.origins = origins;
    existing.status = "active";
    meta = existing;
  } else {
    meta = {
      id,
      name,
      origins,
      createdAt: now,
      lastUsedAt: null,
      status: "active",
    };
    all.push(meta);
  }
  writeIndex(all);
  return meta;
}

export async function deleteProfile(id: string): Promise<void> {
  const all = readIndex().filter((p) => p.id !== id);
  writeIndex(all);
  try {
    rmSync(profileStatePath(id), { force: true });
  } catch {
    // best-effort: index is already updated
  }
}

// Record that a profile was just used by an agent browser.
export async function touchProfile(id: string): Promise<void> {
  const all = readIndex();
  const meta = all.find((p) => p.id === id);
  if (!meta) return;
  meta.lastUsedAt = Date.now();
  writeIndex(all);
}

// Short random hex id (no Date.now entropy concerns — pure crypto randomness).
export function newProfileId(): string {
  return randomBytes(6).toString("hex");
}
