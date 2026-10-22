// The phone list's Apps view: each project folder that links to a hosted app
// (`.omg/project.json`, on the repo row as `deploy`) drawn as that app, with
// its sessions under it, split into Games and Apps. Opening an app scopes the
// list and the composer to its folder, the same scope a folder pill sets, and
// the scoped list starts with the app's card.
//
// Nothing here is stored. Folders and sessions are this Computer's. The icon,
// live state and app-or-game come from the Cloud app list (/api/cloud/apps),
// and are left out when the control plane does not send them.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CreateTutorials } from "./create-tutorials";
import { Check, Copy, ExternalLink, Gamepad2, History, Plus, Settings2, Smartphone } from "lucide-react";
import { consoleAppUrl, sessionAppRepo, type AppLink } from "../../../packages/protocol/src/app-link";
import { timeAgo } from "../lib/session-ui";
import type { CloudAppRow, CloudAppVisits } from "../../../packages/cloud/src/apps";
import { omgFetch } from "../lib/omg-client";
import { cn } from "../lib/utils";

type RepoLike = { cwd: string; project?: string; name?: string; deploy?: AppLink };
type SessionLike = { sessionId?: string | null; cwd?: string | null; project?: string | null; lastActivityAt?: number | null };

export type AppItem<S extends SessionLike> = {
  /** The folder's project filter value. Opening the app selects it. */
  project: string;
  link: AppLink;
  name: string;
  iconUrl: string | null;
  /** Null when the control plane did not say. */
  isLive: boolean | null;
  kind: "app" | "game";
  sessions: S[];
  lastActivityAt: number;
};

// Until the owner files an app with projects.setAppKind, a folder or app named
// as a game ("snake-game", "games") is listed under Games.
const GAME_NAME = /(^|[^a-z])games?([^a-z]|$)/i;

export function buildAppItems<S extends SessionLike, R extends RepoLike>(
  repos: readonly R[],
  sessions: readonly S[],
  cloud: ReadonlyMap<string, CloudAppRow>,
  projectOf: (repo: R) => string,
): { games: AppItem<S>[]; apps: AppItem<S>[] } {
  const items = new Map<R, AppItem<S>>();
  for (const repo of repos) {
    if (!repo.deploy) continue;
    const row = cloud.get(repo.deploy.slug);
    const project = projectOf(repo);
    const name = row?.name || repo.deploy.name || project;
    items.set(repo, {
      project,
      link: repo.deploy,
      name,
      iconUrl: row?.iconUrl ?? null,
      isLive: typeof row?.isLive === "boolean" ? row.isLive : null,
      kind: row?.appKind ?? (GAME_NAME.test(project) || GAME_NAME.test(name) ? "game" : "app"),
      sessions: [],
      lastActivityAt: 0,
    });
  }
  // The session that built an app belongs to it even when its folder or
  // project label names something else (the questnest replay).
  const builtBy = new Map<string, AppItem<S>>();
  for (const [repo, item] of items) {
    const id = cloud.get(repo.deploy!.slug)?.builtBySessionId;
    if (id) builtBy.set(id, item);
  }
  for (const session of sessions) {
    const byId = session.sessionId ? builtBy.get(session.sessionId) : undefined;
    const repo = byId ? undefined : sessionAppRepo(session, repos);
    const item = byId ?? (repo ? items.get(repo) : undefined);
    if (!item) continue;
    item.sessions.push(session);
    item.lastActivityAt = Math.max(item.lastActivityAt, session.lastActivityAt ?? 0);
  }
  const all = [...items.values()];
  for (const item of all) item.sessions.sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0));
  // Apps with recent work first, then the rest by name.
  all.sort((a, b) => b.lastActivityAt - a.lastActivityAt || a.name.localeCompare(b.name));
  return { games: all.filter((item) => item.kind === "game"), apps: all.filter((item) => item.kind === "app") };
}

let cloudAppsRequest: Promise<Map<string, CloudAppRow>> | null = null;

