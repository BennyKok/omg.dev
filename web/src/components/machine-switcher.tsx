import { Check, ChevronsUpDown, Cloud, Laptop, Plus, Pencil } from "lucide-react";

import { useEmbeddedHostOptions, type HostMachine } from "../lib/embedded-host-options";
import { cn } from "../lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

type MachineChoice = { id: string; name: string };
type MachineRow = { kind: string; status: string; online: boolean };
type Entry = { choice: MachineChoice; row: MachineRow | null; canRename?: boolean };

/** Present a host-supplied machine as the row shape the menu renders. */
function hostEntry(machine: HostMachine): Entry {
  if (machine.kind === "local") {
    return { choice: { id: machine.id, name: machine.name }, row: null, canRename: machine.canRename };
  }
  return {
    choice: { id: machine.id, name: machine.name },
    canRename: machine.canRename,
    row: { kind: machine.kind, online: machine.online, status: machine.status ?? (machine.online ? "live" : "offline") },
  };
}

function machineStatusLabel(row: MachineRow): string {
  if (row.status === "none") return "Not set up";
  return row.online ? "Online" : "Offline";
}

/**
 * Which machine this UI is pointed at, and a menu to change it.
 *
 * Two placements, one menu. On desktop it is the last row of the session
 * rail, the same spot the hosted app docks its own navigation. It reads the
 * machine's name, so the rail always says where you are. On mobile it is an
 * icon at the top left of the Live header, because that header has no room
 * for a name.
 *
 * Only a host page that embeds this UI supplies machines. A local install
 * runs on this computer only, so it shows no switcher.
 */
export function MachineSwitcher({
  variant,
  collapsed = false,
  onHostAction,
}: {
  variant: "rail" | "icon" | "nav";
  /** Rail placement only: the rail is at its 56px width, show the icon alone. */
  collapsed?: boolean;
  /** Close enclosing navigation before a host-owned Add/Edit dialog opens. */
  onHostAction?: () => void;
}) {
  const host = useEmbeddedHostOptions().machines;
  if (!host || host.machines.length === 0) return null;
  const entries = host.machines.map(hostEntry);
  const activeId = host.activeId;
  const select = (choice: MachineChoice) => host.onSelect(choice.id);
  const addMachine = () => { onHostAction?.(); host.onAdd?.(); };

  const current = entries.find((entry) => entry.choice.id === activeId) ?? entries[0]!;
  const CurrentIcon = current.row?.kind === "cloud" ? Cloud : Laptop;
  const currentName = current.choice.name;

  const trigger =
    variant === "icon" ? (
      <button
        type="button"
        aria-label={`Machine: ${currentName}. Change machine`}
        title={currentName}
        data-machine-switcher="icon"
        className="relative flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <CurrentIcon className="size-[18px]" />
      </button>
    ) : (
      <button
        type="button"
        aria-label={`Machine: ${currentName}. Change machine`}
        title={currentName}
        data-machine-switcher={variant === "nav" ? "nav" : "rail"}
        className={cn(
          "flex h-10 shrink-0 items-center rounded-lg text-left text-[13px] font-medium text-foreground transition-colors hover:bg-muted",
          collapsed ? "w-10 justify-center" : "w-full gap-2 px-2",
        )}
      >
        <span className="relative flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-foreground/[0.06]">
          <CurrentIcon className="size-4 text-foreground/70" />
        </span>
        {collapsed ? null : (
          <>
            <span className="min-w-0 flex-1 truncate">{currentName}</span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </>
        )}
      </button>
    );

  return (
    <div className={cn(variant === "rail" && "shrink-0 border-t border-border", variant === "rail" && (collapsed ? "flex justify-center py-2" : "px-2 py-2"))}>
      <DropdownMenu>
        <DropdownMenuTrigger render={trigger} />
        <DropdownMenuContent
          side={variant === "rail" ? "top" : "bottom"}
          align="start"
          sideOffset={8}
          className="w-64 p-1.5"
          data-machine-menu=""
        >
          {/* Menu.GroupLabel throws without a Menu.Group around it (Base UI
              #31), and the throw takes down the whole route. Group the label
              with the rows it labels. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Machines
            </DropdownMenuLabel>
            {entries.map(({ choice, row, canRename }) => {
              const selected = choice.id === activeId;
              const Icon = row?.kind === "cloud" ? Cloud : Laptop;
              return (
                <div key={choice.id} className="flex items-center gap-0.5">
                  <DropdownMenuItem
                    data-machine-option={choice.id}
                    aria-current={selected ? "true" : undefined}
                    onClick={() => {
                      if (!selected) select(choice);
                    }}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-2"
                  >
                    <span className="relative flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-foreground/[0.06]">
                      <Icon className="size-4 text-foreground/70" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{choice.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {row ? machineStatusLabel(row) : "The box that served this page"}
                      </span>
                    </span>
                    {selected ? <Check className="size-4 shrink-0 text-primary" /> : null}
                  </DropdownMenuItem>
                  {host.onRename && canRename !== false && row?.status !== "none" ? (
                    <DropdownMenuItem
                      aria-label={`Edit ${choice.name}`}
                      title={`Edit ${choice.name}`}
                      data-machine-edit={choice.id}
                      className="size-9 shrink-0 justify-center rounded-lg p-0 text-muted-foreground"
                      onClick={() => { onHostAction?.(); host.onRename?.(choice.id); }}
                    >
                      <Pencil className="size-3.5" />
                    </DropdownMenuItem>
                  ) : null}
                </div>
              );
            })}
          </DropdownMenuGroup>
          {host.onAdd ? <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={addMachine}><Plus className="size-4" />Add machine</DropdownMenuItem>
          </> : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
