import { Globe, UserRound } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export type UserFilterRosterUser = {
  email: string;
  name?: string;
  avatar?: string;
};

function shortUser(email: string): string {
  return email.split("@")[0]?.trim() || email;
}

export function UserFilterMenu({
  value,
  users,
  onChange,
  displayUser,
  size = "md",
}: {
  value: string;
  users: UserFilterRosterUser[];
  onChange: (value: string) => void;
  /** Cached trigger appearance only; never adds a roster option. */
  displayUser?: UserFilterRosterUser;
  /**
   * "sm" for the desktop rail header, where it sits in a row of 32px
   * controls beside the brand and a 32px face outweighed both.
   */
  size?: "sm" | "md";
}) {
  const active = value !== "__all";
  const selected = users.find((user) => user.email === value) ?? (displayUser?.email === value ? displayUser : undefined);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label="Filter live sessions by user"
            title={
              selected ? (selected.name ?? shortUser(selected.email)) : active ? "Unassigned" : "All users"
            }
            className={cn(
              // 32px, not 24. This used to sit inside a glass island that gave
              // it presence; the island went when the overflow menu moved into
              // the side navigation, and a 24px disc alone in the corner read
              // as a stray dot rather than the person you are filtered to.
              "relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full transition",
              size === "sm" ? "size-6" : "size-8",
              // A photo is its own shape. Drawing a plate and a border behind
              // it left a ring of card colour around the face, which is what
              // made it look like a card with the island already gone. The
              // icon fallbacks are line art and still need a body.
              selected?.avatar
                ? active
                  ? "ring-2 ring-primary/40"
                  : ""
                : cn(
                    "border",
                    active
                      ? "border-primary/40 text-primary"
                      : "border-border bg-muted/70 text-foreground",
                  ),
            )}
          />
        }
      >
        {selected?.avatar ? (
          <img src={selected.avatar} alt="" className="size-full object-cover" />
        ) : active ? (
          <UserRound className={cn("shrink-0", size === "sm" ? "size-3.5" : "size-[18px]")} />
        ) : (
          <Globe className={cn("shrink-0", size === "sm" ? "size-3.5" : "size-[18px]")} />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => onChange(typeof next === "string" ? next : "__all")}
        >
          <DropdownMenuLabel>Filter by user</DropdownMenuLabel>
          <DropdownMenuRadioItem value="__all">
            <Globe className="size-5 shrink-0 text-muted-foreground" />
            All users
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="__unassigned">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted">
              <UserRound className="size-3" />
            </span>
            Unassigned
          </DropdownMenuRadioItem>
          {users.length ? <DropdownMenuSeparator /> : null}
          {users.map((user) => (
            <DropdownMenuRadioItem key={user.email} value={user.email}>
              {user.avatar ? (
                <img src={user.avatar} alt="" className="size-5 shrink-0 rounded-full object-cover" />
              ) : (
                <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted">
                  <UserRound className="size-3" />
                </span>
              )}
              <span className="truncate capitalize">{user.name ?? shortUser(user.email)}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
