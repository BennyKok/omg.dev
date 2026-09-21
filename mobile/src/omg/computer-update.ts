/**
 * The connected computer's software version, and the one button that changes it.
 *
 * `/api/install` on the box owns both (see `src/commands/serve.ts`): GET reports
 * the version actually running and whether a newer one is available, POST
 * applies it and restarts the service. The web Settings row reads the same
 * route (`web/src/lib/install-update.ts`). This is a second READER, not a
 * second update mechanism, and `omg update` on the box is a third reader of the
 * same path — so there is nothing here to drift out of step.
 *
 * Only the fields this row draws are typed. A 200 that is not this payload —
 * an intermediary's empty body, HTML from a host proxy, a demo transport
 * answering `{}` for a path it does not know — must leave the row absent
 * rather than throw. That is the bug the web copy documents: optional chaining
 * stopped at the outer object, and reading `.channel` through a missing
 * `install` took the whole router down.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { OmgTransport } from "@omg-dev/client";

/** `staged` means the bits are on disk and the running process predates them, so the action is a restart, not a download. */
export type ComputerUpdateState = "up-to-date" | "available" | "staged" | "blocked";

export type ComputerInstall = {
  /** `container` and `unknown` cannot be updated in place; the box says so and we show no button. */
  channel: "source" | "release" | "container" | "unknown";
  update: {
    state: ComputerUpdateState;
    message: string;
    /** The version running now, never the one on disk. Absent on a source checkout with no release tag. */
    currentVersion?: string;
    latestVersion?: string;
    restartSupported: boolean;
    /** The box's own diagnosis of why the button cannot work. Shown verbatim. */
    restartBlockedReason?: string;
  } | null;
};

function readInstall(value: unknown): ComputerInstall | null {
  if (!value || typeof value !== "object") return null;
  const install = (value as { install?: unknown }).install;
  if (!install || typeof install !== "object") return null;
  const channel = (install as { channel?: unknown }).channel;
  if (channel !== "source" && channel !== "release" && channel !== "container" && channel !== "unknown") {
    return null;
  }
  const raw = (value as { update?: unknown }).update;
  if (!raw || typeof raw !== "object") return { channel, update: null };
  const rec = raw as Record<string, unknown>;
  const state = rec.state;
  if (state !== "up-to-date" && state !== "available" && state !== "staged" && state !== "blocked") {
    return { channel, update: null };
  }
  return {
    channel,
    update: {
      state,
      message: typeof rec.message === "string" ? rec.message : "",
      currentVersion: typeof rec.currentVersion === "string" ? rec.currentVersion : undefined,
      latestVersion: typeof rec.latestVersion === "string" ? rec.latestVersion : undefined,
      restartSupported: rec.restartSupported === true,
      restartBlockedReason:
        typeof rec.restartBlockedReason === "string" ? rec.restartBlockedReason : undefined,
    },
  };
}

/**
 * One line for the row's subtitle. The version is the fact worth showing even
 * when there is nothing to do, so it leads; the box's own message is used only
 * when it has no version to name.
 */
export function describeInstall(install: ComputerInstall | null): string | null {
  if (!install) return null;
  const update = install.update;
  if (!update) return install.channel === "source" ? "Git checkout" : null;
  const current = update.currentVersion;
  if (update.state === "available" && update.latestVersion) {
    return current ? `${current} · ${update.latestVersion} available` : `${update.latestVersion} available`;
  }
  if (update.state === "staged") {
    return current ? `${current} · restart to finish` : "Restart to finish updating";
  }
  if (update.state === "blocked") return update.message || "Cannot update";
  return current ? `${current} · up to date` : update.message || null;
}

/** Applying is possible only when there is something to apply and the box says it can restart itself. */
export function canApply(install: ComputerInstall | null): boolean {
  const update = install?.update;
  if (!update || !update.restartSupported) return false;
  return update.state === "available" || update.state === "staged";
}

const RESTART_POLL_MS = 3000;
const RESTART_POLL_LIMIT = 12;

export function useComputerUpdate(transport: OmgTransport | null) {
  const [install, setInstall] = useState<ComputerInstall | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A restart poll must not outlive the screen, and a second one must not
  // start while the first is running.
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const read = useCallback(async (refresh: boolean) => {
    if (!transport) return null;
    const answer = await transport.request<unknown>(
      refresh ? "/api/install?refresh=1" : "/api/install",
    );
    return readInstall(answer);
  }, [transport]);

  const check = useCallback(async (refresh = false) => {
    if (!transport) return;
    setLoading(true);
    setError(null);
    try {
      const next = await read(refresh);
      if (alive.current) setInstall(next);
    } catch {
      // A box that cannot answer is not an error worth a red line in Settings;
      // the row simply has no version to show. The reconnect state elsewhere
      // already says the computer is unreachable.
      if (alive.current) setInstall(null);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [transport, read]);

  useEffect(() => { void check(false); }, [check]);

  const apply = useCallback(async () => {
    if (!transport || busy) return;
    setBusy(true);
    setError(null);
    try {
      const answer = await transport.request<unknown>("/api/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!alive.current) return;
      setInstall(readInstall(answer) ?? install);
      const willRestart = !!(answer && typeof answer === "object"
        && (answer as { restarting?: unknown }).restarting === true);
      if (!willRestart) {
        await check(false);
        return;
      }
      // The service is going down and coming back. It does NOT take running
      // agent sessions with it — the unit sets KillMode=process precisely so
      // managed children and native TUI panes survive — so this is a safe
      // button, not a destructive one. Poll until it answers again.
      setRestarting(true);
      for (let attempt = 0; attempt < RESTART_POLL_LIMIT; attempt++) {
        await new Promise(resolve => setTimeout(resolve, RESTART_POLL_MS));
        if (!alive.current) return;
        try {
          const next = await read(false);
          if (!alive.current) return;
          if (next) {
            setInstall(next);
            if (next.update?.state !== "staged") break;
          }
        } catch {
          // Still down. Keep waiting.
        }
      }
    } catch (failure) {
      if (alive.current) {
        setError(failure instanceof Error ? failure.message : String(failure));
      }
    } finally {
      if (alive.current) {
        setBusy(false);
        setRestarting(false);
      }
    }
  }, [transport, busy, install, check, read]);

  return { install, loading, busy, restarting, error, check, apply };
}
