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
import { Loader2, MousePointer2, Power, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
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

export function ComputerPage({ active, onClose }: { active: boolean; onClose?: () => void }) {
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


  const deps = status?.deps;
  const running = !!status?.running;

  return (
    // Full bleed: the screen is the page. No title, no chrome, no padding --
    // every pixel spent on framing is a pixel not spent on the desktop.
    <div className="relative h-full min-h-0 w-full overflow-hidden bg-[#0b0b0d]">
      {/* touch-none is load-bearing on mobile: noVNC's GestureHandler needs the
          raw touch stream. Without it the browser claims the gestures for page
          panning and zooming, and the desktop appears to ignore every touch.
          select-none stops long-press from raising the text-selection callout
          over the canvas, which otherwise eats the right-click gesture. */}
      <div
        ref={screenRef}
        className="absolute inset-0 touch-none select-none [-webkit-touch-callout:none] [overscroll-behavior:none]"
      />

      {/* Controls float over the screen, top right, rather than occupying a
          header band. Stop is gone on purpose: leaving the page is how you
          stop watching, and the desktop deliberately keeps running so an
          agent's work survives you closing the tab. */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
        {running ? (
          <>
            <Button
              variant={viewOnly ? "secondary" : "default"}
              size="sm"
              className="shadow-lg"
              onClick={() => setViewOnly((v) => !v)}
            >
              <MousePointer2 className="mr-1.5 size-3.5" />
              {viewOnly ? "Take control" : "Controlling"}
            </Button>
            <Button
              variant="secondary"
              size="icon-sm"
              className="shadow-lg"
              onClick={() => {
                disconnect();
                void connect();
              }}
              aria-label="Reconnect"
              title="Reconnect"
            >
              <RotateCcw className="size-3.5" />
            </Button>
          </>
        ) : null}
        {onClose ? (
          <Button
            variant="secondary"
            size="icon-sm"
            className="shadow-lg"
            onClick={onClose}
            aria-label="Close the computer"
            title="Close"
          >
            <X className="size-4" />
          </Button>
        ) : null}
      </div>

      {/* Connecting covers a real gap: the desktop can be up while the RFB
          handshake is still running, so without this the page is just black
          and reads as broken. */}
      {running && phase !== "live" && !error ? (
        <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
          <div className="flex items-center gap-2 rounded-full bg-card/90 px-4 py-2 text-sm shadow-lg backdrop-blur">
            <Loader2 className="size-4 animate-spin" />
            {phase === "starting" ? "Starting the computer…" : "Connecting to the screen…"}
          </div>
        </div>
      ) : null}

      {/* Everything below only appears when there is no picture to show. */}
      {!running || error || (deps && !deps.ok) ? (
        <div className="absolute inset-0 z-[5] flex items-center justify-center p-6">
          <div className="w-full max-w-md space-y-3 rounded-2xl border border-border bg-card/90 p-5 text-center backdrop-blur">
            {deps && !deps.ok ? (
              <>
                <p className="text-sm font-medium">The computer needs a few packages.</p>
                <p className="text-xs text-muted-foreground">Missing: {deps.missing.join(", ")}</p>
                <pre className="overflow-x-auto rounded bg-muted p-2 text-left text-xs">
                  {deps.hint}
                </pre>
              </>
            ) : error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Start the computer to open a desktop with a browser the agent can drive.
              </p>
            )}
            {!running ? (
              <Button disabled={phase === "starting" || deps?.ok === false} onClick={() => void start()}>
                {phase === "starting" ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <Power className="mr-1.5 size-4" />
                )}
                Start the computer
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ComputerPage;
