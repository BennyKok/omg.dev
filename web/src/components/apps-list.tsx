// The Apps page: published apps and games, the projects on this Computer, and
// Import. Its own chunk (App.tsx loads it with lazyWithReload), so the Apps
// page adds nothing to the hosted Computer surface's first load.

import { useEffect, useState } from "react";
import { ChevronRight, ExternalLink, Folder, FolderPlus } from "lucide-react";
import { Github } from "./icons/github";
import { cn } from "../lib/utils";
import { timeAgo } from "../lib/session-ui";
import { omgFetch } from "../lib/omg-client";
import { useFolderMenuPrefs } from "../lib/folder-menu-prefs";
import { AppIcon, hostOf, isWorking, LiveDot, Spinner, type AppItem, type LocalProject, type SessionLike } from "./apps-home";

/** Past sessions per project on this Computer (`/api/sessions/resumable` facets), read once. */
function useProjectSessionCounts(enabled: boolean): ReadonlyMap<string, number> {
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(() => new Map());
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    omgFetch("/api/sessions/resumable?limit=1", undefined, { background: true })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { facets?: { projects?: { project: string; count: number }[] } } | null) => {
        if (!live) return;
        setCounts(new Map((body?.facets?.projects ?? []).map((row) => [row.project, row.count])));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [enabled]);
  return counts;
}

type Filter = "all" | "published" | "folders";
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "published", label: "Published" },
  { id: "folders", label: "Folders" },
];

type Entry<S extends SessionLike> =
  | { type: "app"; item: AppItem<S>; lastActivityAt: number }
  | { type: "folder"; item: LocalProject<S>; lastActivityAt: number };

