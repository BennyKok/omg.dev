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
}: {
  session: SessionAssignee;
  users: SessionRosterUser[];
  size?: "xs" | "sm";
  className?: string;
}) {
  const email = session.assignedUser?.trim();
  if (!email) return null;
  const user = users.find((candidate) => candidate.email === email);
  const name = user?.name?.trim() || fallbackName(email);
  const label = `Assigned to ${name}`;
  const sizeClass = size === "xs" ? "size-4" : "size-5";

  return user?.avatar ? (
    <img
      src={user.avatar}
      alt={label}
      title={label}
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
