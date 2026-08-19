// Lightweight multi-user tagging for sessions. There's no auth — this is a
// personal Tailscale tool — it's just a way to split the session list between
// people sharing the box. The *current* user is a per-browser choice
// (localStorage, picked on first visit); the session→user assignments live here
// server-side so they're shared across tabs/devices.
//
// Assignments are keyed by the tmux session NAME, not the sessionId: the name
// is stable, while /clear rotates the sessionId — keying on the name keeps a
// tag attached to the same terminal across clears.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname } from "node:path";
import { PATHS } from "./config.ts";
import { onboardingProfilesSync } from "./onboarding.ts";
import { boxAccountEmail } from "./box-account.ts";
import { userIconsSync, iconUrl } from "./user-icons.ts";

// Roster config. Each LFG_USERS entry is `email` or `email:displayname` — the
// optional name is what the UI shows (raw emails are hard to scan). Parse once
// into the email list (USERS, kept as plain strings so USERS[0] / .includes()
// callers stay unchanged) plus an email→name map.
const ROSTER = (process.env.LFG_USERS ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const i = entry.indexOf(":");
    return i === -1
      ? { email: entry, name: "" }
      : { email: entry.slice(0, i).trim(), name: entry.slice(i + 1).trim() };
  })
  .filter((u) => u.email);

export const USERS = ROSTER.map((u) => u.email);

const NAMES: Record<string, string> = Object.fromEntries(
  ROSTER.map((u) => [u.email, u.name]),
);

// Full roster: env-configured users plus profiles created through onboarding
// (data/onboarding.json). Env wins on order so USERS[0]-style defaults keep
// pointing at the configured primary user. Read per-call, not cached — the
// onboarding flow adds profiles at runtime.
export function rosterEmails(): string[] {
  return [...new Set([...USERS, ...onboardingProfilesSync().map((p) => p.email)])];
}

/**
 * Return the paired box account only when it is already a roster member.
 * This gives an ownerless root session a safe last-resort attribution without
 * inventing a user or assigning it to the first configured person.
 */
export function rosterBoxAccount(
  roster: string[] = rosterEmails(),
  accountEmail: string | null = boxAccountEmail(),
): string | undefined {
  return accountEmail && roster.includes(accountEmail) ? accountEmail : undefined;
}

export type SessionUserTag =
  | { ok: true; user: string | undefined }
  | { ok: false; unknown: string };

/**
 * Decide the user tag for an incoming session transition.
 *
 * Multi-user tagging is opt-in. The roster is LFG_USERS plus onboarding
 * profiles, and when both are empty there is nobody to split the session list
 * between — the feature is OFF, not "every user is invalid". A hosted
 * deployment (an omg Computer is one box per account) is exactly that shape,
 * and a client that tags sessions with the signed-in identity was 400ing every
 * create or resume against a box with no roster to map it to. So a roster-less
 * instance drops the tag and leaves the session unassigned.
 *
 * With a roster configured the old contract stands: an unknown email is a hard
 * error, never a silently-unassigned session.
 */
export function resolveSessionUserTag(
  requested: string | null | undefined,
  roster: string[] = rosterEmails(),
): SessionUserTag {
  const wanted = requested?.trim() || undefined;
  if (roster.length === 0) return { ok: true, user: undefined };
  if (wanted && !roster.includes(wanted)) return { ok: false, unknown: wanted };
  return { ok: true, user: wanted };
}

// Friendly display name for an email — the configured name, else the
// onboarding-profile name, else the local-part of the address.
export function displayName(email: string): string {
  if (NAMES[email]) return NAMES[email];
  const stored = onboardingProfilesSync().find((p) => p.email === email)?.name;
  return stored || email.split("@")[0];
}

// Gravatar avatar URL for an email — shows the user's real photo if they have a
// Gravatar, else a deterministic per-email identicon. MD5 is computed here
// (the browser has no MD5) and the roster is served with avatars baked in.
export function gravatar(email: string): string {
  const h = createHash("md5").update(email.trim().toLowerCase()).digest("hex");
  // Cache-buster: the base URL is keyed only by the email hash, so when a user
  // swaps their Gravatar photo the URL is unchanged and the browser/CDN keep
  // serving the stale image forever. Rotate a token on a 10-minute bucket so an
  // updated avatar propagates within ~10min instead of being pinned, without
  // hammering Gravatar on every request.
  const bucket = Math.floor(Date.now() / 600_000);
  return `https://www.gravatar.com/avatar/${h}?d=identicon&s=80&_=${bucket}`;
}

