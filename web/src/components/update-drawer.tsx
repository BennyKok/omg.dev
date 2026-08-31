// The "What's new" update drawer: a quiet nudge (settings row + nav badge)
// that opens a drawer showing the CHANGELOG delta since the installed
// release, with Update / Skip actions. One provider owns the single
// /api/install poll and the drawer's own mount, same shape as AskProvider in
// ask-center.tsx:
//   • <UpdateProvider/>    — the fetch + skip persistence + drawer mount
//   • useUpdateStatus()    — read status / open the drawer from anywhere
//   • <UpdateSettingsRow/> — the Settings > System row (was OmgUpdateSection)
//   • <UpdateNavButton/>   — quiet nav-island dot; opens the drawer directly

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowDown, CheckCircle2, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { MessageResponse } from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";
import { api } from "@/lib/omg-client";
import { toast } from "@/lib/notify";
import {
  isInstallUpdateInfo,
  shouldShowUpdateNudge,
  updateIdentifier,
  type ChangelogEntry,
  type InstallUpdateInfo,
  type InstallUpdateStatus,
} from "@/lib/install-update";
import {
  INITIAL_UPDATE_FLOW_STATE,
  apiErrorStatus,
  updateFlowReducer,
} from "@/lib/update-flow";

type UpdateSettings = { skippedUpdateVersion: string };

type UpdateContextValue = {
  info: InstallUpdateInfo | null;
  status: InstallUpdateStatus | null;
  channel: InstallUpdateInfo["install"]["channel"] | undefined;
  updateCommand: string | undefined;
  changelog: ChangelogEntry[];
  checking: boolean;
  error: string | null;
  refresh: (force?: boolean) => Promise<void>;
  latestId: string | null;
  nudgeVisible: boolean;
  drawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  skip: () => Promise<void>;
};

const UpdateContext = createContext<UpdateContextValue | null>(null);

export function useUpdateStatus(): UpdateContextValue {
  const ctx = useContext(UpdateContext);
  if (!ctx) throw new Error("useUpdateStatus must be used within <UpdateProvider>");
  return ctx;
}