/** The Cloud app list by slug. Read once per page; an error leaves it empty. */
export function useCloudApps(enabled: boolean): ReadonlyMap<string, CloudAppRow> {
  const [apps, setApps] = useState<ReadonlyMap<string, CloudAppRow>>(() => new Map());
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    cloudAppsRequest ??= omgFetch("/api/cloud/apps", undefined, { background: true })
      .then((res) => (res.ok ? res.json() : { apps: [] }))
      .then((body: { apps?: CloudAppRow[] }) => new Map((body.apps ?? []).map((row) => [row.slug, row])))
      .catch(() => {
        cloudAppsRequest = null;
        return new Map<string, CloudAppRow>();
      });
    void cloudAppsRequest.then((map) => {
      if (live) setApps(map);
    });
    return () => {
      live = false;
    };
  }, [enabled]);
  return apps;
}

export function AppsList<S extends SessionLike>({
  games,
  apps,
  onOpenSession,
  onOpenApp,
}: {
  games: AppItem<S>[];
  apps: AppItem<S>[];
  onOpenSession: (sessionId: string) => void;
  /** `change` asks for the chat box too ("Change something"). */
  onOpenApp: (item: AppItem<S>, change: boolean) => void;
}) {
  if (!games.length && !apps.length) {
    return (
      <div className="mx-2 mt-6 rounded-2xl border border-border bg-card px-5 py-8 text-center">
        <p className="text-[15px] font-semibold">No apps yet</p>
        <p className="mt-1 text-[13px] text-muted-foreground">Describe an app or a game below. When it is published, it shows here.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 px-1">
      <AppSection label="Games" items={games} onOpenSession={onOpenSession} onOpenApp={onOpenApp} />
      <AppSection label="Apps" items={apps} onOpenSession={onOpenSession} onOpenApp={onOpenApp} />
    </div>
  );
}

const SESSIONS_PER_APP = 2;

function AppSection<S extends SessionLike>({
  label,
  items,
  onOpenSession,
  onOpenApp,
}: {
  label: string;
  items: AppItem<S>[];
  onOpenSession: (sessionId: string) => void;
  onOpenApp: (item: AppItem<S>, change: boolean) => void;
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
              <button type="button" onClick={() => onOpenApp(item, false)} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-3 pr-2 text-left active:bg-muted/60">
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
                onClick={() => onOpenApp(item, false)}
                className="block w-full border-t border-border py-2.5 pl-[68px] text-left text-[13.5px] text-muted-foreground"
              >
                {item.sessions.length - SESSIONS_PER_APP} more
              </button>
            ) : null}
            {/* Only under existing work: on an idle app the card itself opens it. */}
            {item.sessions.length ? <button
              type="button"
              onClick={() => onOpenApp(item, true)}
              className="flex w-full items-center gap-2 border-t border-border py-2.5 pl-[68px] text-left text-[14px] font-medium text-primary"
            >
              <Plus className="size-4" aria-hidden="true" />
              Change something
            </button> : null}
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

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Working"
      className={cn("size-3.5 shrink-0 animate-spin rounded-full border-2 border-primary/25 border-t-primary motion-reduce:animate-none", className)}
    />
  );
}

function LiveTag() {
  return (
    <span className="shrink-0 rounded-full bg-emerald-500/12 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-emerald-700 dark:text-emerald-400">
      Live
    </span>
  );
}

/** The scoped list's first row: the app this folder publishes. */
export function AppHeaderCard<S extends SessionLike>({ item, onCopied }: { item: AppItem<S>; onCopied?: () => void }) {
  const link = item.link;
  if (!link) return null;
  const action = "flex h-9 items-center justify-center gap-1.5 rounded-xl bg-secondary text-[13px] font-medium";
  return (
    <div className="mx-1 mb-2 rounded-[20px] border border-border bg-card p-3.5 shadow-sm">
      <div className="flex items-center gap-3">
        <AppIcon item={item} large />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[18px] font-bold tracking-[-0.02em]">{item.name}</div>
          <div className="truncate text-[13px] text-muted-foreground">
            <LiveDot live={item.isLive} />
            {hostOf(link.url)}
          </div>
        </div>
        {item.isLive ? <LiveTag /> : null}
      </div>
      <AppVisits slug={link.slug} />
      <div className="mt-3 grid grid-cols-3 gap-2">
        <a href={link.url} target="_blank" rel="noreferrer" className={action}>
          <ExternalLink className="size-3.5" aria-hidden="true" />
          Open
        </a>
        <button
          type="button"
          onClick={() => void navigator.clipboard?.writeText(link.url).then(() => onCopied?.(), () => undefined)}
          className={action}
        >
          <Copy className="size-3.5" aria-hidden="true" />
          Share
        </button>
        <a href={consoleAppUrl(link.slug)} target="_blank" rel="noreferrer" className={action}>
          <Settings2 className="size-3.5" aria-hidden="true" />
          Settings
        </a>
      </div>
    </div>
  );
}

