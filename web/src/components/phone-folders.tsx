/**
 * THE PHONE'S MENU PAGE: the leftmost of the phone's flat pages.
 *
 * It is the phone's one navigation. Two lists, in this order:
 *
 *   1. Pages: every page a phone can open, one row each (lib/side-nav-items.ts).
 *   2. Folders: picking a row selects that folder. The Chats list shows only
 *      its chats, the header names it, and the next chat starts there. "All
 *      chats" leaves the folder. The shell owns the value (the project
 *      filter); this only draws it and hands a pick back.
 *
 * The page used to carry four page tiles, an add button, a Settings gear,
 * three sort tabs and Edit above the folders, while the Chats header repeated
 * two of the tiles. The pages are plain rows now, Settings is one of them, the
 * sort is one control, and adding a folder is a row at the end of the list.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown, Folder, FolderPlus, MessagesSquare, Plus } from "lucide-react";
import { Github } from "./icons/github";
import { cn } from "@/lib/utils";
import { arrangeFolders, useFolderMenuPrefs, type ArrangedFolder } from "../lib/folder-menu-prefs";
import { NO_PROJECT_FILTER } from "../lib/project-filter";
import { byRecent, splitByActivity, useFolderActivity } from "../lib/folder-activity";
import { ManageFolders } from "./project-folder-menu";
import { SideNavRows } from "./side-nav";
import type { SideNavRow } from "../lib/side-nav-items";

/** How the list is ordered. "custom" is the order set in Edit (folder-menu-prefs). */
export type FolderSort = "recent" | "name" | "custom";

const SORT_KEY = "lfg_phone_folder_sort";
const SORTS: { id: FolderSort; label: string }[] = [
  { id: "recent", label: "Recent" },
  { id: "name", label: "A–Z" },
  { id: "custom", label: "Custom" },
];

function readSort(): FolderSort {
  try {
    const saved = window.localStorage.getItem(SORT_KEY);
    return saved === "name" || saved === "custom" ? saved : "recent";
  } catch {
    return "recent";
  }
}

/**
 * The folders in display order. Recent puts the folder with the newest chat
 * first and folders with no chats last, by name. Custom keeps the saved order.
 */
export function sortFolders(
  folders: readonly ArrangedFolder[],
  sort: FolderSort,
  labelFor: (value: string) => string,
  lastActivity?: ReadonlyMap<string, number>,
): ArrangedFolder[] {
  if (sort === "custom") return [...folders];
  const byName = (a: ArrangedFolder, b: ArrangedFolder) => labelFor(a.value).localeCompare(labelFor(b.value));
  if (sort === "name") return [...folders].sort(byName);
  return byRecent(folders, lastActivity ?? new Map(), labelFor);
}