export function UpdateProvider({
  settings,
  onSettingsChange,
  children,
}: {
  settings: UpdateSettings;
  onSettingsChange: (patch: UpdateSettings) => Promise<void>;
  children: ReactNode;
}) {
  const [info, setInfo] = useState<InstallUpdateInfo | null>(null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const refresh = useCallback(async (force = false) => {
    setChecking(true);
    setError(null);
    try {
      // A manual click forces a fresh lookup that bypasses the server-side
      // release-tag (and changelog) cache; the passive on-mount check reuses it.
      const path = force ? "/api/install?refresh=1" : "/api/install";
      const next = await api<unknown>(path, { cache: "no-store" });
      if (!isInstallUpdateInfo(next)) throw new Error("Could not check for updates");
      setInfo(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not check for updates");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const status = info?.update ?? null;
  const latestId = updateIdentifier(status);
  const nudgeVisible = shouldShowUpdateNudge(status, settings.skippedUpdateVersion);

  const skip = useCallback(async () => {
    if (latestId) {
      try {
        await onSettingsChange({ skippedUpdateVersion: latestId });
      } catch {
        toast.error("Could not save — the update will keep nudging you");
      }
    }
    setDrawerOpen(false);
  }, [latestId, onSettingsChange]);

  const value: UpdateContextValue = {
    info,
    status,
    channel: info?.install?.channel,
    updateCommand: info?.install?.updateCommand,
    changelog: info?.changelog ?? [],
    checking,
    error,
    refresh,
    latestId,
    nudgeVisible,
    drawerOpen,
    openDrawer: () => setDrawerOpen(true),
    closeDrawer: () => setDrawerOpen(false),
    skip,
  };

  return (
    <UpdateContext.Provider value={value}>
      {children}
      <UpdateDrawer />
    </UpdateContext.Provider>
  );
}

// Quiet nav-island badge — same shape as AskNavButton, but a bare dot rather
// than a count: an update either is or isn't available, there's nothing to
// count. Opens the drawer directly; never renders when there's nothing to see.
export function UpdateNavButton() {
  const { nudgeVisible, openDrawer } = useUpdateStatus();
  if (!nudgeVisible) return null;
  return (
    <button
      type="button"
      onClick={openDrawer}
      aria-label="Update available"
      title="Update available"
      className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary transition-colors duration-200 ease-out active:scale-[0.96]"
    >
      <ArrowDown className="size-[18px]" />
      <span
        className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-primary ring-2 ring-background"
        aria-hidden
      />
    </button>
  );
}

// The Settings > System row. Same row that has always lived here — now it
// reads shared state instead of polling on its own, wears a quiet dot when
// there's something to see, and hands the actual update flow to the drawer
// instead of running it inline.
export function UpdateSettingsRow() {
  const { status, channel, updateCommand, checking, error, refresh, nudgeVisible, openDrawer } =
    useUpdateStatus();

  // Both states are actionable: `available` needs a download, `staged` needs
  // only the restart that applies bits already on disk.
  const available = status?.state === "available" || status?.state === "staged";
  const supported = channel === "source" || channel === "release";
  const blockedReason = available && !status.restartSupported
    ? `${status.restartBlockedReason ?? "Automatic restart is unavailable on this install."}${
      updateCommand ? ` Update from a terminal instead: ${updateCommand}` : ""
    }`
    : null;
  const detail = error
    ?? blockedReason
    ?? (checking
      ? "Checking for updates…"
      : status?.message
        ?? (channel && updateCommand
          ? `Updates for ${channel} installs use: ${updateCommand}`
          : ""));

  return (
    // A bare row, not a card. It sits inside the Computer card next to the
    // Frontend and Computer version rows, because those three answer one
    // question between them: what is running here, and is there anything
    // newer. As its own card with its own header it read as unrelated
    // machinery parked below the versions it is about.
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-primary text-white">
              {checking ? <Loader2 className="size-4 animate-spin" /> : <ArrowDown className="size-4" />}
              {nudgeVisible ? (
                <span
                  className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-primary ring-2 ring-card"
                  aria-hidden
                />
              ) : null}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-medium">Updates</div>
              {/* Only when it says something you can act on. The resting
                  message restated the channel, which the version rows above
                  already imply. */}
              {error || blockedReason || checking || available ? (
                <div
                  className={cn(
                    "text-xs text-muted-foreground",
                    error || blockedReason ? "text-pretty" : "truncate",
                    error && "text-destructive",
                  )}
                >
                  {detail}
                </div>
              ) : null}
            </div>
          </div>
          {available ? (
            <Button size="sm" onClick={openDrawer}>
              <ArrowDown className="size-4" />
              Update
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => void refresh(true)} disabled={checking || !supported}>
              <RotateCcw className={cn("size-4", checking && "animate-spin")} />
              Check
            </Button>
          )}
    </div>
  );
}

function versionTransition(status: InstallUpdateStatus | null): string {
  if (!status) return "";
  if (status.channel === "release") {
    if (status.currentVersion && status.latestVersion) return `${status.currentVersion} → ${status.latestVersion}`;
    return status.latestVersion ?? "";
  }
  if (status.currentSha && status.latestSha) return `${status.currentSha.slice(0, 7)} → ${status.latestSha.slice(0, 7)}`;
  return "";
}

const RESTART_POLL_TIMEOUT_MS = 60_000;
const RESTART_POLL_INTERVAL_MS = 1_000;

function UpdateDrawer() {
  const { drawerOpen, closeDrawer, info, status, channel, updateCommand, changelog, refresh, skip } =
    useUpdateStatus();
  const [flow, dispatch] = useReducer(updateFlowReducer, INITIAL_UPDATE_FLOW_STATE);
  const bootIdAtOpen = useRef<string>("");

  const busy = flow.phase === "updating" || flow.phase === "restarting";
  const canSelfUpdate = (channel === "source" || channel === "release") && !!status?.restartSupported;

  const handleOpenChange = useCallback((next: boolean) => {
    if (next) return;
    if (busy) return; // don't let a scrim tap or Escape interrupt an in-flight update
    closeDrawer();
    dispatch({ type: "retry" });
  }, [busy, closeDrawer]);

  useEffect(() => {
    if (drawerOpen) bootIdAtOpen.current = info?.bootId ?? "";
  }, [drawerOpen, info?.bootId]);

  const runUpdate = useCallback(async () => {
    dispatch({ type: "start" });
    try {
      const result = await api<unknown>("/api/install", { method: "POST" });
      if (!isInstallUpdateInfo(result)) throw new Error("Could not update omg.dev");
      dispatch({ type: "post-ok", restarting: !!result.restarting, bootId: result.bootId });
    } catch (e) {
      if (apiErrorStatus(e) === 409) {
        dispatch({ type: "post-conflict", bootId: bootIdAtOpen.current });
      } else {
        dispatch({ type: "post-error", message: e instanceof Error ? e.message : "Could not update omg.dev" });
      }
    }
  }, []);

  // Poll for the boot id to change while a restart (ours or someone else's,
  // in the 409 case) is in flight.
  useEffect(() => {
    if (flow.phase !== "restarting") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + RESTART_POLL_TIMEOUT_MS;

    const poll = async () => {
      if (cancelled) return;
      if (Date.now() > deadline) {
        dispatch({ type: "poll-timeout" });
        return;
      }
      try {
        const ready = await api<{ bootId: string }>("/api/install?ready=1", { cache: "no-store" });
        if (!cancelled) dispatch({ type: "boot-id", bootId: ready.bootId });
      } catch {
        // Transient — the box may be mid-restart and refusing connections.
      }
      if (!cancelled) timer = setTimeout(poll, RESTART_POLL_INTERVAL_MS);
    };
    // Give the successful response time to reach the browser before systemd
    // or launchd swaps the process; skip the wait when joining an update that
    // was already running elsewhere.
    timer = setTimeout(poll, flow.alreadyRunning ? 500 : 2_500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [flow.phase]);

  // Confirmed: refresh the shared status, show it briefly, then close.
  useEffect(() => {
    if (flow.phase !== "confirmed") return;
    let cancelled = false;
    void refresh();
    const timer = setTimeout(() => {
      if (cancelled) return;
      closeDrawer();
      dispatch({ type: "retry" });
    }, 1_500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.phase]);

  const handleSkip = useCallback(() => {
    void skip();
    dispatch({ type: "retry" });
  }, [skip]);

  // The button's own label already carries Update → Updating… → Restarting…;
  // this line only has something to say once that's not true — the 409 case
  // (someone else is already applying it) and a failure's reason.
  const statusLine = flow.phase === "restarting" && flow.alreadyRunning
    ? "Already updating…"
    : flow.phase === "failed"
      ? flow.message
      : null;

  return (
    <Drawer open={drawerOpen} onOpenChange={handleOpenChange} shouldScaleBackground={false}>
      <DrawerContent className="mx-auto flex max-h-[80dvh] w-full max-w-lg flex-col overflow-hidden">
        {/* flex-auto keeps short changelogs content-sized, then shrinks the body
            into a scroller before the actions can leave the viewport. */}
        <div className="flex min-h-0 flex-auto flex-col overflow-hidden">
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border/70 pb-3">
            <div className="min-w-0">
              <DrawerTitle>What's new</DrawerTitle>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{versionTransition(status)}</p>
            </div>
            {busy ? null : (
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                aria-label="Close"
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground transition hover:text-foreground active:scale-95"
              >
                <X className="size-3.5" />
              </button>
            )}
          </header>

          <div className="min-h-0 flex-auto overflow-y-auto py-3">
            {flow.phase === "confirmed" ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <CheckCircle2 className="size-6 text-emerald-500" />
                Up to date
              </div>
            ) : changelog.length ? (
              <div className="space-y-4">
                {changelog.map((entry) => (
                  <article key={entry.version} className="space-y-1">
                    <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">v{entry.version}</span>
                      <span>{entry.date}</span>
                    </div>
                    <div className="markdown text-sm">
                      <MessageResponse>{entry.bodyMarkdown}</MessageResponse>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {status?.latestVersion
                  ? `Version ${status.latestVersion} is available.`
                  : status?.latestSha
                    ? `${status.latestSha.slice(0, 7)} is available.`
                    : status?.message}
              </p>
            )}
          </div>

          {flow.phase === "confirmed" ? null : (
            <div className="mt-auto flex shrink-0 items-center justify-between gap-2 border-t border-border/70 pt-3">
              <span className={cn("min-w-0 truncate text-xs text-muted-foreground", flow.phase === "failed" && "text-destructive")}>
                {statusLine}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                {flow.phase === "failed" ? (
                  <>
                    <Button size="sm" variant="outline" onClick={handleSkip}>Skip</Button>
                    <Button size="sm" onClick={() => void runUpdate()}>Retry</Button>
                  </>
                ) : !canSelfUpdate ? (
                  <>
                    <Button size="sm" variant="outline" onClick={handleSkip}>Skip</Button>
                    {updateCommand ? (
                      <code className="max-w-[16rem] truncate rounded-lg bg-muted px-2 py-1.5 text-xs" title={updateCommand}>
                        {updateCommand}
                      </code>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="outline" onClick={handleSkip} disabled={busy}>Skip</Button>
                    <Button size="sm" onClick={() => void runUpdate()} disabled={busy}>
                      {busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowDown className="size-4" />}
                      {flow.phase === "updating" ? "Updating…" : flow.phase === "restarting" ? "Restarting…" : "Update"}
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
