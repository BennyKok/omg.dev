import { Cloud, Laptop } from "lucide-react";

import {
  LOCAL_MACHINE_CHOICE,
  machineStatusLabel,
  rowMachineChoice,
  useCloudMachines,
} from "../lib/cloud-machines";
import { activeMachine, selectMachine, type MachineChoice } from "../lib/machines";
import { cn } from "../lib/utils";

/**
 * The outer rail on desktop: one button per machine, Slack style, left of the
 * session rail. Everything to its right belongs to the selected machine.
 *
 * Renders nothing until the box is signed in to omg Cloud and the account has
 * at least one machine the box can reach, so a self-hosted install with no
 * account sees exactly the layout it had before.
 */
export function MachineRail({
  onSelect = selectMachine,
}: {
  onSelect?: (choice: MachineChoice) => void;
}) {
  const { status, computers } = useCloudMachines();
  const active = activeMachine();
  const reachable = (computers ?? []).flatMap((row) => {
    const choice = rowMachineChoice(row);
    return choice ? [{ choice, row }] : [];
  });
  if (!status?.signedIn || reachable.length === 0) return null;

  const items = [
    { choice: LOCAL_MACHINE_CHOICE, row: null as null | (typeof reachable)[number]["row"] },
    ...reachable,
  ];

  return (
    <nav
      aria-label="Machines"
      data-machine-rail=""
      className="flex h-full w-14 shrink-0 flex-col items-center gap-1.5 border-r border-border bg-muted/30 py-2"
    >
      {items.map(({ choice, row }) => {
        const selected = choice.id === active.id;
        const online = !row || row.online;
        const title = row ? `${row.name} · ${machineStatusLabel(row)}` : "This computer";
        return (
          <button
            key={choice.id}
            type="button"
            title={title}
            aria-label={title}
            aria-current={selected ? "true" : undefined}
            onClick={() => {
              if (!selected) onSelect(choice);
            }}
            className={cn(
              "relative flex size-10 items-center justify-center rounded-xl transition-colors",
              selected
                ? "bg-primary text-white"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {row?.kind === "cloud" ? <Cloud className="size-5" /> : <Laptop className="size-5" />}
            <span
              aria-hidden
              className={cn(
                "absolute bottom-1 right-1 size-2 rounded-full ring-2 ring-background",
                online ? "bg-success" : "bg-foreground/25",
              )}
            />
          </button>
        );
      })}
    </nav>
  );
}
