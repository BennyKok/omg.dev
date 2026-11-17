import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Folder, History, Plus, Search, X } from "lucide-react";
import { cn } from "../lib/utils";
import { NO_PROJECT_FILTER } from "../lib/project-filter";
import { byRecent, useFolderActivity } from "../lib/folder-activity";
import { useProjectFavicon } from "../lib/session-ui";
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
        "relative z-[55] mt-auto shrink-0 bg-gradient-to-t from-background from-[calc(100%-1rem)] to-transparent px-4 pt-4 pb-[max(var(--lfg-device-safe-bottom),0.75rem)]",
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
      {/* A tonal surface, not solid white: a full-width white bar was the
          brightest thing on a dark screen (owner, 2026-11-17). Only the top
          1rem of the bar fades, so the updates pill's band can cover it and
          no list row shows through between the two. */}
      <button
        type="button"
        onClick={() => {
          keyboardRef.current?.focus({ preventScroll: true });
          onOpen();
        }}
        className="mx-auto flex h-12 w-full max-w-lg items-center justify-center gap-2 rounded-full border border-border bg-secondary text-[15px] font-semibold text-secondary-foreground shadow-[0_8px_24px_rgba(0,0,0,0.18)] transition-[transform,background-color] active:scale-[0.98] active:bg-accent"
      >
        <Plus className="size-5" strokeWidth={2.5} />
        New session
      </button>
    </div>
  );
}

/** How many folders show before "More". One or two rows on a phone. */
const FOLDER_CHIPS = 6;

/** The folder's favicon, else a plain folder mark. */
function FolderMark({ project }: { project: string }) {
  const { src, onLoad, onError } = useProjectFavicon(project);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        loading="lazy"
        className="size-3.5 shrink-0 rounded-[3px] object-contain"
        onLoad={onLoad}
        onError={onError}
      />
    );
  }
  return <Folder className="size-3.5 shrink-0 opacity-60" />;
}

/**
 * Where the next chat starts, as a few chips: "No project" and the first
 * folders in the folder menu's order (the order set in Manage folders, else
 * the most recently used first). The current folder always has a chip.
 * "More" opens a search over the rest.
 */
function FolderChips({
  projects,
  value,
  labelFor,
  onChange,
  onAddFolder,
}: {
  projects: readonly string[];
  value: string;
  labelFor: (value: string) => string;
  onChange: (value: string) => void;
  onAddFolder?: () => void;
}) {
  const activity = useFolderActivity();
  const prefs = useFolderMenuPrefs();
  const [more, setMore] = useState(false);
  const [query, setQuery] = useState("");
  const ordered = useMemo(() => {
    const folders = projects.filter((project) => project !== NO_PROJECT_FILTER && project !== "__all");
    const visible = arrangeFolders(folders, prefs).filter((folder) => !folder.hidden || folder.value === value);
    const shown = prefs.order.length ? visible : byRecent(visible, activity, labelFor);
    return shown.map((folder) => folder.value);
  }, [projects, prefs, activity, labelFor, value]);
  const first = ordered.slice(0, FOLDER_CHIPS);
  // The current folder keeps a chip even when it is not among the first.
  if (value !== NO_PROJECT_FILTER && ordered.includes(value) && !first.includes(value)) {
    first[first.length - 1] = value;
  }
  const rest = ordered.filter((folder) => !first.includes(folder));
  const needle = query.trim().toLowerCase();
  const matches = needle ? rest.filter((folder) => labelFor(folder).toLowerCase().includes(needle)) : rest;

  const chip = (folder: string) => {
    const selected = folder === value;
    return (
      <button
        key={folder}
        type="button"
        role="radio"
        aria-checked={selected}
        // Keep the field focused, so the keyboard stays up while a folder
        // is picked.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          onChange(folder);
          setMore(false);
          setQuery("");
        }}
        className={cn(
          "inline-flex h-8 max-w-[11rem] shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors",
          selected ? "bg-foreground text-background" : "bg-muted text-foreground hover:bg-muted/70",
        )}
      >
        {folder === NO_PROJECT_FILTER ? null : <FolderMark project={folder} />}
        <span className="min-w-0 truncate">{labelFor(folder)}</span>
      </button>
    );
  };
  const quiet =
    "inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-3 text-[13px] font-medium text-muted-foreground hover:bg-muted";

  return (
    <div className="flex flex-col gap-2">
      <div role="radiogroup" aria-label="Folder" className="flex flex-wrap gap-1.5">
        {projects.includes(NO_PROJECT_FILTER) ? chip(NO_PROJECT_FILTER) : null}
        {first.map(chip)}
        {rest.length || onAddFolder ? (
          <button
            type="button"
            aria-expanded={more}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setMore((open) => !open);
              setQuery("");
            }}
            className={quiet}
          >
            {more ? "Less" : rest.length ? `More (${rest.length})` : "More"}
            <ChevronDown className={cn("size-3.5 transition-transform", more && "rotate-180")} />
          </button>
        ) : null}
      </div>
      {more ? (
        <div className="flex flex-col gap-2">
          {rest.length > FOLDER_CHIPS ? (
            <label className="flex h-9 items-center gap-2 rounded-full bg-muted px-3 text-[14px] text-muted-foreground">
              <Search className="size-4 shrink-0" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search folders"
                aria-label="Search folders"
                className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
                style={{ fontSize: 16 }}
              />
            </label>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {matches.map(chip)}
            {needle && !matches.length ? (
              <span className="px-1 py-1.5 text-[13px] text-muted-foreground">No folder matches.</span>
            ) : null}
            {onAddFolder ? (
              <button type="button" onClick={onAddFolder} className={quiet}>
                <Plus className="size-3.5" />
                Add a folder
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Phone: the new-session composer as its own full screen. The header closes
 * it and opens history; the flat composer sits right under it; a few folder
 * chips follow. The shell is pinned to the visual viewport the same
 * way a mobile chat is.
 */
export function MobileNewSessionScreen({
  projects,
  folder,
  labelFor,
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
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3 pt-3">
          <FolderChips
            projects={projects}
            value={folder}
            labelFor={labelFor}
            onChange={onFolder}
            onAddFolder={onAddFolder}
          />
        </div>
      </section>
    </div>,
    document.body,
  );
}
