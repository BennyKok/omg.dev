import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Plug, TerminalSquare } from "lucide-react";

import { Switch } from "@/components/ui/switch";

/** Mirrors the payload of GET /api/executor/status. */
export type ExecutorStatusInfo = {
  enabled: boolean;
  installed: boolean;
  binary: string | null;
  installCommand: string;
  running: boolean;
  origin: string | null;
  pid: number | null;
  startedAt: number | null;
  error: string | null;
};

// Polled while the card is on screen. A start takes seconds and the card
// should turn from "Starting" to "Running" without a reload.
const POLL_MS = 5_000;

function describe(status: ExecutorStatusInfo): string {
  if (!status.enabled) return "Off. Agents cannot reach any connector.";
  if (!status.installed) return "Not installed on this computer.";
  if (status.running) return `Running at ${status.origin ?? "127.0.0.1"}. Agents reach it at /mcp/executor.`;
  if (status.error) return status.error;
  return "Starting.";
}

/**
 * The Settings card for the connector gateway (Executor).
 *
 * One switch, one status line, and the dashboard link. Connections, policies
 * and approvals are edited in Executor's own UI, which opens in a new tab
 * already signed in; this card does not duplicate any of that.
 */
export function ExecutorSettingsSection({
  enabled,
  onEnabledChange,
}: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => Promise<void>;
}) {
  const [status, setStatus] = useState<ExecutorStatusInfo | null>(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await fetch("/api/executor/status", { credentials: "same-origin", signal });
      if (!response.ok) throw new Error(`status ${response.status}`);
      setStatus((await response.json()) as ExecutorStatusInfo);
    } catch {
      // An older server has no gateway. Leave the card hidden rather than
      // presenting a switch that cannot do anything.
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const timer = window.setInterval(() => void refresh(controller.signal), POLL_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [refresh, enabled]);

  const openDashboard = useCallback(async () => {
    setOpening(true);
    setOpenError(null);
    // Open the tab before the await: browsers block window.open once the
    // click is no longer the current task.
    const tab = window.open("", "_blank");
    try {
      const response = await fetch("/api/executor/dashboard", { credentials: "same-origin" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `status ${response.status}`);
      }
      const { url } = (await response.json()) as { url: string };
      if (tab) tab.location.href = url;
      else window.open(url, "_blank", "noopener");
    } catch (e) {
      tab?.close();
      setOpenError(e instanceof Error ? e.message : "could not open the dashboard");
    } finally {
      setOpening(false);
    }
  }, []);

  if (!status) return null;

  return (
    <section className="space-y-2" aria-labelledby="connectors-heading">
      <h2 id="connectors-heading" className="px-4 text-xs font-semibold text-muted-foreground">
        Connectors
      </h2>
      <div className="overflow-hidden rounded-2xl border border-border bg-card/40 divide-y divide-border">
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-[7px] bg-foreground text-background">
              <Plug className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-medium">
                Connector gateway
                {status.enabled && status.running ? (
                  <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
                    Running
                  </span>
                ) : null}
              </span>
              <span className="block text-xs text-muted-foreground">{describe(status)}</span>
            </span>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(next) => void onEnabledChange(next)}
            aria-label={enabled ? "Disable the connector gateway" : "Enable the connector gateway"}
          />
        </div>

        {status.enabled && !status.installed ? (
          <div className="space-y-2 px-4 py-3">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-background/50 px-3 py-2">
              <TerminalSquare className="size-4 shrink-0 text-muted-foreground" />
              <code className="min-w-0 flex-1 truncate text-xs">{status.installCommand}</code>
            </div>
            <p className="px-1 text-xs leading-relaxed text-muted-foreground">
              Run this once on this computer, then the gateway starts on its own.
            </p>
          </div>
        ) : null}

        {status.enabled && status.running ? (
          <div className="space-y-2 px-4 py-3">
            <button
              type="button"
              onClick={() => void openDashboard()}
              disabled={opening}
              className="flex w-full items-center justify-between gap-4 rounded-xl border border-border bg-background/50 px-3 py-2 text-left text-sm hover:bg-foreground/[0.03] disabled:opacity-60"
            >
              <span>
                <span className="block font-medium">Open dashboard</span>
                <span className="block text-xs text-muted-foreground">
                  Add integrations, sign in to services, set per-tool policies and approve calls.
                </span>
              </span>
              <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
            </button>
            {openError ? <p className="px-1 text-xs text-destructive">{openError}</p> : null}
            <p className="px-1 text-xs leading-relaxed text-muted-foreground">
              The dashboard is served on this computer only. Open it from a browser on this machine.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