// Legacy fallback: avatars uploaded during onboarding before user-icons.ts
// existed are still recorded on the profile itself (data/onboarding.json).
// Nothing writes this field anymore (see onboarding.ts's setProfileAvatar) —
// it is read-only, kept so an already-uploaded photo doesn't disappear out
// from under an existing install just because the storage was refactored.
function legacyOnboardingAvatarUrl(email: string): string | undefined {
  const file = onboardingProfilesSync().find((p) => p.email === email)?.avatar;
  return file ? `/api/avatars/${file}` : undefined;
}

export function userRoster(): { email: string; name: string; avatar: string }[] {
  // A settings-uploaded icon (user-icons.ts) beats a legacy onboarding photo,
  // which beats Gravatar. Both upload paths are served by
  // GET /api/avatars/<file> out of data/avatars/.
  const icons = userIconsSync();
  return rosterEmails().map((email) => ({
    email,
    name: displayName(email),
    avatar: iconUrl(icons, email) ?? legacyOnboardingAvatarUrl(email) ?? gravatar(email),
  }));
}

/**
 * Which identity key an icon upload/replace/remove for `requested` should
 * act on, or why it can't be resolved. THE hosted-side identity decision:
 *
 * A box with a configured roster (LFG_USERS / onboarding profiles) keys the
 * icon by a roster email, exactly like every other roster-scoped action
 * (assignUser, resolveSessionUserTag) — several people can share one box, so
 * "whose icon" has to name one of them, and an unrecognized email is a hard
 * error for the same reason a typo'd session tag is.
 *
 * A hosted Computer is provisioned with its roster intentionally empty (see
 * onboarding.ts's HostedFirstRun doc) — there is no roster to validate an
 * email against, but unlike session tagging (where an empty roster correctly
 * means "the feature is off"), an icon is never actually ownerless on a
 * hosted box: it is paired to exactly one omg account (box-account.ts), and
 * that account IS the identity. So a roster-less box ignores whatever email
 * the caller sent (there is no roster identity to have sent) and keys the
 * icon by the paired account instead. The only real failure is a roster-less,
 * unpaired box — a bare local dev checkout with nobody signed in at all.
 */
export function iconIdentityKey(
  requested: string | null | undefined,
  roster: string[] = rosterEmails(),
  accountEmail: string | null = boxAccountEmail(),
): { ok: true; key: string } | { ok: false; reason: string } {
  if (roster.length > 0) {
    const wanted = requested?.trim().toLowerCase() || undefined;
    if (!wanted) return { ok: false, reason: "expected an email" };
    if (!roster.includes(wanted)) return { ok: false, reason: "unknown user" };
    return { ok: true, key: wanted };
  }
  if (accountEmail) return { ok: true, key: accountEmail };
  return { ok: false, reason: "no identity available on this box" };
}

/**
 * Who is "on this machine" for display purposes — the facepile, a "who's on
 * this machine" settings row, anywhere that wants people rather than session
 * tags. Deliberately NOT userRoster()/rosterEmails(): those feed the
 * onboarding "fresh install" gate and session-tag validation, both of which
 * read an empty roster as a specific, meaningful signal that a synthesized
 * entry here must never disturb (see the giant caller-facing comment on
 * resolveSessionUserTag).
 *
 * So this composes rather than replaces: the roster when one is configured
 * (a real box may be shared by several people), else the single omg account
 * the box is paired to — a roster-less hosted Computer is never actually
 * empty of people, it just has exactly one and no roster to name them with —
 * else nobody (a bare, unpaired local checkout).
 */
export function machineMembers(
  roster: { email: string; name: string; avatar: string }[] = userRoster(),
  accountEmail: string | null = boxAccountEmail(),
): { email: string; name: string; avatar: string }[] {
  if (roster.length) return roster;
  if (!accountEmail) return [];
  const icons = userIconsSync();
  return [
    {
      email: accountEmail,
      name: displayName(accountEmail),
      avatar: iconUrl(icons, accountEmail) ?? gravatar(accountEmail),
    },
  ];
}

const FILE = `${PATHS.data}/session-users.json`;

function readAll(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, string>): void {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(all, null, 2));
}

// tmuxName → userEmail (only assigned names present).
export function userAssignments(): Record<string, string> {
  return readAll();
}

// Assign (or, with user=null, clear) the tag for a tmux session name. Unknown
// emails are rejected so a typo can't strand a session under a phantom user.
export function assignUser(tmuxName: string, user: string | null): boolean {
  if (user && !rosterEmails().includes(user)) return false;
  const all = readAll();
  if (user) all[tmuxName] = user;
  else delete all[tmuxName];
  writeAll(all);
  return true;
}
