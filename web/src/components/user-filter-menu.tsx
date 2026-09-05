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
}: {
  value: string;
  users: UserFilterRosterUser[];
  onChange: (value: string) => void;
  /** Cached trigger appearance only; never adds a roster option. */
  displayUser?: UserFilterRosterUser;
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
              "relative inline-flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full border transition",
              active ? "border-primary/40 text-primary" : "border-border bg-muted/70 text-foreground",
            )}
          />
        }
      >
        {selected?.avatar ? (
          <img src={selected.avatar} alt="" className="size-full object-cover" />
        ) : active ? (
          <UserRound className="size-4 shrink-0" />
        ) : (
          <Globe className="size-4 shrink-0" />
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
