import { useEffect, useState } from "react";
import type { UserFilterRosterUser } from "../components/user-filter-menu";

// Display metadata only. Never used for authorization, roster membership, or
// session attribution. Scope by machine and identity to avoid cross-user reuse.
export function useHeaderProfile(scope: string, identity: string | null, user?: UserFilterRosterUser) {
  const key = identity ? `omg:header-profile:${scope}:${identity}` : null;
  const [cached, setCached] = useState<{ key: string; user: UserFilterRosterUser } | null>(null);
  useEffect(() => {
    if (!key) { setCached(null); return; }
    try {
      if (user) {
        const display = { email: user.email, name: user.name, avatar: user.avatar };
        window.sessionStorage.setItem(key, JSON.stringify(display));
        setCached({ key, user: display });
      } else {
        const raw = window.sessionStorage.getItem(key);
        const display = raw ? JSON.parse(raw) as UserFilterRosterUser : null;
        const valid = display?.email === identity
          && (display.name === undefined || typeof display.name === "string")
          && (display.avatar === undefined || typeof display.avatar === "string");
        setCached(valid && display ? { key, user: display } : null);
      }
    } catch { setCached(null); }
  }, [key, identity, user]);
  return user ?? (cached?.key === key ? cached.user : undefined);
}
