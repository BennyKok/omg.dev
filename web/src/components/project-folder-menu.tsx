/**
 * THE DESKTOP FOLDER MENU.
 *
 * The desktop rail used to scope its list with a row of folder pills, and
 * send you to a bottom sheet to manage the folders. Pills that scroll
 * sideways do not scale past a handful of folders on a narrow rail, and a
 * bottom sheet is a phone shape. This is one dropdown in the model picker's
 * shape: pick a folder, or turn the popover to "Manage" and arrange them.
 *
 * Manage is the web copy of the iOS folder rail sheet
 * (mobile/src/omg/folder-rail-sheet.tsx): drag to reorder, hide or show a
 * folder in the menu, and add or create one. It also offers what iOS keeps
 * in the project sheet: remove the folder from this machine's list. The
 * files stay on disk.
 *
 * The menu owns no selection state. The shell passes the value in and gets
 * the chosen value back, the same contract the pill rail had.
 */
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  Eye,
  EyeOff,
  Folder,
  FolderMinus,
  FolderPlus,
  GripVertical,
  Loader2,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { NO_PROJECT_FILTER } from "../lib/project-filter";
import {
  arrangeFolders,
  setFolderMenuHidden,
  setFolderMenuOrder,
  useFolderMenuPrefs,
} from "../lib/folder-menu-prefs";

export type ProjectFolderMenuProps = {
  /** The current filter value. */
  value: string;
  /** Every selectable value, as the shell lists them. May lead with NO_PROJECT_FILTER. */
  projects: readonly string[];
  /** The display name for one value, sentinels included. */
  labelFor: (value: string) => string;
  onChange: (value: string) => void;
  /** Which folders can leave the machine's list. Session-only folders cannot. */
  canRemove?: (project: string) => boolean;
  /** Take a folder off the machine's list. The folder stays on disk. */
  onRemove?: (project: string) => Promise<void>;
  onAddFolder?: () => void;
  onNewFolder?: () => void;
};

const ROW = "flex h-9 w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px] outline-none transition-colors";

