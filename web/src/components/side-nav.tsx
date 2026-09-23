/**
 * The mobile side navigation, ported from the iOS drawer
 * (mobile/src/omg/side-nav.tsx).
 *
 * It replaces two things at once, the way it did on iOS: the bottom bar that
 * switched Chat / Bots / Schedules, and the overflow menu that held every
 * other page. Having both meant the answer to "where do I go" depended on
 * which of the two you happened to open.
 *
 * Deliberately not a pixel copy. iOS pushes the page sideways and rounds its
 * left corners; doing that on the web means a transform on the app shell, and
 * a transformed ancestor makes every `position: fixed` descendant resolve
 * against it instead of the viewport. The composer, the headers and the sheets
 * all depend on `fixed`, and the composer's keyboard tracking depends on it
 * most. So the panel slides over a dimmed page instead, keeping the iOS
 * timings and dim.
 */
import { type ReactNode } from "react";
import { Drawer as VaulDrawer } from "vaul";
import {
  Bell,
  Bot,
  CalendarClock,
  Flag,
  LayoutDashboard,
  MessageSquare,
  Monitor,
  Settings as SettingsIcon,
  SquareKanban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { SideNavIcon, SideNavRow } from "../lib/side-nav-items";

const GLYPH: Record<SideNavIcon, typeof Bell> = {
  chat: MessageSquare,
  bots: Bot,
  schedules: CalendarClock,
  notifications: Bell,
  artifacts: LayoutDashboard,
  computer: Monitor,
  board: SquareKanban,
  settings: SettingsIcon,
  extension: Flag,
};

/**
 * The hamburger, top left, where the machine chip used to be.
 *
 * It carries the machine's status dot, so the one thing the chip was there to
 * tell you at a glance survives the drawer being closed. Same reason iOS
 * duplicates the dot onto its button.
 */
export function SideNavButton({
  onOpen,
  machineName,
  online,
}: {
  onOpen: () => void;
  machineName: string;
  online: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="side-nav-button"
      aria-label={`Navigation. Computer: ${machineName}`}
      title="Navigation"
      className="relative flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {/* Two bars of different widths, as on iOS, rather than the usual three
          equal ones. The dot needs the bottom-right corner. */}
      <span className="flex flex-col items-start gap-[5px]" aria-hidden="true">
        <span className="block h-0.5 w-5 rounded-full bg-current" />
        <span className="block h-0.5 w-[13px] rounded-full bg-current" />
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "absolute bottom-1 right-1 size-[7px] rounded-full ring-2 ring-background",
          online ? "bg-emerald-500" : "bg-muted-foreground/40",
        )}
      />
    </button>
  );
}

export function SideNavDrawer({
  open,
  onOpenChange,
  rows,
  onNavigate,
  machineSwitcher,
  brand,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: SideNavRow[];
  onNavigate: (key: string) => void;
  /** The machine picker, drawn first. */
  machineSwitcher?: ReactNode;
  brand?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <VaulDrawer.Root
      open={open}
      onOpenChange={onOpenChange}
      direction="left"
      repositionInputs={false}
      shouldScaleBackground={false}
    >
      <VaulDrawer.Portal>
        {/* 28% black, the iOS value. */}
        <VaulDrawer.Overlay className="fixed inset-0 z-[179] bg-black/[0.28]" />
        <VaulDrawer.Content
          data-slot="side-nav"
          aria-describedby={undefined}
          // Same opt-out as the agent sheet: vaul's ::after inherits this
          // element's background and paints a slab past its edge.
          data-vaul-custom-container="true"
          className="fixed inset-y-0 left-0 z-[180] flex w-[min(20rem,72vw)] select-none flex-col border-r border-border bg-background text-foreground shadow-2xl outline-none"
        >
          <VaulDrawer.Title className="sr-only">Navigation</VaulDrawer.Title>
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-[max(var(--lfg-safe-bottom),1rem)] pt-[calc(0.75rem+env(safe-area-inset-top))]">
            {brand ? <div className="px-1 pb-4 pt-1">{brand}</div> : null}
            {/* The machine, first. It is the thing every other row is scoped
                to, so it reads as the heading for them. */}
            {machineSwitcher ? <div className="pb-3">{machineSwitcher}</div> : null}
            {rows.map((row) => {
              const Icon = GLYPH[row.icon];
              return (
                <button
                  key={row.key}
                  type="button"
                  data-testid={`side-nav-row-${row.key}`}
                  aria-current={row.current ? "page" : undefined}
                  onClick={() => {
                    // Tapping the row you are on just closes, as on iOS.
                    if (!row.current) onNavigate(row.key);
                    onOpenChange(false);
                  }}
                  className={cn(
                    "flex min-h-12 items-center gap-3 rounded-xl px-3 text-left text-[15px] transition-colors",
                    row.current
                      ? "bg-muted font-semibold text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <Icon className="size-[18px] shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                </button>
              );
            })}
            {footer ? <div className="mt-2 border-t border-border pt-2">{footer}</div> : null}
          </div>
        </VaulDrawer.Content>
      </VaulDrawer.Portal>
    </VaulDrawer.Root>
  );
}
