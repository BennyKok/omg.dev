import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Folder, History, Plus, X } from "lucide-react";
import { cn } from "../lib/utils";
import { NO_PROJECT_FILTER } from "../lib/project-filter";
import { byRecent, splitByActivity, useFolderActivity } from "../lib/folder-activity";
import { arrangeFolders, useFolderMenuPrefs } from "../lib/folder-menu-prefs";

/**
 * Phone home: the bottom of the list is one "New session" button, not a live
 * composer. A composer at rest on the list resized with every keystroke, moved
 * with the keyboard, and had to be kept alive but inert under every open chat.
 * The button has a fixed height, so the list above it never shifts.
 *
 * The button publishes its height as `--lfg-inline-composer-height`, the
 * clearance the list padding and the floating pills already read.
 */
export function MobileNewSessionButton({ onOpen, hidden = false }: { onOpen: () => void; hidden?: boolean }) {
  const barRef = useRef<HTMLDivElement>(null);
  // iOS raises the keyboard only for a focus inside the tap itself. The real
  // field mounts a frame later, so the tap focuses this stand-in first and
  // the field takes the focus over; WebKit keeps the keyboard up across it.
  const keyboardRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const root = document.documentElement;
    const sync = () => {
      root.style.setProperty("--lfg-inline-composer-height", `${Math.ceil(bar.getBoundingClientRect().height)}px`);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(bar);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--lfg-inline-composer-height");
    };
  }, []);
  return (
    <div
      ref={barRef}
      inert={hidden}
      aria-hidden={hidden}
      className={cn(
        "relative z-[55] mt-auto shrink-0 bg-gradient-to-t from-background from-60% to-transparent px-4 pt-4 pb-[max(var(--lfg-device-safe-bottom),0.75rem)]",
        hidden && "invisible pointer-events-none",
      )}
    >
      <input
        ref={keyboardRef}
        aria-hidden
        tabIndex={-1}
        readOnly
        className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-0"
        style={{ fontSize: 16 }}
      />
      <button
        type="button"
        onClick={() => {
          keyboardRef.current?.focus({ preventScroll: true });
          onOpen();
        }}
        className="mx-auto flex h-12 w-full max-w-lg items-center justify-center gap-2 rounded-full bg-foreground text-[15px] font-semibold text-background shadow-[0_8px_24px_rgba(0,0,0,0.18)] transition-transform active:scale-[0.98]"
      >
        <Plus className="size-5" strokeWidth={2.5} />
        New session
      </button>
    </div>
  );
}

/**
 * The folders a phone chat can start in, in the folder menu's order: the
 * order set in Manage folders, else the most recently used first. Hidden
 * folders stay out, and folders idle for a while fold into one row.
 */