export function ProjectFolderMenu({
  value,
  projects,
  labelFor,
  onChange,
  canRemove,
  onRemove,
  onAddFolder,
  onNewFolder,
}: ProjectFolderMenuProps) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<"pick" | "manage">("pick");
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const prefs = useFolderMenuPrefs();

  useEffect(() => {
    if (open) return;
    setPage("pick");
    setQuery("");
  }, [open]);

  const hasNoProject = projects.includes(NO_PROJECT_FILTER);
  const folders = useMemo(
    () => projects.filter((project) => project !== NO_PROJECT_FILTER && project !== "__all"),
    [projects],
  );
  const arranged = useMemo(() => arrangeFolders(folders, prefs), [folders, prefs]);
  // The current folder stays in the list even when hidden, so the tick
  // always has a row to sit on.
  const shown = arranged.filter((folder) => !folder.hidden || folder.value === value);
  const needle = query.trim().toLowerCase();
  const searchable = shown.length > 8;
  const matching = needle
    ? shown.filter((folder) => labelFor(folder.value).toLowerCase().includes(needle))
    : shown;

  const choose = (next: string) => {
    onChange(next);
    setOpen(false);
  };

  const label = value === "__all" ? "All folders" : labelFor(value);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={
          <button
            type="button"
            aria-label={`Folder: ${label}`}
            title={label}
            className="flex h-8 w-full min-w-0 items-center gap-2 rounded-lg bg-secondary px-2.5 text-left text-[13px] font-semibold text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            {value === NO_PROJECT_FILTER ? (
              <Plus className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <Folder className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground/70" />
          </button>
        }
      />
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="isolate z-[170] outline-none">
          <Popover.Popup
            initialFocus={page === "pick" && searchable ? inputRef : true}
            data-testid="project-folder-menu"
            className="flex max-h-[min(var(--available-height),32rem)] w-[max(var(--anchor-width),16rem)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl ring-1 ring-foreground/5 outline-none"
          >
            {page === "pick" ? (
              <>
                {searchable ? (
                  <div className="relative mb-1.5">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      ref={inputRef}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Escape") setOpen(false);
                        if (event.key === "Enter" && matching[0]) choose(matching[0].value);
                      }}
                      placeholder="Filter folders"
                      aria-label="Filter folders"
                      className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-[13px] outline-none placeholder:text-muted-foreground focus:border-foreground/30"
                    />
                  </div>
                ) : null}
                <div className="min-h-0 flex-1 overflow-y-auto">
                  {hasNoProject && !needle ? (
                    <PickRow
                      selected={value === NO_PROJECT_FILTER}
                      icon={<Plus className="size-3.5" />}
                      label={labelFor(NO_PROJECT_FILTER)}
                      onClick={() => choose(NO_PROJECT_FILTER)}
                    />
                  ) : null}
                  {matching.map((folder) => (
                    <PickRow
                      key={folder.value}
                      selected={value === folder.value}
                      icon={<Folder className="size-3.5" />}
                      label={labelFor(folder.value)}
                      onClick={() => choose(folder.value)}
                    />
                  ))}
                  {needle && !matching.length ? (
                    <p className="px-3 py-6 text-center text-xs text-muted-foreground">No matching folders</p>
                  ) : null}
                </div>
                <div className="mt-1 border-t border-border pt-1">
                  <button
                    type="button"
                    onClick={() => setPage("manage")}
                    className={cn(ROW, "text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:bg-muted")}
                  >
                    <SlidersHorizontal className="size-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">Manage folders</span>
                    {arranged.some((folder) => folder.hidden) ? (
                      <span className="text-[11px] tabular-nums text-muted-foreground/70">
                        {arranged.filter((folder) => folder.hidden).length} hidden
                      </span>
                    ) : null}
                  </button>
                </div>
              </>
            ) : (
              <ManageFolders
                folders={arranged}
                labelFor={labelFor}
                canRemove={canRemove}
                onRemove={onRemove}
                onBack={() => setPage("pick")}
                onAddFolder={
                  onAddFolder
                    ? () => {
                        setOpen(false);
                        onAddFolder();
                      }
                    : undefined
                }
                onNewFolder={
                  onNewFolder
                    ? () => {
                        setOpen(false);
                        onNewFolder();
                      }
                    : undefined
                }
              />
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function PickRow({
  selected,
  icon,
  label,
  onClick,
}: {
  selected: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={label}
      className={cn(
        ROW,
        selected ? "bg-primary/12 font-medium text-foreground" : "text-foreground hover:bg-muted focus-visible:bg-muted",
      )}
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <Check className={cn("size-3.5 shrink-0 text-primary", selected ? "opacity-100" : "opacity-0")} />
    </button>
  );
}

function ManageFolders({
  folders,
  labelFor,
  canRemove,
  onRemove,
  onBack,
  onAddFolder,
  onNewFolder,
}: {
  folders: { value: string; hidden: boolean }[];
  labelFor: (value: string) => string;
  canRemove?: (project: string) => boolean;
  onRemove?: (project: string) => Promise<void>;
  onBack: () => void;
  onAddFolder?: () => void;
  onNewFolder?: () => void;
}) {
  const order = folders.map((folder) => folder.value);
  const [dragging, setDragging] = useState<string | null>(null);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const rows = (preview ?? order)
    .map((value) => folders.find((folder) => folder.value === value))
    .filter((folder): folder is { value: string; hidden: boolean } => !!folder);

  const move = (value: string, to: number) => {
    const next = order.filter((key) => key !== value);
    next.splice(Math.max(0, Math.min(next.length, to)), 0, value);
    setFolderMenuOrder(next);
  };

  const onDragOver = (event: DragEvent, over: string) => {
    if (!dragging || dragging === over) return;
    event.preventDefault();
    // Take the dragged row out and put it in the slot of the row it is over.
    // Moving down, that lands it after the row; moving up, before it.
    const current = preview ?? order;
    const to = current.indexOf(over);
    const next = current.filter((key) => key !== dragging);
    next.splice(to, 0, dragging);
    setPreview(next);
  };

  const finishDrag = () => {
    if (preview) setFolderMenuOrder(preview);
    setPreview(null);
    setDragging(null);
  };

  const onHandleKey = (event: KeyboardEvent, value: string, index: number) => {
    if (event.key === "ArrowUp" && index > 0) {
      event.preventDefault();
      move(value, index - 1);
    } else if (event.key === "ArrowDown" && index < order.length - 1) {
      event.preventDefault();
      move(value, index + 1);
    }
  };

  return (
    <>
      <div className="flex h-9 shrink-0 items-center gap-1 px-1">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to folders"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-[13px] font-semibold">Manage folders</span>
      </div>
      <p className="px-2.5 pb-1.5 text-[11px] leading-snug text-muted-foreground">
        Drag to reorder. Hide a folder to keep it out of this menu.
      </p>
      <div className="min-h-0 flex-1 overflow-y-auto" onDragEnd={finishDrag}>
        {rows.map((folder, index) => {
          const name = labelFor(folder.value);
          const removable = !!onRemove && !!canRemove?.(folder.value);
          return (
            <div
              key={folder.value}
              data-folder={folder.value}
              draggable={busy === null}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", folder.value);
                setDragging(folder.value);
              }}
              onDragOver={(event) => onDragOver(event, folder.value)}
              onDrop={(event) => {
                event.preventDefault();
                finishDrag();
              }}
              className={cn(
                "group flex h-9 items-center gap-1 rounded-lg pl-0.5 pr-1 text-[13px] hover:bg-muted/60",
                dragging === folder.value && "bg-muted opacity-70",
              )}
            >
              <button
                type="button"
                aria-label={`Reorder ${name}`}
                title="Drag, or use the arrow keys"
                onKeyDown={(event) => onHandleKey(event, folder.value, index)}
                className="flex size-7 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground/60 hover:text-foreground focus-visible:bg-muted active:cursor-grabbing"
              >
                <GripVertical className="size-3.5" />
              </button>
              <span className={cn("min-w-0 flex-1 truncate", folder.hidden && "text-muted-foreground line-through decoration-muted-foreground/40")} title={name}>
                {name}
              </span>
              <button
                type="button"
                onClick={() => setFolderMenuHidden(folder.value, !folder.hidden)}
                aria-label={folder.hidden ? `Show ${name} in the menu` : `Hide ${name} from the menu`}
                title={folder.hidden ? "Show in the menu" : "Hide from the menu"}
                aria-pressed={!folder.hidden}
                className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {folder.hidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
              {removable ? (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={async () => {
                    setBusy(folder.value);
                    try {
                      await onRemove!(folder.value);
                    } finally {
                      setBusy(null);
                    }
                  }}
                  aria-label={`Remove ${name} from the folder list`}
                  title="Remove from the list. The files stay on disk."
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/15 hover:text-destructive disabled:opacity-40"
                >
                  {busy === folder.value ? <Loader2 className="size-3.5 animate-spin" /> : <FolderMinus className="size-3.5" />}
                </button>
              ) : (
                <span className="size-7 shrink-0" aria-hidden="true" />
              )}
            </div>
          );
        })}
        {!rows.length ? <p className="px-3 py-6 text-center text-xs text-muted-foreground">No folders yet</p> : null}
      </div>
      {onAddFolder || onNewFolder ? (
        <div className="mt-1 grid shrink-0 grid-cols-2 gap-1.5 border-t border-border pt-1.5">
          {onAddFolder ? (
            <button
              type="button"
              onClick={onAddFolder}
              className="flex h-8 items-center justify-center gap-1.5 rounded-lg bg-secondary text-xs font-medium hover:bg-muted"
            >
              <Folder className="size-3.5" /> Add folder
            </button>
          ) : null}
          {onNewFolder ? (
            <button
              type="button"
              onClick={onNewFolder}
              className="flex h-8 items-center justify-center gap-1.5 rounded-lg bg-secondary text-xs font-medium hover:bg-muted"
            >
              <FolderPlus className="size-3.5" /> New folder
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
