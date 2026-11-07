/**
 * THE PHONE'S FOLDERS PAGE: the leftmost of the phone's flat pages.
 *
 * It replaced the Create, Apps and Chats pills, and then the side drawer.
 * Picking a row selects that folder: the list shows only its chats, the header
 * names it, and the next chat starts there. "All chats" leaves the folder. The
 * shell owns the value (the project filter); this only draws it and hands a
 * pick back.
 *
 * Only folders live here. Settings is the gear in the title row, because a
 * row under a long folder list is a row nobody scrolls to.
 */
import { useState, type ReactNode } from "react";
import { Folder, FolderPlus, MessagesSquare, Plus, Settings } from "lucide-react";
import { Github } from "./icons/github";
import { cn } from "@/lib/utils";
import { arrangeFolders, useFolderMenuPrefs, type ArrangedFolder } from "../lib/folder-menu-prefs";
import { NO_PROJECT_FILTER } from "../lib/project-filter";
import { ManageFolders } from "./project-folder-menu";

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
  return [...folders].sort((a, b) => (lastActivity?.get(b.value) ?? 0) - (lastActivity?.get(a.value) ?? 0) || byName(a, b));
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
  onOpenSettings,
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
  /** The gear beside the title. Settings is one tap from here, always. */
  onOpenSettings?: () => void;
  /** Beside the gear: the host's header slot, since this page has no header bar. */
  trailing?: ReactNode;
}) {
  const prefs = useFolderMenuPrefs();
  const [sort, setSortState] = useState<FolderSort>(readSort);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
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
    lastActivity,
  );
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
      <div className="flex items-center justify-between px-3">
        <h1 id="phone-folders-title" className="text-[22px] font-bold tracking-[-0.02em]">
          Folders
        </h1>
        <div className="flex items-center gap-1">
          {trailing}
          {canAdd ? (
            <IconButton label="Add a folder" pressed={adding} onClick={() => setAdding((open) => !open)}>
              <Plus className="size-5" />
            </IconButton>
          ) : null}
          {onOpenSettings ? (
            <IconButton label="Settings" onClick={onOpenSettings}>
              <Settings className="size-5" />
            </IconButton>
          ) : null}
        </div>
      </div>
      {adding ? (
        <div className="mx-1 mb-1 flex flex-col rounded-xl bg-muted/50 py-1">
          {onAddFolder ? <ActionRow icon={<FolderPlus className="size-4" />} label="Add a folder on this computer" onClick={onAddFolder} /> : null}
          {onNewFolder ? <ActionRow icon={<FolderPlus className="size-4" />} label="New empty folder" onClick={onNewFolder} /> : null}
          {onCloneGitHub ? <ActionRow icon={<Github className="size-4" />} label="Clone from GitHub" onClick={onCloneGitHub} /> : null}
        </div>
      ) : null}
      <div className="flex items-center justify-between px-2 pb-1">
        <div role="radiogroup" aria-label="Sort folders" className="flex rounded-full bg-muted p-0.5">
          {SORTS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={sort === option.id}
              onClick={() => setSort(option.id)}
              className={cn(
                "h-8 rounded-full px-3 text-[13px] font-medium transition-colors",
                sort === option.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="h-8 rounded-full px-3 text-[13px] font-medium text-primary"
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
      {folders.map((folder) => (
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
    </section>
  );
}

function IconButton({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      className={cn(
        "flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        pressed && "bg-muted text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function FolderRow({
  icon,
  label,
  detail,
  running,
  current,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  detail?: number;
  running?: number;
  current: boolean;
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
        current ? "bg-muted font-semibold text-foreground" : "text-foreground hover:bg-muted/60",
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
