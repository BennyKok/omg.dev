/**
 * The navigation pieces: the phone's menu button, the page rows (drawn on the
 * phone's Folders page and in the desktop rail menu) and the rail panel. The
 * phone's slide-over drawer is gone; its contents are a flat page now.
 *
 * The rows replace two things at once, the way they did on iOS: the bottom
 * bar that switched Chat / Bots / Schedules, and the overflow menu that held
 * every other page. Having both meant the answer to "where do I go" depended
 * on which of the two you happened to open.
 */
import { type ReactNode, useEffect, useRef } from "react";
import {
  Bell,
  Bot,
  CalendarClock,
  ChevronLeft,
  Flag,
  LayoutDashboard,
  MessageSquare,
  Monitor,
  Settings as SettingsIcon,
  SquareKanban,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HapticTap } from "./haptic-tap";
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
      <HapticTap />
    </button>
  );
}

/**
 * An empty node a host can portal its own drawer rows into, such as an Upgrade
 * row. It sits in the drawer footer, above our Settings row.
 *
 * The drawer mounts when the browser is first idle, or on the first open, so
 * a host cannot count on this node existing before then. The mobile
 * `header-actions` slots therefore carry `data-lfg-host-drawer="footer"`,
 * which tells the host that this slot will be there when the drawer opens.
 *
 * A tap on anything the host puts here closes the drawer, the same as a tap on
 * one of our rows. The listener is native because the host renders into this
 * node from its own React root, so our React tree never sees that click.
 * Without it, a dialog the host opens would sit under the drawer (z-180).
 */
export function HostDrawerSlot({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.addEventListener("click", onClose);
    return () => node.removeEventListener("click", onClose);
  }, [onClose]);
  return <div ref={ref} data-lfg-host-slot="drawer-footer" className="flex flex-col" />;
}


/**
 * The rows themselves, shared by the phone drawer and the desktop rail panel,
 * so the two cannot list different places or mark the current one
 * differently.
 */
export function SideNavRows({
  onSelect,
  rows,
  onNavigate,
  onClose,
  unread,
  dense = false,
  haptic = true,
}: {
  rows: SideNavRow[];
  onNavigate: (key: string) => void;
  onClose: () => void;
  /** A selection can dismiss a host page even when this row is current. */
  onSelect?: () => void;
  /** Row keys that carry an unread dot. */
  unread?: ReadonlySet<string>;
  /** Pointer-sized rows for the desktop rail. */
  dense?: boolean;
  /**
   * The iPhone tap switch (HapticTap). Off in a long scrolling page such as
   * the phone's Folders page, where a switch under the finger caught scrolls.
   */
  haptic?: boolean;
}) {
  return (
    <>
      {rows.map((row) => {
        const Icon = GLYPH[row.icon];
        return (
          <button
            key={row.key}
            type="button"
            data-testid={`side-nav-row-${row.key}`}
            aria-current={row.current ? "page" : undefined}
            onClick={() => {
              onSelect?.();
              // Tapping the row you are on just closes, as on iOS.
              if (!row.current) onNavigate(row.key);
              onClose();
            }}
            className={cn(
              "relative flex items-center gap-3 rounded-xl px-3 text-left transition-colors",
              dense ? "min-h-10 text-[14px]" : "min-h-12 text-[15px]",
              row.current
                ? "bg-muted font-semibold text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <Icon className={cn("shrink-0", dense ? "size-4" : "size-[18px]")} />
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            {unread?.has(row.key) ? (
              <span role="status" aria-label={`${row.label} has unread`} className="size-2 shrink-0 rounded-full bg-primary" />
            ) : null}
            {haptic ? <HapticTap /> : null}
          </button>
        );
      })}
    </>
  );
}

/** Two bars of different widths, the iOS menu glyph. */
export function SideNavGlyph() {
  return (
    <span className="flex flex-col items-start gap-[4px]" aria-hidden="true">
      <span className="block h-0.5 w-[18px] rounded-full bg-current" />
      <span className="block h-0.5 w-3 rounded-full bg-current" />
    </span>
  );
}

/**
 * THE DESKTOP RAIL'S MENU. The same places as the phone drawer, drawn over
 * the rail's list inside the rail itself, with Back to return to the list.
 *
 * It replaces the Chat / Bots / Schedules switch and the three-dot pages
 * menu, which were two ways to answer one question. The stage beside the rail
 * does not move: the menu changes what the rail lists, never what is open.
 *
 * Mounted at all times and slid off to the left when closed, so opening it is
 * a transform and not a mount. `inert` keeps the hidden rows out of the tab
 * order and away from screen readers.
 */
export function SideNavPanel({
  onSelect,
  open,
  onBack,
  rows,
  onNavigate,
  unread,
  trailing,
  footer,
  machineSwitcher,
}: {
  open: boolean;
  onBack: () => void;
  rows: SideNavRow[];
  onNavigate: (key: string) => void;
  onSelect?: () => void;
  unread?: ReadonlySet<string>;
  /** The machine picker, drawn first, as in the phone drawer. */
  machineSwitcher?: ReactNode;
  /** Right side of the header. The rail puts its collapse control here. */
  trailing?: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.inert = !open;
    if (open) node.querySelector<HTMLElement>('[aria-current="page"]')?.focus({ preventScroll: true });
  }, [open]);
  return (
    <div
      ref={ref}
      data-testid="side-nav-panel"
      role="navigation"
      aria-label="Navigation"
      aria-hidden={!open}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onBack();
        }
      }}
      className={cn(
        // The rail's own surface (--shell-surface on the desktop workspace),
        // so the menu covers the list without a lighter slab of its own.
        "absolute inset-0 z-30 flex flex-col bg-[var(--shell-surface,var(--background))] transition-[translate,opacity] duration-150 ease-out motion-reduce:transition-none",
        open ? "translate-x-0 opacity-100" : "pointer-events-none -translate-x-full opacity-0",
      )}
    >
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2">
        <button
          type="button"
          onClick={onBack}
          data-testid="side-nav-back"
          className="flex h-8 items-center gap-1 rounded-lg pl-1 pr-2.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Back
        </button>
        {trailing ? <div className="ml-auto flex items-center">{trailing}</div> : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2">
        {machineSwitcher ? <div className="pb-2">{machineSwitcher}</div> : null}
        <SideNavRows onSelect={onSelect} rows={rows} onNavigate={onNavigate} onClose={onBack} unread={unread} dense />
        {footer ? <div className="mt-2 border-t border-border pt-2">{footer}</div> : null}
      </div>
    </div>
  );
}
