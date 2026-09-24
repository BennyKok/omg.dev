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
import { type ReactNode, useEffect, useRef } from "react";
import { Drawer as VaulDrawer } from "vaul";
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

/**
 * An empty node a host can portal its own drawer rows into, such as an Upgrade
 * row. It sits in the drawer footer, above our Settings row.
 *
 * The drawer only mounts while it is open, so a host cannot find this node
 * while it is closed. The mobile `header-actions` slots therefore carry
 * `data-lfg-host-drawer="footer"`, which tells the host that this slot will be
 * there when the drawer opens.
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
            <SideNavRows rows={rows} onNavigate={onNavigate} onClose={() => onOpenChange(false)} />
            {footer ? <div className="mt-2 border-t border-border pt-2">{footer}</div> : null}
          </div>
        </VaulDrawer.Content>
      </VaulDrawer.Portal>
    </VaulDrawer.Root>
  );
}

/**
 * The rows themselves, shared by the phone drawer and the desktop rail panel,
 * so the two cannot list different places or mark the current one
 * differently.
 */
function SideNavRows({
  rows,
  onNavigate,
  onClose,
  unread,
  dense = false,
}: {
  rows: SideNavRow[];
  onNavigate: (key: string) => void;
  onClose: () => void;
  /** Row keys that carry an unread dot. */
  unread?: ReadonlySet<string>;
  /** Pointer-sized rows for the desktop rail. */
  dense?: boolean;
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
              // Tapping the row you are on just closes, as on iOS.
              if (!row.current) onNavigate(row.key);
              onClose();
            }}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 text-left transition-colors",
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
        "absolute inset-0 z-30 flex flex-col bg-background transition-transform duration-200 ease-ios motion-reduce:transition-none",
        open ? "translate-x-0" : "pointer-events-none -translate-x-full",
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
        <SideNavRows rows={rows} onNavigate={onNavigate} onClose={onBack} unread={unread} dense />
        {footer ? <div className="mt-2 border-t border-border pt-2">{footer}</div> : null}
      </div>
    </div>
  );
}
