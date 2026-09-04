/**
 * The machine's user roster and the session-list filter built on it — the
 * phone's copy of web/src/lib/user-filter.ts plus the `/api/users` read the
 * web does at bootstrap and on window focus.
 *
 * A session carries `assignedUser` (an email) or nothing. The roster
 * (`GET /api/users`) maps each email to a display name and an avatar URL, and
 * the filter in the header narrows the list to one person, to the unclaimed
 * pile, or to everyone. Picking a PERSON also keeps every unassigned session —
 * see sessionMatchesUserFilter for why that inclusion is the whole point.
 *
 * The chosen filter is persisted the way the web persists
 * `lfg_v2_user_filter`, so the list reopens the way it was left. It is NOT
 * carried into new sessions as an identity: the native app authenticates by
 * omg account and never sends a roster email (the web's hosted rule,
 * `userFilterUpdatesStandaloneIdentity`, is false here always).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";

import { STORAGE_KEYS } from "./config";
import { useOmg } from "./provider";

/** Mirrors the `users` rows of GET /api/users (src/users.ts userRoster). */
export type RosterUser = {
  email: string;
  name?: string;
  /** Absolute (Gravatar) or machine-relative (`/api/avatars/<file>`). */
  avatar?: string;
};

export const ALL_USERS = "__all";
export const UNASSIGNED_USERS = "__unassigned";

/** "ada" for ada@example.com — what the web shows when a name is missing. */
export function shortUser(email: string): string {
  return email.split("@")[0]?.trim() || email;
}

export function rosterUserLabel(user: RosterUser): string {
  return user.name?.trim() || shortUser(user.email);
}

/**
 * Verbatim port of web/src/lib/user-filter.ts. Sessions created from the
 * phone carry no owner at all, so a person view that dropped unassigned
 * sessions would hide live work the phone itself started.
 */
export function sessionMatchesUserFilter(
  session: { assignedUser?: string | null },
  userFilter: string,
): boolean {
  if (userFilter === ALL_USERS) return true;
  if (userFilter === UNASSIGNED_USERS) return !session.assignedUser;
  return session.assignedUser === userFilter || !session.assignedUser;
}

export function useUserRoster(): RosterUser[] {
  const { client, bindingId } = useOmg();
  const [users, setUsers] = useState<RosterUser[]>([]);

  // A machine switch invalidates the roster: it belongs to the box.
  useEffect(() => {
    setUsers([]);
  }, [bindingId]);

  // On every focus, like the web's window-focus refetch: the avatar URL
  // carries a rotating cache-buster and a replaced photo should show up.
  useFocusEffect(
    useCallback(() => {
      if (!client) return;
      let live = true;
      client.transport
        .request<{ users?: RosterUser[] }>("/api/users")
        .then((payload) => {
          if (live) setUsers(Array.isArray(payload.users) ? payload.users : []);
        })
        .catch(() => {
          // An older machine has no roster endpoint. No filter, not an error.
          if (live) setUsers([]);
        });
      return () => {
        live = false;
      };
    }, [client]),
  );

  return users;
}

/**
 * The persisted filter, reconciled against the roster: a stored email that
 * has left the roster falls back to everyone rather than filtering the list
 * down to nothing with no visible reason.
 */
export function useUserFilter(users: RosterUser[]): [string, (next: string) => void] {
  const [value, setValue] = useState(ALL_USERS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    AsyncStorage.getItem(STORAGE_KEYS.userFilter)
      .then((stored) => {
        if (live && stored) setValue(stored);
      })
      .catch(() => {})
      .finally(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded || !users.length) return;
    if (value === ALL_USERS || value === UNASSIGNED_USERS) return;
    if (users.some((user) => user.email === value)) return;
    setValue(ALL_USERS);
    void AsyncStorage.setItem(STORAGE_KEYS.userFilter, ALL_USERS);
  }, [loaded, users, value]);

  const change = useCallback((next: string) => {
    setValue(next);
    void AsyncStorage.setItem(STORAGE_KEYS.userFilter, next);
  }, []);

  return [value, change];
}

const avatarUriCache = new Map<string, string>();

function readAsDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("avatar bytes unreadable"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("avatar bytes were not a data URI"));
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * Something an RN `Image` can draw for a roster avatar.
 *
 * Gravatar URLs are absolute and public, so they pass through. An uploaded
 * icon is served from the machine at `/api/avatars/<file>` behind the
 * transport's grant, so it is fetched through the transport and handed over
 * as a data URI — the same move remote-image.tsx makes for attachments.
 */
export function useAvatarUri(avatar: string | undefined): string | null {
  const { client } = useOmg();
  const [uri, setUri] = useState<string | null>(() =>
    avatar ? (avatarUriCache.get(avatar) ?? (isAbsolute(avatar) ? avatar : null)) : null,
  );

  useEffect(() => {
    if (!avatar) {
      setUri(null);
      return;
    }
    if (isAbsolute(avatar)) {
      setUri(avatar);
      return;
    }
    const cached = avatarUriCache.get(avatar);
    if (cached) {
      setUri(cached);
      return;
    }
    if (!client) {
      setUri(null);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const response = await client.transport.fetch(avatar);
        if (!response.ok) throw new Error(`avatar ${response.status}`);
        const data = await readAsDataUri(await response.blob());
        avatarUriCache.set(avatar, data);
        if (live) setUri(data);
      } catch {
        if (live) setUri(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [avatar, client]);

  return uri;
}

function isAbsolute(url: string): boolean {
  return /^https?:\/\//i.test(url);
}
