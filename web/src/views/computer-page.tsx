// The Computer: this box's desktop, streamed here and controllable.
//
// The screen is a real X display running a window manager, a browser and
// whatever else is open on it -- not a browser viewport. That is the difference
// between "the agent can drive a page" and "I can watch and take over the
// machine". You get the pointer and the keyboard; the agent drives the browser
// on the same screen, so both of you are looking at one desktop.
//
// The pixels arrive as RFB over a websocket (see src/computer/rfb-bridge.ts),
// rendered by noVNC. This page is lazily loaded -- noVNC is not on the path to
// first paint, and most sessions never open the Computer at all.
import { useCallback, useEffect, useRef, useState } from "react";
import RFB from "@novnc/novnc";
import { Loader2, Monitor, MousePointer2, Power, RotateCcw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { omgFetch, openOmgSocket } from "@/lib/omg-client";
import { RfbChannel } from "@/lib/rfb-channel";

interface DepReport {
  ok: boolean;
  missing: string[];
  hint: string;
}

interface ComputerStatus {
  running: boolean;
  display: string | null;
  rfbPort: number | null;
  cdpPort: number | null;
  width: number;
  height: number;
  startedAt: number | null;
  holder: string | null;
  deps: DepReport;
}

type Phase = "idle" | "starting" | "connecting" | "live" | "stopping";

export function ComputerPage({ active }: { active: boolean }) {
  const [status, setStatus] = useState<ComputerStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  // Read-only is the safe default for a shared screen: opening the tab should
  // not let a stray click land on whatever the agent is doing mid-task.
  const [viewOnly, setViewOnly] = useState(true);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<RFB | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await omgFetch("/api/computer/status");
      if (!res.ok) return;
      setStatus((await res.json()) as ComputerStatus);
    } catch {
      // A failed poll is not worth surfacing; the next tick will retry.
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void refresh();
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [active, refresh]);

  // Tear the RFB connection down whenever we leave the tab. The desktop keeps
  // running on the box, so coming back reattaches to the same screen with the
  // same windows open rather than restarting anything.
  const disconnect = useCallback(() => {
    try {
      rfbRef.current?.disconnect();
    } catch {}
    rfbRef.current = null;
  }, []);

  const connect = useCallback(async () => {
    if (rfbRef.current || !screenRef.current) return;
    setPhase("connecting");
    setError(null);
    try {
      const socket = await openOmgSocket("/api/computer");
      const rfb = new RFB(screenRef.current, new RfbChannel(socket) as unknown as object, {
        shared: true,
      });
      rfb.scaleViewport = true;
      rfb.background = "#0b0b0d";
      rfb.viewOnly = viewOnly;
      rfb.addEventListener("connect", () => setPhase("live"));
      rfb.addEventListener("disconnect", () => {
        rfbRef.current = null;
        setPhase("idle");
      });
      rfbRef.current = rfb;
    } catch (e) {
      setPhase("idle");
      setError(e instanceof Error ? e.message : "could not open the screen");
    }
  }, [viewOnly]);

  // Keep the live connection's input mode in sync with the toggle.
  useEffect(() => {
    if (rfbRef.current) rfbRef.current.viewOnly = viewOnly;
  }, [viewOnly]);

  // Connect once the desktop is up and this tab is on screen.
  useEffect(() => {
    if (!active) {
      disconnect();
      return;
    }
    if (status?.running && !rfbRef.current) void connect();
  }, [active, status?.running, connect, disconnect]);

  useEffect(() => disconnect, [disconnect]);

  const start = async () => {
    setPhase("starting");
    setError(null);
    try {
      const res = await omgFetch("/api/computer/start", { method: "POST" });
      if (!res.ok) throw new Error((await res.text()) || "failed to start");
      setStatus((await res.json()) as ComputerStatus);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to start the computer");
      setPhase("idle");
    }
  };

  const stop = async () => {
    setPhase("stopping");
    disconnect();
    try {
      const res = await omgFetch("/api/computer/stop", { method: "POST" });
      if (res.ok) setStatus((await res.json()) as ComputerStatus);
    } finally {
      setPhase("idle");
    }
  };

  const deps = status?.deps;
  const running = !!status?.running;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-[7px] bg-foreground text-background">
            <Monitor className="size-4" />
          </span>
          <h1 className="text-sm font-semibold">Computer</h1>
        </div>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs",
            phase === "live"
              ? "bg-emerald-500/15 text-emerald-600"
              : "bg-muted text-muted-foreground",
          )}
        >
          {phase === "live"
            ? `live ${status?.width}x${status?.height}`
            : running
              ? phase
              : "stopped"}
        </span>
        {status?.holder ? (
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-600">
            held by {status.holder}
          </span>
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          {running ? (
            <>
              <Button
                variant={viewOnly ? "outline" : "default"}
                size="sm"
                onClick={() => setViewOnly((v) => !v)}
                title={viewOnly ? "Take control of the pointer and keyboard" : "Stop sending input"}
              >
                <MousePointer2 className="mr-1.5 size-3.5" />
                {viewOnly ? "Take control" : "Controlling"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => { disconnect(); void connect(); }}>
                <RotateCcw className="mr-1.5 size-3.5" />
                Reconnect
              </Button>
              <Button variant="outline" size="sm" onClick={() => void stop()}>
                <Square className="mr-1.5 size-3.5" />
                Stop
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={phase === "starting" || deps?.ok === false}
              onClick={() => void start()}
            >
              {phase === "starting" ? (
                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
              ) : (
                <Power className="mr-1.5 size-3.5" />
              )}
              Start the computer
            </Button>
          )}
        </div>
      </header>

      {deps && !deps.ok ? (
        <div className="rounded-lg border border-border bg-card/40 p-3 text-sm">
          <p className="font-medium">The computer needs a few packages.</p>
          <p className="mt-1 text-muted-foreground">
            Missing: {deps.missing.join(", ")}
          </p>
          <pre className="mt-2 overflow-x-auto rounded bg-muted p-2 text-xs">{deps.hint}</pre>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div
        ref={screenRef}
        className={cn(
          "min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-[#0b0b0d]",
          viewOnly ? "cursor-default" : "cursor-none",
        )}
      />

      <p className="text-xs text-muted-foreground">
        {running
          ? viewOnly
            ? "Watching. Take control to move the pointer and type."
            : "You have the pointer and keyboard. The agent drives the browser on this same screen."
          : "The computer is stopped. Starting it opens a desktop with a browser the agent can drive."}
      </p>
    </div>
  );
}

export default ComputerPage;
