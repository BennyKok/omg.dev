// The Apps page: the projects on this computer, and Import. Its own chunk (App.tsx loads it with lazyWithReload), so the Apps
// page adds nothing to the hosted Computer surface's first load.

import { useEffect, useState } from "react";
import { ChevronRight, Folder, FolderPlus } from "lucide-react";
import { Github } from "./icons/github";
import { timeAgo } from "../lib/session-ui";
import { omgFetch } from "../lib/omg-client";
import { useFolderMenuPrefs } from "../lib/folder-menu-prefs";
import { isWorking, Spinner, type LocalProject, type SessionLike } from "./apps-home";

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

export default function AppsList<S extends SessionLike>({
  local,
  onOpenProject,
  onImportFolder,
  onImportGitHub,
}: {
  /** Projects on this computer. */
  local: LocalProject<S>[];
  /** Kept for callers; a row opens its folder page, which lists its sessions. */
  onOpenSession?: (sessionId: string) => void;
  onOpenProject: (project: string) => void;
  onImportFolder?: () => void;
  onImportGitHub?: () => void;
}) {
  const nothing = !local.length;
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
  const hiddenLocal = local.length - shownLocal.length;
  const entries = [...shownLocal].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  return (
    <div className="flex flex-col gap-1 px-1">
      {nothing ? (
        <div className="mx-1 mt-6 rounded-2xl border border-border bg-card px-5 py-8 text-center">
          <p className="text-[15px] font-semibold">No projects yet</p>
          <p className="mt-1 text-[13px] text-muted-foreground">Start one on Create, or import a project.</p>
        </div>
      ) : null}
      {entries.length || hiddenLocal > 0 ? (
        <section className="mb-3">
          <div className="px-1.5 pt-2 pb-2 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            Projects · {local.length}
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-card [&>*+*]:border-t [&>*+*]:border-border">
            {entries.map((item) => (
              <FolderRow key={`folder:${item.project}`} item={item} sessions={used(item)} onOpen={onOpenProject} />
            ))}
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