export function PhoneFolders({
  value,
  projects,
  labelFor,
  counts,
  running,
  lastActivity,
  onPick,
  canRemove,
  onRemove,
  onAddFolder,
  onNewFolder,
  onCloneGitHub,
  pages,
  pagesUnread,
  onNavigate,
  trailing,
}: {
  /** The current project filter. "__all" is every chat. */
  value: string;
  /** Every folder value the shell knows, sentinels allowed. */
  projects: readonly string[];
  labelFor: (value: string) => string;
  /** Chats in each folder. */
  counts?: ReadonlyMap<string, number>;
  /** Chats with an agent at work, per folder. */
  running?: ReadonlyMap<string, number>;
  /** The newest chat activity per folder, for the Recent sort. */
  lastActivity?: ReadonlyMap<string, number>;
  onPick: (value: string) => void;
  /** Edit: which folders can leave this computer's list, and how. The files stay. */
  canRemove?: (project: string) => boolean;
  onRemove?: (project: string) => Promise<void>;
  onAddFolder?: () => void;
  onNewFolder?: () => void;
  onCloneGitHub?: () => void;
  /** The page rows, first on the page. Settings is the last of them. */
  pages?: readonly SideNavRow[];
  /** Page row keys that carry an unread dot. */
  pagesUnread?: ReadonlySet<string>;
  onNavigate?: (tab: string) => void;
  /** Beside the title: the host's header slot, since this page has no header bar. */
  trailing?: ReactNode;
}) {
  const prefs = useFolderMenuPrefs();
  const [sort, setSortState] = useState<FolderSort>(readSort);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const activity = useFolderActivity(lastActivity);
  const setSort = (next: FolderSort) => {
    setSortState(next);
    try {
      window.localStorage.setItem(SORT_KEY, next);
    } catch {
      // Private mode: the choice lasts until the page reloads.
    }
  };
  const arranged = arrangeFolders(
    projects.filter((project) => project !== NO_PROJECT_FILTER && project !== "__all"),
    prefs,
  );
  const folders = sortFolders(
    arranged.filter((folder) => !folder.hidden || folder.value === value),
    sort,
    labelFor,
    activity,
  );
  // Folders nobody has used for a while fold into one row at the bottom.
  const { active, inactive } = splitByActivity(folders, activity, { keep: value });
  const total = counts ? [...counts.values()].reduce((sum, n) => sum + n, 0) : 0;
  const canAdd = !!(onAddFolder || onNewFolder || onCloneGitHub);

  if (editing) {
    return (
      <section aria-label="Manage folders" className="flex flex-col px-1">
        <ManageFolders
          touch
          folders={arranged}
          labelFor={labelFor}
          canRemove={canRemove}
          onRemove={onRemove}
          onBack={() => setEditing(false)}
          onAddFolder={onAddFolder}
          onNewFolder={onNewFolder}
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="phone-folders-title" className="flex flex-col gap-1">
      <div className="flex min-h-10 items-center justify-between px-3">
        <h1 id="phone-folders-title" className="text-[22px] font-bold tracking-[-0.02em]">
          Menu
        </h1>
        {trailing ? <div className="flex items-center gap-1">{trailing}</div> : null}
      </div>
      {pages?.length && onNavigate ? (
        <nav aria-label="Pages" data-testid="phone-nav-pages" className="flex flex-col gap-0.5 pb-1">
          <SideNavRows
            // No row is marked: this page is none of them, and a marked row
            // does not navigate (SideNavRows closes on the current row).
            rows={pages.map((row) => ({ ...row, current: false }))}
            onNavigate={onNavigate}
            onClose={() => {}}
            unread={pagesUnread}
            haptic={false}
            plain
          />
        </nav>
      ) : null}
      <div className="mt-2 flex min-h-10 items-center gap-2 border-t border-border/60 px-3 pt-2">
        <h2 className="min-w-0 flex-1 text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          Folders
        </h2>
        <label className="relative flex h-8 shrink-0 items-center rounded-full bg-muted pl-3 pr-7 text-[13px] font-medium text-foreground">
          <span className="sr-only">Sort folders</span>
          <span aria-hidden="true">{SORTS.find((option) => option.id === sort)?.label}</span>
          <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2 size-3.5 text-muted-foreground" />
          <select
            aria-label="Sort folders"
            data-testid="phone-folders-sort"
            value={sort}
            onChange={(event) => setSort(event.target.value as FolderSort)}
            className="absolute inset-0 size-full cursor-pointer appearance-none opacity-0"
          >
            {SORTS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="h-8 shrink-0 rounded-full px-2 text-[13px] font-medium text-primary"
        >
          Edit
        </button>
      </div>
      <FolderRow
        icon={<MessagesSquare className="size-[18px]" />}
        label="All chats"
        detail={total || undefined}
        current={value === "__all"}
        onClick={() => onPick("__all")}
      />
      {active.map((folder) => (
        <FolderRow
          key={folder.value}
          icon={<Folder className="size-[18px]" />}
          label={labelFor(folder.value)}
          running={running?.get(folder.value)}
          detail={counts?.get(folder.value)}
          current={value === folder.value}
          onClick={() => onPick(folder.value)}
        />
      ))}
      {counts?.get(NO_PROJECT_FILTER) || value === NO_PROJECT_FILTER ? (
        <FolderRow
          icon={<span className="block size-[18px]" />}
          label={labelFor(NO_PROJECT_FILTER)}
          running={running?.get(NO_PROJECT_FILTER)}
          detail={counts?.get(NO_PROJECT_FILTER)}
          current={value === NO_PROJECT_FILTER}
          onClick={() => onPick(NO_PROJECT_FILTER)}
        />
      ) : null}
      {inactive.length ? (
        <>
          <button
            type="button"
            aria-expanded={showInactive}
            data-testid="phone-folders-inactive"
            onClick={() => setShowInactive((open) => !open)}
            className="mt-1 flex min-h-11 items-center gap-2 rounded-xl px-3 text-left text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted/60"
          >
            <span className="min-w-0 flex-1">Inactive · {inactive.length}</span>
            <ChevronDown className={cn("size-4 shrink-0 transition-transform", showInactive && "rotate-180")} />
          </button>
          {showInactive
            ? inactive.map((folder) => (
                <FolderRow
                  key={folder.value}
                  icon={<Folder className="size-[18px]" />}
                  label={labelFor(folder.value)}
                  running={running?.get(folder.value)}
                  detail={counts?.get(folder.value)}
                  current={value === folder.value}
                  muted
                  onClick={() => onPick(folder.value)}
                />
              ))
            : null}
        </>
      ) : null}
      {canAdd ? (
        <>
          <button
            type="button"
            aria-expanded={adding}
            aria-label="Add a folder"
            onClick={() => setAdding((open) => !open)}
            className="flex min-h-12 items-center gap-3 rounded-xl px-3 text-left text-[15px] text-primary transition-colors hover:bg-muted/60"
          >
            <Plus className="size-[18px] shrink-0" />
            <span className="min-w-0 flex-1 truncate">Add a folder</span>
            <ChevronDown className={cn("size-4 shrink-0 transition-transform", adding && "rotate-180")} />
          </button>
          {adding ? (
            <div className="mx-1 mb-1 flex flex-col rounded-xl bg-muted/50 py-1">
              {onAddFolder ? <ActionRow icon={<FolderPlus className="size-4" />} label="Add a folder on this computer" onClick={onAddFolder} /> : null}
              {onNewFolder ? <ActionRow icon={<FolderPlus className="size-4" />} label="New empty folder" onClick={onNewFolder} /> : null}
              {onCloneGitHub ? <ActionRow icon={<Github className="size-4" />} label="Clone from GitHub" onClick={onCloneGitHub} /> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function FolderRow({
  icon,
  label,
  detail,
  running,
  current,
  muted = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  detail?: number;
  running?: number;
  current: boolean;
  /** An inactive folder: drawn quieter so the active ones lead. */
  muted?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={current ? "true" : undefined}
      data-folder-row=""
      className={cn(
        "relative flex min-h-12 items-center gap-3 rounded-xl px-3 text-left text-[15px] transition-colors",
        current ? "bg-muted font-semibold text-foreground" : muted ? "text-muted-foreground hover:bg-muted/60" : "text-foreground hover:bg-muted/60",
      )}
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {running ? (
        <span className="shrink-0 rounded-full bg-primary/12 px-2 py-0.5 text-[11.5px] font-medium text-primary">
          {running} running
        </span>
      ) : detail ? (
        <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">{detail}</span>
      ) : null}
      {/* No HapticTap: this is a long scrolling list, and the switch it lays
          over a row caught the finger at the start of a scroll. */}
    </button>
  );
}

function ActionRow({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-left text-[14px] text-primary transition-colors hover:bg-muted/60"
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
