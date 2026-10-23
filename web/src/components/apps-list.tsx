// The Apps page: published apps and games, the projects on this Computer, and
// Import. Its own chunk (App.tsx loads it with lazyWithReload), so the Apps
// page adds nothing to the hosted Computer surface's first load.

import { useEffect, useState } from "react";
import { Check, ChevronRight, ExternalLink, Folder, FolderPlus, Github } from "lucide-react";
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

export default function AppsList<S extends SessionLike>({
  apps,
  local,
  onOpenSession,
  onOpenApp,
  onOpenProject,
  onImportFolder,
  onImportGitHub,
}: {
  /** Apps and games in one list, most recent activity first, then newest. */
  apps: AppItem<S>[];
  /** Projects on this Computer that are not published apps. */
  local: LocalProject<S>[];
  onOpenSession: (sessionId: string) => void;
  onOpenApp: (item: AppItem<S>) => void;
  onOpenProject: (project: string) => void;
  onImportFolder?: () => void;
  onImportGitHub?: () => void;
}) {
  const nothing = !apps.length && !local.length;
  // The projects in use: live sessions now, or past sessions in the history
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
  return (
    <div className="flex flex-col gap-1 px-1">
      {nothing ? (
        <div className="mx-1 mt-6 rounded-2xl border border-border bg-card px-5 py-8 text-center">
          <p className="text-[15px] font-semibold">No apps yet</p>
          <p className="mt-1 text-[13px] text-muted-foreground">Make one on Create, or import a project.</p>
        </div>
      ) : null}
      {/* One list, not Games then Apps: the one worked on last is on top. */}
      <AppSection label="Apps" items={apps} onOpenSession={onOpenSession} onOpenApp={onOpenApp} />
      {local.length ? (
        <section className="mb-3">
          <div className="px-1.5 pt-2 pb-2 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
            On this computer · {local.length}
          </div>
          <div className="overflow-hidden rounded-2xl border border-border bg-card [&>*+*]:border-t [&>*+*]:border-border">
            {shownLocal.map((item) => (
              <button
                key={item.project}
                type="button"
                onClick={() => onOpenProject(item.project)}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:bg-muted/60"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Folder className="size-[18px]" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold tracking-[-0.01em]">{item.name}</span>
                  <span className="block truncate text-[12.5px] text-muted-foreground">
                    {used(item) ? `${used(item).toLocaleString()} session${used(item) === 1 ? "" : "s"}` : "No sessions"}
                    {item.lastActivityAt ? ` · ${timeAgo(item.lastActivityAt)}` : ""}
                  </span>
                </span>
                {item.sessions.some(isWorking) ? <Spinner /> : null}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              </button>
            ))}
            {hiddenLocal > 0 ? (
              <button type="button" onClick={() => setAllLocal(true)} className="block w-full py-2.5 text-center text-[13.5px] font-medium text-primary active:bg-muted/60">
                Show {hiddenLocal} more
              </button>
            ) : null}
          </div>
        </section>
      ) : null}
      {onImportFolder || onImportGitHub ? <ImportProject onFolder={onImportFolder} onGitHub={onImportGitHub} /> : null}
    </div>
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

const SESSIONS_PER_APP = 2;
/** Projects on this Computer shown before "Show more". */
const LOCAL_SHOWN = 8;

function AppSection<S extends SessionLike>({
  label,
  items,
  onOpenSession,
  onOpenApp,
}: {
  label: string;
  items: AppItem<S>[];
  onOpenSession: (sessionId: string) => void;
  onOpenApp: (item: AppItem<S>) => void;
}) {
  if (!items.length) return null;
  return (
    <section className="mb-3">
      <div className="px-1.5 pt-2 pb-2 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {label} · {items.length}
      </div>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <div key={item.project} className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex items-center pr-3">
              <button type="button" onClick={() => onOpenApp(item)} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-3 pr-2 text-left active:bg-muted/60">
                <AppIcon item={item} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold tracking-[-0.01em]">{item.name}</span>
                  <span className="block truncate text-[12.5px] text-muted-foreground">
                    <LiveDot live={item.isLive} />
                    {hostOf(item.link.url)}
                  </span>
                </span>
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
            {item.sessions.slice(0, SESSIONS_PER_APP).map((session) => (
              <SessionLine key={session.sessionId ?? ""} session={session} onOpen={onOpenSession} />
            ))}
            {item.sessions.length > SESSIONS_PER_APP ? (
              <button
                type="button"
                onClick={() => onOpenApp(item)}
                className="block w-full border-t border-border py-2.5 pl-[68px] text-left text-[13.5px] text-muted-foreground"
              >
                {item.sessions.length - SESSIONS_PER_APP} more
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function SessionLine({ session, onOpen }: { session: SessionLike; onOpen: (sessionId: string) => void }) {
  const s = session as SessionLike & { title?: string | null; lastUserText?: string | null };
  const title = s.title?.trim() || s.lastUserText?.trim() || "Untitled session";
  return (
    <button
      type="button"
      onClick={() => session.sessionId && onOpen(session.sessionId)}
      className="flex w-full items-center gap-2.5 border-t border-border py-2.5 pr-3 pl-[68px] text-left text-[14px] active:bg-muted/60"
    >
      {isWorking(session) ? <Spinner /> : <Check className="size-3.5 shrink-0 text-emerald-500" aria-hidden="true" />}
      <span className="min-w-0 flex-1 truncate">{title}</span>
      {session.lastActivityAt ? <span className="shrink-0 text-[12px] text-muted-foreground">{timeAgo(session.lastActivityAt)}</span> : null}
    </button>
  );
}