export default function AppsList<S extends SessionLike>({
  apps,
  local,
  onOpenApp,
  onOpenProject,
  onImportFolder,
  onImportGitHub,
}: {
  /** Apps and games in one list, most recent activity first, then newest. */
  apps: AppItem<S>[];
  /** Projects on this Computer that are not published apps. */
  local: LocalProject<S>[];
  /** Kept for callers; a row opens its app or folder page, which lists its sessions. */
  onOpenSession?: (sessionId: string) => void;
  onOpenApp: (item: AppItem<S>) => void;
  onOpenProject: (project: string) => void;
  onImportFolder?: () => void;
  onImportGitHub?: () => void;
}) {
  const nothing = !apps.length && !local.length;
  const [filter, setFilter] = useState<Filter>("all");
  // The folders in use: live sessions now, or past sessions in the history
  // (the resumable list's per-project counts). The rest of the scanned
  // folders wait behind one row. A folder hidden in the folder menu stays hidden.
  const [allLocal, setAllLocal] = useState(false);
  const hiddenFolders = new Set(useFolderMenuPrefs().hidden);
  const history = useProjectSessionCounts(local.length > 0);
  const used = (item: LocalProject<S>) => item.sessions.length + (history.get(item.project) ?? 0);
  const activeLocal = local
    .filter((item) => !hiddenFolders.has(item.project) && used(item) > 0)
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt || used(b) - used(a));
  const shownLocal = allLocal || !activeLocal.length ? local : activeLocal.slice(0, LOCAL_SHOWN);
  const hiddenLocal = filter === "published" ? 0 : local.length - shownLocal.length;
  // One list: a published app is a folder with a publish link, so apps and
  // folders sort together by the last work on them. On a tie, apps keep their
  // own order (newest first) ahead of folders.
  const entries: Entry<S>[] = [
    ...(filter === "folders" ? [] : apps.map((item) => ({ type: "app" as const, item, lastActivityAt: item.lastActivityAt }))),
    ...(filter === "published" ? [] : shownLocal.map((item) => ({ type: "folder" as const, item, lastActivityAt: item.lastActivityAt }))),
  ];
  entries.sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  return (
    <div className="flex flex-col gap-1 px-1">
      {nothing ? (
        <div className="mx-1 mt-6 rounded-2xl border border-border bg-card px-5 py-8 text-center">
          <p className="text-[15px] font-semibold">No apps yet</p>
          <p className="mt-1 text-[13px] text-muted-foreground">Make one on Create, or import a project.</p>
        </div>
      ) : null}
      {apps.length && local.length ? (
        <div role="group" aria-label="Show" className="flex gap-1.5 px-0.5 pt-1">
          {FILTERS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={filter === option.id}
              onClick={() => setFilter(option.id)}
              className={cn(
                "h-8 rounded-full border px-3 text-[13px] font-medium",
                filter === option.id ? "border-transparent bg-foreground text-background" : "border-border bg-card text-muted-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      {entries.length || hiddenLocal > 0 ? (
        <section className="mb-3">
          <div className="px-1.5 pt-2 pb-2 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Projects · {(filter === "folders" ? 0 : apps.length) + (filter === "published" ? 0 : local.length)}
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-card [&>*+*]:border-t [&>*+*]:border-border">
            {entries.map((entry) =>
              entry.type === "app" ? (
                <AppRow key={`app:${entry.item.project}`} item={entry.item} onOpen={onOpenApp} />
              ) : (
                <FolderRow key={`folder:${entry.item.project}`} item={entry.item} sessions={used(entry.item)} onOpen={onOpenProject} />
              ),
            )}
            {hiddenLocal > 0 ? (
              <button type="button" onClick={() => setAllLocal(true)} className="block w-full py-2.5 text-center text-[13.5px] font-medium text-primary active:bg-muted/60">
                Show {hiddenLocal} more folder{hiddenLocal === 1 ? "" : "s"}
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
      {onImportFolder || onImportGitHub ? <ImportProject onFolder={onImportFolder} onGitHub={onImportGitHub} /> : null}
    </div>
  );
}

function AppRow<S extends SessionLike>({ item, onOpen }: { item: AppItem<S>; onOpen: (item: AppItem<S>) => void }) {
  return (
    <div className="flex items-center pr-2">
      <button type="button" onClick={() => onOpen(item)} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pl-3 pr-2 text-left active:bg-muted/60">
        <AppIcon item={item} />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[15px] font-semibold tracking-[-0.01em]">{item.name}</span>
            {item.kind === "game" ? <span className="shrink-0 rounded-md bg-muted px-1.5 py-px text-[11px] font-medium text-muted-foreground">Game</span> : null}
          </span>
          <span className="block truncate text-[12.5px] text-muted-foreground">
            <LiveDot live={item.isLive} />
            {hostOf(item.link.url)}
            {item.lastActivityAt ? ` · ${timeAgo(item.lastActivityAt)}` : ""}
          </span>
        </span>
        {item.sessions.some(isWorking) ? <Spinner /> : null}
      </button>
      {/* The published app itself, one tap from the list. */}
      <a
        href={item.link.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${item.name}`}
        title={`Open ${hostOf(item.link.url)}`}
        className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted active:bg-muted"
      >
        <ExternalLink className="size-[18px]" aria-hidden="true" />
      </a>
    </div>
  );
}

function FolderRow<S extends SessionLike>({ item, sessions, onOpen }: { item: LocalProject<S>; sessions: number; onOpen: (project: string) => void }) {
  return (
    <button type="button" onClick={() => onOpen(item.project)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-muted/60">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Folder className="size-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold tracking-[-0.01em]">{item.name}</span>
        <span className="block truncate text-[12.5px] text-muted-foreground">
          On this computer · {sessions ? `${sessions.toLocaleString()} session${sessions === 1 ? "" : "s"}` : "No sessions"}
          {item.lastActivityAt ? ` · ${timeAgo(item.lastActivityAt)}` : ""}
        </span>
      </span>
      {item.sessions.some(isWorking) ? <Spinner /> : null}
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}

/** Bring a project in: a folder already on this Computer, or a GitHub repository. */
function ImportProject({ onFolder, onGitHub }: { onFolder?: () => void; onGitHub?: () => void }) {
  return (
    <section className="mb-4">
      <div className="px-1.5 pt-2 pb-2 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Import</div>
      <div className="grid grid-cols-2 gap-2">
        {onFolder ? (
          <button type="button" onClick={onFolder} className="flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-3 text-left text-[14px] font-medium active:bg-muted/60">
            <FolderPlus className="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
            A folder here
          </button>
        ) : null}
        {onGitHub ? (
          <button type="button" onClick={onGitHub} className="flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-3 text-left text-[14px] font-medium active:bg-muted/60">
            <Github className="size-[18px] shrink-0 text-muted-foreground" aria-hidden="true" />
            From GitHub
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** Folders in use shown before "Show more". */
const LOCAL_SHOWN = 8;
