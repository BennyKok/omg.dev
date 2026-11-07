/**
 * THE PHONE'S FOLDERS PAGE: the top of the left drawer.
 *
 * It replaced the Create, Apps and Chats pills. Picking a row selects that
 * folder: the list shows only its chats, the header names it, and the next
 * chat starts there. "All chats" leaves the folder. The shell owns the value
 * (the project filter); this only draws it and hands a pick back.
 */
import { Folder, FolderPlus, MessagesSquare, Settings } from "lucide-react";
import { Github } from "./icons/github";
import { cn } from "@/lib/utils";
import { arrangeFolders, useFolderMenuPrefs } from "../lib/folder-menu-prefs";
import { NO_PROJECT_FILTER } from "../lib/project-filter";
import type { ReactNode } from "react";

export function PhoneFolders({
  value,
  projects,
  labelFor,
  counts,
  running,
  onPick,
  onAddFolder,
  onNewFolder,
  onCloneGitHub,
  onOpenSettings,
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
  onPick: (value: string) => void;
  onAddFolder?: () => void;
  onNewFolder?: () => void;
  onCloneGitHub?: () => void;
  /** The gear beside the title. Settings is one tap from here, always. */
  onOpenSettings?: () => void;
}) {
  const prefs = useFolderMenuPrefs();
  const folders = arrangeFolders(
    projects.filter((project) => project !== NO_PROJECT_FILTER && project !== "__all"),
    prefs,
  ).filter((folder) => !folder.hidden || folder.value === value);
  const total = counts ? [...counts.values()].reduce((sum, n) => sum + n, 0) : 0;

  return (
    <section aria-labelledby="phone-folders-title" className="flex flex-col gap-1">
      <div className="flex items-center justify-between px-3 pb-1">
        <h1 id="phone-folders-title" className="text-[22px] font-bold tracking-[-0.02em]">
          Folders
        </h1>
        {onOpenSettings ? (
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Settings"
            title="Settings"
            className="flex size-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Settings className="size-5" />
          </button>
        ) : null}
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
      {onAddFolder || onNewFolder || onCloneGitHub ? (
        <div className="mt-1 flex flex-col">
          {onAddFolder ? <ActionRow icon={<FolderPlus className="size-4" />} label="Add a folder on this computer" onClick={onAddFolder} /> : null}
          {onNewFolder ? <ActionRow icon={<FolderPlus className="size-4" />} label="New empty folder" onClick={onNewFolder} /> : null}
          {onCloneGitHub ? <ActionRow icon={<Github className="size-4" />} label="Clone from GitHub" onClick={onCloneGitHub} /> : null}
        </div>
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
