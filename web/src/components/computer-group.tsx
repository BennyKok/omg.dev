/**
 * One computer in the chat list: a line that names it and says how much is
 * running there, and its folders and chats under it while it is open
 * (lib/computer-groups.ts). Drawn only when the list holds chats from more
 * than one computer.
 */
import { useState, type ReactNode } from "react";
import { ChevronRight, Monitor } from "lucide-react";
import { readClosedComputers, writeClosedComputers } from "@/lib/computer-groups";
import { cn } from "@/lib/utils";

/**
 * The computers the reader closed, saved across reloads. The phone list and
 * the wide rail read the same key, so a computer closed in one stays closed
 * in the other after a reload.
 */
export function useClosedComputers(): [ReadonlySet<string>, (id: string) => void] {
  const [closed, setClosed] = useState(() => readClosedComputers(window.localStorage));
  const toggle = (id: string) =>
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeClosedComputers(window.localStorage, next);
      return next;
    });
  return [closed, toggle];
}

export function ComputerGroupSection({
  id,
  name,
  local,
  chats,
  working,
  open,
  onToggle,
  children,
}: {
  id: string;
  name: string;
  /** This computer, as opposed to a linked one. */
  local: boolean;
  chats: number;
  working: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const status = working ? `${working} working` : chats ? `${chats} chat${chats === 1 ? "" : "s"}` : "No chats";
  return (
    <section data-computer-group={id} aria-label={name} className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-left transition-colors hover:bg-muted/60 active:bg-muted/60"
      >
        <ChevronRight className={cn("size-4 shrink-0 text-muted-foreground transition-transform duration-150", open && "rotate-90")} />
        <Monitor className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{name}</span>
        {local ? null : (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Linked</span>
        )}
        <span className={cn("shrink-0 text-[12px] tabular-nums", working ? "font-medium text-primary" : "text-muted-foreground")}>
          {status}
        </span>
      </button>
      {/* The line above names the computer, so the name chip on each row
          under it is hidden. */}
      {open ? <div className="flex flex-col gap-2 [&_[data-session-peer]]:hidden">{children}</div> : null}
    </section>
  );
}
