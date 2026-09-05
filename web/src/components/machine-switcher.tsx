import { Check, ChevronsUpDown, Cloud, Laptop } from "lucide-react";

import {
  LOCAL_MACHINE_CHOICE,
  machineStatusLabel,
  rowMachineChoice,
  useCloudMachines,
  type CloudComputerRow,
} from "../lib/cloud-machines";
import { useEmbeddedHostOptions, type HostMachine } from "../lib/embedded-host-options";
import { activeMachine, selectMachine, type MachineChoice } from "../lib/machines";
import { cn } from "../lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

type Entry = { choice: MachineChoice; row: CloudComputerRow | null };

/** The list the switcher draws and how a pick is applied, from either owner. */
type MachineSource = {
  entries: Entry[];
  activeId: string;
  select: (choice: MachineChoice) => void;
};

/** Present a host-supplied machine as the row shape the menu already renders. */
function hostEntry(machine: HostMachine): Entry {
  if (machine.kind === "local") {
    return { choice: { id: machine.id, name: machine.name }, row: null };
  }
  return {
    choice: { id: machine.id, name: machine.name },
    row: {
      slug: machine.id,
      name: machine.name,
      kind: machine.kind,
      online: machine.online,
      status: machine.status ?? (machine.online ? "live" : "offline"),
      isDefault: false,
    },
  };
}

/**
 * The box's own account list, used when no host supplies one. Hidden until
 * the box is signed in with a reachable machine.
 */
function useBoxMachines(enabled: boolean, onSelect: (choice: MachineChoice) => void): MachineSource | null {
  const { status, computers } = useCloudMachines(enabled);
  const active = activeMachine();
  if (!enabled) return null;
  const reachable: Entry[] = (computers ?? []).flatMap((row) => {
    const choice = rowMachineChoice(row);
    return choice ? [{ choice, row }] : [];
  });
  if (!status?.signedIn || reachable.length === 0) return null;
  return {
    entries: [{ choice: LOCAL_MACHINE_CHOICE, row: null }, ...reachable],
    activeId: active.id,
    select: onSelect,
  };
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
 * Renders nothing until the box is signed in to omg Cloud with a machine it
 * can reach, so a plain install keeps exactly the layout it had.
 */
export function MachineSwitcher({
  variant,
  collapsed = false,
  onSelect = selectMachine,
}: {
  variant: "rail" | "icon";
  /** Rail placement only: the rail is at its 56px width, show the icon alone. */
  collapsed?: boolean;
  onSelect?: (choice: MachineChoice) => void;
}) {
  const host = useEmbeddedHostOptions().machines;
  // One owner per surface: the host's list when it supplies one, else the
  // box's account. The box read is skipped entirely under a host.
  const box = useBoxMachines(!host, onSelect);
  const source: MachineSource | null = host
    ? {
        entries: host.machines.map(hostEntry),
        activeId: host.activeId,
        select: (choice) => host.onSelect(choice.id),
      }
    : box;
  if (!source || source.entries.length === 0) return null;

  const { entries, activeId, select } = source;
  const current = entries.find((entry) => entry.choice.id === activeId) ?? entries[0]!;
  const CurrentIcon = current.row?.kind === "cloud" ? Cloud : Laptop;
  const currentName = current.choice.name;
  const currentOnline = !current.row || current.row.online;

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
        <StatusDot online={currentOnline} className="absolute bottom-1 right-1" />
      </button>
    ) : (
      <button
        type="button"
        aria-label={`Machine: ${currentName}. Change machine`}
        title={currentName}
        data-machine-switcher="rail"
        className={cn(
          "flex h-10 shrink-0 items-center rounded-lg text-left text-[13px] font-medium text-foreground transition-colors hover:bg-muted",
          collapsed ? "w-10 justify-center" : "w-full gap-2 px-2",
        )}
      >
        <span className="relative flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-foreground/[0.06]">
          <CurrentIcon className="size-4 text-foreground/70" />
          <StatusDot online={currentOnline} className="absolute -bottom-0.5 -right-0.5" />
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
            {entries.map(({ choice, row }) => {
              const selected = choice.id === activeId;
              const Icon = row?.kind === "cloud" ? Cloud : Laptop;
              return (
                <DropdownMenuItem
                  key={choice.id}
                  data-machine-option={choice.id}
                  aria-current={selected ? "true" : undefined}
                  onClick={() => {
                    if (!selected) select(choice);
                  }}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-2"
                >
                  <span className="relative flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-foreground/[0.06]">
                    <Icon className="size-4 text-foreground/70" />
                    <StatusDot online={!row || row.online} className="absolute -bottom-0.5 -right-0.5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{choice.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {row ? machineStatusLabel(row) : "The box that served this page"}
                    </span>
                  </span>
                  {selected ? <Check className="size-4 shrink-0 text-primary" /> : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function StatusDot({ online, className }: { online: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 rounded-full ring-2 ring-background",
        online ? "bg-success" : "bg-foreground/25",
        className,
      )}
    />
  );
}
