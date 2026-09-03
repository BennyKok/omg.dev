import { ShieldCheck } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Viewer } from "@/lib/viewer-role";

/**
 * The role this browser views as. An owner can pick any role to see the app
 * the way that role sees it; anyone else gets a label. Hidden when the box
 * has no role beyond owner, because then there is nothing to choose.
 */
export function ViewerRoleMenu({
  viewer,
  roles,
  onPreview,
  className,
}: {
  viewer: Viewer;
  roles: { id: string; name: string }[];
  onPreview: (roleId: string) => void;
  className?: string;
}) {
  if (roles.length < 2) return null;
  const previewing = viewer.canSwitchRole && viewer.role.id !== "owner";
  const buttonClass = cn(
    "inline-flex h-6 max-w-28 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-medium transition disabled:cursor-default",
    previewing ? "border-primary/40 text-primary" : "border-border bg-muted/70 text-foreground",
    className,
  );
  const label = (
    <>
      <ShieldCheck className="size-3.5 shrink-0" />
      <span className="truncate">{viewer.role.name}</span>
    </>
  );
  if (!viewer.canSwitchRole) {
    return (
      <span aria-label={`Viewing as ${viewer.role.name}`} title={`Role: ${viewer.role.name}`} className={buttonClass}>
        {label}
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Viewing as ${viewer.role.name}`}
            title={previewing ? `Previewing as ${viewer.role.name}` : `Role: ${viewer.role.name}`}
            className={buttonClass}
          />
        }
      >
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuRadioGroup
          value={viewer.role.id}
          onValueChange={(next) => onPreview(typeof next === "string" ? next : "owner")}
        >
          <DropdownMenuLabel>View as</DropdownMenuLabel>
          {roles.map((role) => (
            <DropdownMenuRadioItem key={role.id} value={role.id}>
              {role.name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
