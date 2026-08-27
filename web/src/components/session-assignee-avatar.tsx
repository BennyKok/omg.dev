import { useState } from "react";

import { UserRound } from "lucide-react";

import { cn } from "@/lib/utils";

export type SessionAssignee = { assignedUser?: string | null };
export type SessionRosterUser = {
  email: string;
  name?: string;
  avatar?: string;
};

function fallbackName(email: string): string {
  return email.split("@")[0]?.trim() || email;
}

/** The person assigned to a normal session, resolved from the bootstrap roster. */
export function SessionAssigneeAvatar({
  session,
  users,
  size = "sm",
  className,
  hideWhenRedundant = false,
  userFilter = "__all",
}: {
  session: SessionAssignee;
  users: SessionRosterUser[];
  size?: "xs" | "sm";
  className?: string;
  /** Agent marks only need an assignee badge when several people are visible. */
  hideWhenRedundant?: boolean;
  userFilter?: string;
}) {
  // Which avatar URL failed to load. userRoster() (users.ts) ends its fallback
  // chain at gravatar(), which always returns a URL, so `avatar` is never empty
  // for a roster member and this component would otherwise always commit to the
  // <img> branch. On a self-hosted box that cannot reach gravatar.com — offline,
  // airgapped, or DNS-filtered — that renders a broken image on every session
  // row, and the placeholder below is unreachable. Falling back on error keeps
  // the locally configured identity (the roster name) visible without a network.
  //
  // Keyed by URL rather than a boolean: user-icons.ts embeds an incrementing
  // `?v=` on every upload, so a replaced icon is a new URL and gets retried,
  // while the URL that actually failed stays suppressed.
  const [failedAvatar, setFailedAvatar] = useState<string | null>(null);

  if (hideWhenRedundant && (users.length <= 1 || userFilter !== "__all")) return null;

  const email = session.assignedUser?.trim();
  if (!email) return null;
  const user = users.find((candidate) => candidate.email === email);
  const name = user?.name?.trim() || fallbackName(email);
  const label = `Assigned to ${name}`;
  const sizeClass = size === "xs" ? "size-4" : "size-5";
  const avatar = user?.avatar;

  return avatar && failedAvatar !== avatar ? (
    <img
      src={avatar}
      alt={label}
      title={label}
      onError={() => setFailedAvatar(avatar)}
      className={cn(sizeClass, "shrink-0 rounded-full object-cover", className)}
    />
  ) : (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        sizeClass,
        "flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground",
        className,
      )}
    >
      <UserRound className={size === "xs" ? "size-2.5" : "size-3"} />
    </span>
  );
}