/**
 * An app page with no open session. The app exists, so this never says "No
 * sessions yet": that read as lost work and led a customer to build the same
 * app a second time. It points back to the earlier sessions, searched by the
 * app's name, and the page's "Change something" button continues the app.
 */
export function AppNoOpenSessions({ name, onFindSessions }: { name: string; onFindSessions: () => void }) {
  return (
    <div className="mx-1 rounded-[20px] border border-border bg-card px-5 py-6 text-center" role="status">
      <p className="text-[15px] font-semibold">Keep building {name}</p>
      <p className="mt-1 text-[13px] text-muted-foreground">Your work on this app is saved. Open an earlier session, or tap Change something.</p>
      <button type="button" onClick={onFindSessions}
        className="mx-auto mt-4 flex h-9 items-center gap-1.5 rounded-xl bg-secondary px-4 text-[13px] font-medium">
        <History className="size-3.5" aria-hidden="true" />
        Earlier sessions
      </button>
    </div>
  );
}

/** The app's visit numbers, read when its page opens. Null until they arrive or when the read fails. */
function useAppVisits(slug: string): CloudAppVisits | null {
  const [visits, setVisits] = useState<CloudAppVisits | null>(null);
  useEffect(() => {
    let live = true;
    setVisits(null);
    omgFetch(`/api/cloud/apps/stats?slug=${encodeURIComponent(slug)}&days=7`, undefined, { background: true })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: CloudAppVisits | null) => {
        if (live && body && typeof body.enabled === "boolean") setVisits(body);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [slug]);
  return visits;
}

function AppVisits({ slug }: { slug: string }) {
  const visits = useAppVisits(slug);
  if (!visits) return null;
  if (!visits.enabled) {
    return (
      <a href={consoleAppUrl(slug)} target="_blank" rel="noreferrer"
        className="mt-3 block rounded-xl bg-secondary px-3 py-2.5 text-[13px] text-muted-foreground">
        Visit counts are off. Turn them on in Settings.
      </a>
    );
  }
  const change = visits.visitors - visits.previousVisitors;
  const tile = "rounded-xl bg-secondary px-3 py-2.5";
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      <div className={tile}>
        <div className="text-[20px] font-bold leading-tight tabular-nums">{visits.visitors.toLocaleString()}</div>
        <div className="text-[12px] text-muted-foreground">
          visitors · {visits.days}d
          {change !== 0 ? (
            <span className={cn("ml-1 font-medium", change > 0 ? "text-emerald-600" : "text-muted-foreground")}>
              {change > 0 ? "+" : "−"}{Math.abs(change).toLocaleString()}
            </span>
          ) : null}
        </div>
      </div>
      <div className={tile}>
        <div className="text-[20px] font-bold leading-tight tabular-nums">{visits.pageviews.toLocaleString()}</div>
        <div className="text-[12px] text-muted-foreground">page views · {visits.days}d</div>
      </div>
    </div>
  );
}

function AppIcon<S extends SessionLike>({ item, large = false }: { item: AppItem<S>; large?: boolean }) {
  const box = large ? "size-[52px] rounded-[14px]" : "size-11 rounded-xl";
  const Glyph = item.kind === "game" ? Gamepad2 : Smartphone;
  // The icon omg.dev keeps for the app, else the published site's own
  // favicon.ico, else the app or game mark. favicon.svg is skipped: the app
  // template ships the same default logo in every app. A missing file, or an
  // HTML page served in its place, fails to load and moves to the next one.
  const sources = useMemo(
    () => [item.iconUrl, faviconOf(item.link.url)].filter((src): src is string => !!src),
    [item.iconUrl, item.link.url],
  );
  const [failed, setFailed] = useState(0);
  useEffect(() => setFailed(0), [sources]);
  const src = sources[failed];
  return (
    <span className="relative shrink-0">
      {src ? (
        <img
          key={src}
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed((n) => n + 1)}
          className={cn(box, "block bg-muted object-cover")}
        />
      ) : (
        <span className={cn(box, "flex items-center justify-center", item.kind === "game" ? "bg-amber-500/12 text-amber-600" : "bg-sky-500/10 text-sky-600")}>
          <Glyph className={large ? "size-6" : "size-5"} aria-hidden="true" />
        </span>
      )}
      {/* An agent is working on it now. */}
      {item.sessions.some(isWorking) ? (
        <span className="absolute -right-1 -bottom-1 flex size-[18px] items-center justify-center rounded-full bg-card shadow-sm">
          <Spinner className="size-3 border-[1.5px]" />
        </span>
      ) : null}
    </span>
  );
}