function FolderList({
  projects,
  value,
  labelFor,
  counts,
  onChange,
  onAddFolder,
}: {
  projects: readonly string[];
  value: string;
  labelFor: (value: string) => string;
  counts?: ReadonlyMap<string, number>;
  onChange: (value: string) => void;
  onAddFolder?: () => void;
}) {
  const activity = useFolderActivity();
  const prefs = useFolderMenuPrefs();
  const [showInactive, setShowInactive] = useState(false);
  const { active, inactive } = useMemo(() => {
    const folders = projects.filter((project) => project !== NO_PROJECT_FILTER && project !== "__all");
    const visible = arrangeFolders(folders, prefs).filter((folder) => !folder.hidden || folder.value === value);
    const shown = prefs.order.length ? visible : byRecent(visible, activity, labelFor);
    return splitByActivity(shown, activity, { keep: value });
  }, [projects, prefs, activity, labelFor, value]);
  const row = (folder: string, icon: boolean) => {
    const selected = folder === value;
    const count = counts?.get(folder);
    return (
      <button
        key={folder}
        type="button"
        role="radio"
        aria-checked={selected}
        // Keep the field focused, so the keyboard stays up while a folder
        // is picked.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onChange(folder)}
        className={cn(
          "flex h-11 w-full shrink-0 items-center gap-3 rounded-xl px-3 text-left text-[15px]",
          selected ? "bg-muted font-medium" : "hover:bg-muted/60",
        )}
      >
        {icon ? <Folder className="size-4 shrink-0 text-muted-foreground" /> : <span className="size-4 shrink-0" />}
        <span className="min-w-0 flex-1 truncate">{labelFor(folder)}</span>
        {count ? <span className="text-xs tabular-nums text-muted-foreground">{count}</span> : null}
        <Check className={cn("size-4 shrink-0", selected ? "opacity-100" : "opacity-0")} />
      </button>
    );
  };
  return (
    <div role="radiogroup" aria-label="Folder" className="flex flex-col gap-0.5">
      {projects.includes(NO_PROJECT_FILTER) ? row(NO_PROJECT_FILTER, false) : null}
      {active.map((folder) => row(folder.value, true))}
      {inactive.length && !showInactive ? (
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setShowInactive(true)}
          className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] text-muted-foreground hover:bg-muted/60"
        >
          <ChevronDown className="size-4" />
          {inactive.length} more
        </button>
      ) : null}
      {showInactive ? inactive.map((folder) => row(folder.value, true)) : null}
      {onAddFolder ? (
        <button
          type="button"
          onClick={onAddFolder}
          className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-[15px] text-muted-foreground hover:bg-muted/60"
        >
          <Plus className="size-4" />
          Add a folder
        </button>
      ) : null}
    </div>
  );
}

/**
 * Phone: the new-session composer as its own full screen. The header closes
 * it and opens history; the flat composer sits right under it; the folder
 * list fills the rest. The shell is pinned to the visual viewport the same
 * way a mobile chat is.
 */
export function MobileNewSessionScreen({
  projects,
  folder,
  labelFor,
  counts,
  onFolder,
  onClose,
  onHistory,
  onAddFolder,
  busy = false,
  children,
}: {
  /** Folder values, with NO_PROJECT_FILTER first when a chat can have none. */
  projects: readonly string[];
  folder: string;
  labelFor: (value: string) => string;
  counts?: ReadonlyMap<string, number>;
  onFolder: (value: string) => void;
  onClose: () => void;
  onHistory?: () => void;
  onAddFolder?: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  return createPortal(
    <div
      className="fixed inset-x-0 z-[95]"
      style={{
        top: "var(--lfg-visual-offset-top, 0px)",
        height: "var(--lfg-visual-height, var(--lfg-app-height, 100dvh))",
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label="New session"
        aria-busy={busy}
        data-testid="mobile-new-session"
        className="absolute inset-0 flex flex-col overflow-hidden bg-background text-foreground animate-in fade-in-0 slide-in-from-bottom-4 duration-200 motion-reduce:animate-none"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.defaultPrevented) {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <header
          className="flex shrink-0 items-center gap-1 px-2 pb-2"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-11 items-center justify-center rounded-full text-foreground hover:bg-muted"
          >
            <X className="size-5" />
          </button>
          <h2 className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold">New session</h2>
          {onHistory ? (
            <button
              type="button"
              onClick={onHistory}
              aria-label="Resume a session"
              className="flex size-11 items-center justify-center rounded-full text-foreground hover:bg-muted"
            >
              <History className="size-5" />
            </button>
          ) : (
            <span className="size-11" aria-hidden />
          )}
        </header>
        {/* The composer sits at the top, flat under the header, where the
            eye lands first; the folder list follows below it. */}
        <div data-suggest-below="" className="relative z-10 mx-auto w-full max-w-lg shrink-0 border-b border-border/60">{children}</div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3 pt-2">
          <p className="px-1 pb-1.5 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Start in</p>
          <FolderList
            projects={projects}
            value={folder}
            labelFor={labelFor}
            counts={counts}
            onChange={onFolder}
            onAddFolder={onAddFolder}
          />
        </div>
      </section>
    </div>,
    document.body,
  );
}
