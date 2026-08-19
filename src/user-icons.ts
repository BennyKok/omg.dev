// Single owner for uploaded user icons — the settings-configurable avatar
// (Part 1 of the avatar/icon feature) and the legacy onboarding profile photo
// both funnel through here now, keyed by an arbitrary "identity key" string
// rather than by "an onboarding profile must already exist". That decoupling
// is what makes a hosted, roster-less Computer able to have an icon at all:
// see `iconIdentityKey` in users.ts for which key a given request resolves to
// (a roster email when a roster is configured, else the box's paired omg
// account email).
//
// Storage: one directory of normalized webp files (data/avatars/, unchanged
// from the original onboarding-only layout so already-served URLs keep
// working) plus one small JSON index (data/user-icons.json) mapping identity
// key -> { file, version, updatedAt }. `file` is always `md5(key).webp`, so
// re-uploading for the same key overwrites the same path — no orphaned
// extensions to clean up the way the old png/jpg/webp/gif mix could leave
// behind.
//
// Cache-busting: gravatar() (users.ts) rotates a 10-minute time bucket
// because it has no control over when the third-party image actually
// changes. We control this origin directly, so we don't need to guess — each
// upload bumps `version`, the served URL embeds it (`?v=<version>`), and a
// version therefore never refers to two different images. That makes the
// image cacheable *forever* at that exact URL instead of merely "for up to
// ten minutes", and a replace is visible on the very next request rather than
// eventually.
import { readFileSync, mkdirSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { PATHS } from "./config.ts";
import { loadSharp } from "./native-deps.ts";

export const AVATARS_DIR = () => join(PATHS.data, "avatars");

export const AVATAR_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

const ACCEPTED_UPLOAD_MIME = new Set(Object.values(AVATAR_MIME_BY_EXT));

// Bytes cap applies to the ORIGINAL upload, before normalization — this is
// what stands between a request body and disk/memory, so it has to hold
// regardless of what the image turns out to decode to.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// Dimension guards apply to the DECODED image. The lower bound rejects a
// 1x1-style upload that would just be a solid color once resized; the upper
// bound is a decompression-bomb guard — a small file that claims an enormous
// canvas is expensive to resize even though it passed the byte cap.
const MIN_INPUT_DIMENSION = 32;
const MAX_INPUT_DIMENSION = 8000;

// Every stored icon is normalized to one square size — icons only ever render
// small (facepiles, filter dropdowns, session rows), so there is nothing to
// gain from keeping the original resolution, and a fixed size keeps layout
// math (the facepile ring math in particular) simple everywhere.
const OUTPUT_SIZE = 256;
const OUTPUT_WEBP_QUALITY = 82;

export type UserIconRecord = { file: string; version: number; updatedAt: string };
type UserIconsState = Record<string, UserIconRecord>;

const iconsFilePath = () => join(PATHS.data, "user-icons.json");

const normalizeKey = (key: string) => key.trim().toLowerCase();

function sanitize(raw: unknown): UserIconsState {
  if (!raw || typeof raw !== "object") return {};
  const out: UserIconsState = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const v = value as Partial<UserIconRecord>;
    if (
      typeof v.file === "string" &&
      /^[a-f0-9]{32}\.[a-z0-9]+$/.test(v.file) &&
      typeof v.version === "number" &&
      Number.isFinite(v.version) &&
      typeof v.updatedAt === "string"
    ) {
      out[normalizeKey(key)] = { file: v.file, version: v.version, updatedAt: v.updatedAt };
    }
  }
  return out;
}

/** Sync read for users.ts, whose roster/display helpers can't await. */
export function userIconsSync(): UserIconsState {
  try {
    return sanitize(JSON.parse(readFileSync(iconsFilePath(), "utf8")));
  } catch {
    return {};
  }
}

function writeIcons(state: UserIconsState): void {
  mkdirSync(dirname(iconsFilePath()), { recursive: true });
  Bun.write(iconsFilePath(), JSON.stringify(state, null, 2));
}

/** The served, cache-busted URL for a key's icon, or undefined if it has none. */
export function iconUrl(icons: UserIconsState, key: string): string | undefined {
  const rec = icons[normalizeKey(key)];
  return rec ? `/api/avatars/${rec.file}?v=${rec.version}` : undefined;
}

export function fileForKey(key: string): string {
  return `${createHash("md5").update(normalizeKey(key)).digest("hex")}.webp`;
}

/**
 * Validate, normalize, and store an uploaded icon for an identity key.
 * Throws a user-facing message on invalid input so the route can 400 it.
 */
export async function setUserIcon(
  key: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<{ url: string }> {
  const normalizedKey = normalizeKey(key);
  if (!normalizedKey) throw new Error("expected an identity to attach the icon to");
  if (!bytes.length) throw new Error("empty image");
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new Error(`image too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB)`);
  }
  if (!ACCEPTED_UPLOAD_MIME.has(mimeType)) {
    throw new Error("expected a png, jpeg, webp, or gif image");
  }

  const sharp = await loadSharp();
  const meta = await sharp(Buffer.from(bytes))
    .metadata()
    .catch(() => null);
  const { width, height } = meta ?? {};
  if (!width || !height) throw new Error("couldn't read that image");
  if (width < MIN_INPUT_DIMENSION || height < MIN_INPUT_DIMENSION) {
    throw new Error(`image too small (min ${MIN_INPUT_DIMENSION}x${MIN_INPUT_DIMENSION}px)`);
  }
  if (width > MAX_INPUT_DIMENSION || height > MAX_INPUT_DIMENSION) {
    throw new Error(`image too large (max ${MAX_INPUT_DIMENSION}x${MAX_INPUT_DIMENSION}px)`);
  }

  const normalized = await sharp(Buffer.from(bytes))
    .rotate() // respect EXIF orientation before the square crop
    .resize({ width: OUTPUT_SIZE, height: OUTPUT_SIZE, fit: "cover" })
    .webp({ quality: OUTPUT_WEBP_QUALITY })
    .toBuffer();

  const file = fileForKey(normalizedKey);
  await mkdir(AVATARS_DIR(), { recursive: true });
  await Bun.write(join(AVATARS_DIR(), file), normalized);

  const state = userIconsSync();
  const version = (state[normalizedKey]?.version ?? 0) + 1;
  state[normalizedKey] = { file, version, updatedAt: new Date().toISOString() };
  writeIcons(state);

  return { url: iconUrl(state, normalizedKey)! };
}

/** Delete a stored icon. Returns false (not an error) when there was none. */
export async function removeUserIcon(key: string): Promise<boolean> {
  const normalizedKey = normalizeKey(key);
  const state = userIconsSync();
  const rec = state[normalizedKey];
  if (!rec) return false;
  delete state[normalizedKey];
  writeIcons(state);
  await rm(join(AVATARS_DIR(), rec.file), { force: true }).catch(() => undefined);
  return true;
}