function LiveDot({ live }: { live: boolean | null }) {
  // Unknown is not live: an older control plane does not send the field.
  if (live !== true) return null;
  return <span aria-hidden="true" className="mr-1.5 inline-block size-1.5 -translate-y-px rounded-full bg-emerald-500 align-middle" />;
}

function faviconOf(url: string): string | null {
  try {
    return new URL("/favicon.ico", url).href;
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function isWorking(session: SessionLike): boolean {
  const s = session as SessionLike & { busy?: boolean; launching?: boolean };
  return !!(s.busy || s.launching);
}

/**
 * Whether a session belongs to the app a folder scope links to: it runs in
 * that folder, or it is the session that built the app. The scoped list uses
 * this so an app's page never misses the session that built it.
 */
export function sessionInAppScope(
  session: { sessionId?: string | null; project?: string | null },
  projectFilter: string,
  builtBySessionId: string | null | undefined,
): boolean {
  return session.project === projectFilter || (!!builtBySessionId && session.sessionId === builtBySessionId);
}

/** The app whose folder is the current project filter, if it is one. */
export function useScopedApp<S extends SessionLike, R extends RepoLike>(
  projectFilter: string,
  repos: readonly R[],
  sessions: readonly S[],
  projectOf: (repo: R) => string,
): AppItem<S> | null {
  const linked = useMemo(
    () => repos.filter((repo) => repo.deploy && projectOf(repo) === projectFilter),
    [repos, projectFilter, projectOf],
  );
  const cloud = useCloudApps(linked.length > 0);
  return useMemo(() => {
    if (!linked.length) return null;
    const { games, apps } = buildAppItems(linked, sessions, cloud, projectOf);
    return games[0] ?? apps[0] ?? null;
  }, [linked, sessions, cloud, projectOf]);
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
  // While Create shows, the phone header drops its own background so the
  // backdrop runs under it (html.lfg-create-view in index.css).
  useLayoutEffect(() => {
    document.documentElement.classList.add("lfg-create-view");
    return () => document.documentElement.classList.remove("lfg-create-view");
  }, []);
  // The heading and the tutorials, centred in the space between the header and
  // the docked chat box.
  return (
    <div
      className="flex flex-col justify-center px-2 pb-4"
      // The visible height less the header and the docked chat box: main's own
      // padding reserves the chat box with the same variable.
      style={{ minHeight: "calc(var(--lfg-app-height, 100dvh) - var(--lfg-mobile-header-height, 0px) - var(--lfg-inline-composer-height, var(--lfg-composer-clear, 6rem)))" }}
    >
      <CreateBackdrop />
      <div className="relative z-[1]">
        <h1 className="px-3 pb-2 text-[22px] font-bold leading-tight tracking-[-0.02em]">What do you want to make?</h1>
        <CreateTutorials />
      </div>
    </div>
  );
}

/**
 * Decoration only: three soft color clouds that drift slowly behind the Create
 * page. Gradients moved by transform, so the browser only composites them.
 * Still for people who ask for reduced motion.
 */
function CreateBackdrop() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden opacity-75 dark:opacity-70"
      style={{
        maskImage: "linear-gradient(to bottom, black 0, black 70%, transparent 100%)",
        WebkitMaskImage: "linear-gradient(to bottom, black 0, black 70%, transparent 100%)",
      }}
    >
      <span className="lfg-create-cloud lfg-create-cloud-a" />
      <span className="lfg-create-cloud lfg-create-cloud-b" />
      <span className="lfg-create-cloud lfg-create-cloud-c" />
    </div>
  );
}
