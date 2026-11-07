// The phone list's Apps view: each project folder on this computer, with its
// sessions under it. Opening a project scopes the list and the composer to its
// folder, the same scope a folder pill sets.
//
// Nothing here is stored. Folders and sessions are this computer's.

import { useLayoutEffect } from "react";
import { CreateTutorials, useHostTutorialCards } from "./create-tutorials";
import { useHomeGuideActive } from "./tutorial-guide";
import { ChevronLeft, Folder, History } from "lucide-react";
import { sessionAppRepo } from "../../../packages/protocol/src/app-link";
import { cn } from "../lib/utils";

type RepoLike = { cwd: string; project?: string; name?: string };
export type SessionLike = { sessionId?: string | null; cwd?: string | null; project?: string | null; lastActivityAt?: number | null };

/** A project on this computer. */
export type LocalProject<S extends SessionLike> = {
  /** The folder's project filter value. Opening it selects it. */
  project: string;
  name: string;
  sessions: S[];
  lastActivityAt: number;
};

export function buildLocalProjects<S extends SessionLike, R extends RepoLike>(
  repos: readonly R[],
  sessions: readonly S[],
  projectOf: (repo: R) => string,
): LocalProject<S>[] {
  const items = new Map<R, LocalProject<S>>();
  for (const repo of repos) {
    const project = projectOf(repo);
    items.set(repo, { project, name: repo.name || project.split("/").pop() || project, sessions: [], lastActivityAt: 0 });
  }
  for (const session of sessions) {
    const repo = sessionAppRepo(session, repos);
    const item = repo ? items.get(repo) : undefined;
    if (!item) continue;
    item.sessions.push(session);
    item.lastActivityAt = Math.max(item.lastActivityAt, session.lastActivityAt ?? 0);
  }
  const local = [...items.values()];
  for (const item of local) item.sessions.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
  local.sort((a, b) => b.lastActivityAt - a.lastActivityAt || a.name.localeCompare(b.name));
  return local;
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Working"
      className={cn("size-3.5 shrink-0 animate-spin rounded-full border-2 border-primary/25 border-t-primary motion-reduce:animate-none", className)}
    />
  );
}

/** "‹ Apps / name" above an app or folder page: where it sits, and the way back. */
export function ScopeCrumb({ name, onBack }: { name: string; onBack: () => void }) {
  return (
    <nav aria-label="Breadcrumb" className="mx-1 flex min-w-0 items-center gap-1.5 px-1 pb-1 text-[14px] text-muted-foreground">
      <button type="button" onClick={onBack} className="-ml-1 flex shrink-0 items-center rounded-full py-1 pr-1.5 pl-0.5 active:bg-muted/60">
        <ChevronLeft className="size-4" aria-hidden="true" />
        Apps
      </button>
      <span aria-hidden="true">/</span>
      <span className="min-w-0 truncate font-semibold text-foreground" aria-current="page">{name}</span>
    </nav>
  );
}

/** The first row of a project on this Computer: its name, and its earlier sessions. */
export function LocalProjectCard({ name, onFindSessions }: { name: string; onFindSessions: () => void }) {
  return (
    <div className="mx-1 mb-1 flex items-center gap-3 rounded-2xl border border-border bg-card px-3 py-3">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Folder className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[17px] font-semibold tracking-[-0.01em]">{name}</span>
        <span className="block text-[12.5px] text-muted-foreground">On this computer</span>
      </span>
      <button type="button" onClick={onFindSessions} className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-muted px-3 text-[13px] font-semibold">
        <History className="size-4" aria-hidden="true" />
        Earlier sessions
      </button>
    </div>
  );
}

export function isWorking(session: SessionLike): boolean {
  const s = session as SessionLike & { busy?: boolean; launching?: boolean };
  return !!(s.busy || s.launching);
}

/**
 * The Create view's page. The real home composer sits over the gap in the
 * middle (the shell positions it there and publishes its height as
 * --lfg-create-composer-h), so this draws only what is above and below it.
 */
/**
 * The Create page under the heading and the composer (the shell draws those
 * over the gap at the top, CreateComposerFrame). Only what starts something:
 * work on an app is inside the app, and every session is in Chats.
 */
export function CreateHome() {
  // The heading and the tutorials, centred in the space between the header and
  // the docked chat box. A host's tutorials bring their own section titles
  // ("Start something new", "Learn a skill"), so the heading steps aside.
  const { cards } = useHostTutorialCards();
  // A tutorial's first step is in the docked chat box (its guide card). The
  // cards step aside, so the page under the guide is empty instead of
  // half-covered by it.
  const guideActive = useHomeGuideActive();
  if (guideActive) return null;
  return (
    <div
      className="flex flex-col justify-center px-2 pb-4"
      // The visible height less the header and the docked chat box: main's own
      // padding reserves the chat box with the same variable.
      style={{ minHeight: "calc(var(--lfg-app-height, 100dvh) - var(--lfg-mobile-header-height, 0px) - var(--lfg-inline-composer-height, var(--lfg-composer-clear, 6rem)))" }}
    >
      <div className="relative z-[1]">
        {cards.length ? null : (
          <h1 className="px-1 pb-2 text-[22px] font-bold leading-tight tracking-[-0.02em]">What do you want to make?</h1>
        )}
        <CreateTutorials />
      </div>
    </div>
  );
}

/**
 * Decoration only: three soft color clouds that drift slowly behind the Create
 * page. Gradients moved by transform, so the browser only composites them.
 * Still for people who ask for reduced motion.
 *
 * The phone shell keeps it mounted on every live page and fades it in and out
 * with Create, so switching pages is a cross-fade and the drift carries on
 * where it was. While hidden, the clouds stop moving.
 */
export function CreateBackdrop({ shown, contained = false }: { shown: boolean; contained?: boolean }) {
  // While Create shows, the phone header drops its own background so the
  // backdrop runs under it (html.lfg-create-view in index.css), with the same fade.
  // A contained backdrop (the desktop home pane) leaves the header alone.
  useLayoutEffect(() => {
    if (!contained) document.documentElement.classList.toggle("lfg-create-view", shown);
  }, [shown, contained]);
  useLayoutEffect(() => () => {
    if (!contained) document.documentElement.classList.remove("lfg-create-view");
  }, [contained]);
  return (
    <div
      aria-hidden="true"
      // Fades out toward every edge (lfg-create-backdrop in index.css).
      // Contained: fills its positioned parent and sizes the glows to it.
      className={cn(
        "lfg-create-backdrop pointer-events-none inset-0 z-0 overflow-hidden transition-opacity duration-500 ease-out motion-reduce:transition-none",
        contained ? "lfg-create-backdrop-contained absolute rounded-[inherit]" : "fixed",
        shown ? "opacity-100 dark:opacity-90" : "lfg-create-backdrop-idle opacity-0",
      )}
    >
      <span className="lfg-create-cloud lfg-create-cloud-a" />
      <span className="lfg-create-cloud lfg-create-cloud-b" />
      <span className="lfg-create-cloud lfg-create-cloud-c" />
      <span className="lfg-create-cloud lfg-create-cloud-d" />
      <span className="lfg-create-cloud lfg-create-cloud-e" />
    </div>
  );
}
