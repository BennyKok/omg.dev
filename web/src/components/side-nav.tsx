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
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
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

/** How far a release must have dragged the panel, as a share of its width, to close it. */
const SWIPE_CLOSE_SHARE = 0.35;
/** A flick this fast (px per ms, leftward) closes regardless of distance. */
const SWIPE_CLOSE_VELOCITY = 0.4;
/** Movement before a touch is read as a horizontal drag or a vertical scroll. */
const SWIPE_SLOP = 8;

/**
 * THE PHONE DRAWER.
 *
 * It is mounted before it is needed (when the browser is idle, or on the first
 * open) and then stays mounted, so opening it changes one attribute and CSS
 * slides the panel on the compositor. The curve starts fast, the way iOS does,
 * so the panel is visibly moving on the first frame after the tap.
 *
 * It used to be a react-aria Sheet. That mounted the whole panel on every tap,
 * then entered with a smooth scroll whose duration and easing belong to the
 * browser: a slow start of about 300 ms, after the mount work had finished.
 * The swipe-to-close the Sheet got from scrolling is a pointer gesture here,
 * and the panel follows the finger.
 */
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
  const [mounted, setMounted] = useState(open);
  if (open && !mounted) setMounted(true);
  // Mount ahead of the first tap, while nothing else is happening.
  useEffect(() => {
    if (mounted) return;
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
      .requestIdleCallback;
    const cancelIdle = (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
    if (idle) {
      const id = idle(() => setMounted(true), { timeout: 3000 });
      return () => cancelIdle?.(id);
    }
    const id = window.setTimeout(() => setMounted(true), 1500);
    return () => window.clearTimeout(id);
  }, [mounted]);
  if (!mounted || typeof document === "undefined") return null;
  return createPortal(
    <SideNavDrawerSurface
      open={open}
      onOpenChange={onOpenChange}
      rows={rows}
      onNavigate={onNavigate}
      machineSwitcher={machineSwitcher}
      brand={brand}
      footer={footer}
    />,
    document.body,
  );
}

function SideNavDrawerSurface({
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
  machineSwitcher?: ReactNode;
  brand?: ReactNode;
  footer?: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;
  const close = useCallback(() => onOpenChangeRef.current(false), []);

  // A surface that mounts already open would paint open with no slide. Lay it
  // out closed once, then arm it, so even the cold first open animates.
  const [armed, setArmed] = useState(false);
  useLayoutEffect(() => {
    rootRef.current?.getBoundingClientRect();
    setArmed(true);
  }, []);
  const shown = open && armed;

  // The machine list is read when its switcher mounts. Remount it after each
  // close, off screen, so the next open shows fresh machines without paying
  // for that read during the tap.
  const [machineGeneration, setMachineGeneration] = useState(0);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) {
      const id = window.setTimeout(() => setMachineGeneration((n) => n + 1), 400);
      wasOpen.current = open;
      return () => window.clearTimeout(id);
    }
    wasOpen.current = open;
  }, [open]);

  // Hidden from focus and assistive tech while closed; focus moves in on open
  // and returns to whatever had it on close.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.inert = !open;
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    (panel?.querySelector<HTMLElement>('[aria-current="page"]') ?? panel)?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previous?.isConnected && panel?.contains(document.activeElement)) previous.focus({ preventScroll: true });
    };
  }, [open, close]);

  // Keep Tab inside the panel while it is open.
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = [...panel.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])',
    )];
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // Swipe left to close. The panel follows the finger with no transition and
  // no React render; release either closes or springs back.
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    t: number;
    dx: number;
    mode: "pending" | "drag" | "scroll";
    width: number;
  } | null>(null);
  const suppressClick = useRef(false);
  const endDrag = (commit: boolean) => {
    const state = drag.current;
    drag.current = null;
    const root = rootRef.current;
    const panel = panelRef.current;
    const backdrop = backdropRef.current;
    if (!state || state.mode !== "drag" || !root || !panel || !backdrop) return;
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    // Re-enable the transition and drop the inline position in one style
    // change, so the panel animates from where the finger left it.
    root.removeAttribute("data-dragging");
    panel.style.transform = "";
    backdrop.style.opacity = "";
    if (!commit) return;
    const elapsed = Math.max(1, performance.now() - state.t);
    if (-state.dx > state.width * SWIPE_CLOSE_SHARE || state.dx / elapsed < -SWIPE_CLOSE_VELOCITY) close();
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!open || !event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      t: performance.now(),
      dx: 0,
      mode: "pending",
      width: panelRef.current?.offsetWidth || 1,
    };
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId || state.mode === "scroll") return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (state.mode === "pending") {
      if (Math.abs(dx) < SWIPE_SLOP && Math.abs(dy) < SWIPE_SLOP) return;
      if (Math.abs(dy) >= Math.abs(dx) || dx > 0) {
        state.mode = "scroll";
        return;
      }
      state.mode = "drag";
      // Measure velocity from the start of the drag, not from the touch.
      state.t = performance.now();
      state.x = event.clientX;
      rootRef.current?.setAttribute("data-dragging", "true");
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // A synthetic or already-released pointer cannot be captured.
      }
      return;
    }
    const offset = Math.min(0, event.clientX - state.x);
    state.dx = offset;
    if (panelRef.current) panelRef.current.style.transform = `translate3d(${offset}px,0,0)`;
    if (backdropRef.current) backdropRef.current.style.opacity = String(Math.max(0, 1 + offset / state.width));
  };

  return (
    <div
      ref={rootRef}
      className="lfg-side-nav fixed inset-0 z-[180]"
      data-open={shown ? "true" : "false"}
      aria-hidden={!open}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => endDrag(true)}
      onPointerCancel={() => endDrag(false)}
      onClickCapture={(event) => {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div
        ref={backdropRef}
        data-slot="drawer-overlay"
        aria-hidden="true"
        className="lfg-side-nav-backdrop absolute inset-0 z-[179] bg-black/[0.28]"
        onClick={close}
      />
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-slot="side-nav"
        onKeyDown={onKeyDown}
        className="lfg-side-nav-panel absolute inset-y-0 left-0 z-[180] flex h-[100dvh] w-[min(20rem,72vw)] select-none flex-col border-r border-border bg-background text-foreground shadow-2xl outline-none"
      >
        <h2 id={titleId} className="sr-only">Navigation</h2>
        <div className="flex min-h-0 flex-1 touch-pan-y flex-col gap-1 overflow-y-auto overscroll-contain px-3 pb-[max(var(--lfg-safe-bottom),1rem)] pt-[calc(0.75rem+env(safe-area-inset-top))]">
          {brand ? <div className="px-1 pb-4 pt-1">{brand}</div> : null}
          {/* The machine, first. It is the thing every other row is scoped
              to, so it reads as the heading for them. */}
          {machineSwitcher ? <div key={machineGeneration} className="pb-3">{machineSwitcher}</div> : null}
          <SideNavRows rows={rows} onNavigate={onNavigate} onClose={close} />
          {footer ? <div className="mt-2 border-t border-border pt-2">{footer}</div> : null}
        </div>
      </section>
    </div>
  );
}

/**
 * The rows themselves, shared by the phone drawer and the desktop rail panel,
 * so the two cannot list different places or mark the current one
 * differently.
 */
function SideNavRows({
  onSelect,
  rows,
  onNavigate,
  onClose,
  unread,
  dense = false,
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
