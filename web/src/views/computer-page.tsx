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
import type React from "react";
import RFB from "@novnc/novnc";
import { Keyboard, Loader2, MousePointer2, Power, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  computerInspectionDraft,
  inspectionPngBlob,
  mergeComputerInspectionDraft,
  type ComputerInspectionResult,
} from "@/lib/computer-inspection-draft";
import { navigateComputerToInspectionTarget } from "@/lib/computer-inspection-navigation";
import { omgFetch, openOmgSocket } from "@/lib/omg-client";
import { readPromptDraft, stashPromptDraft } from "@/lib/prompt-stash";
import { RfbChannel } from "@/lib/rfb-channel";
import {
  ComputerInspectionControl,
  type ComputerInspectionSession,
} from "./computer-inspection-control";

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
  deps: DepReport;
  inspection?: {
    active: boolean;
    startedAt: number | null;
  };
}

type Phase = "idle" | "starting" | "connecting" | "live" | "stopping";

// noVNC 1.7 exposes these documented runtime properties, but the package's
// bundled declaration still omits two of them. Keep the compatibility cast at
// this narrow boundary instead of weakening the component's RFB ref type.
type RfbViewportControls = RFB & {
  clipViewport: boolean;
  dragViewport: boolean;
};

export function ComputerPage({
  active,
  onClose,
  inspectionSession = null,
  autoStartInspection = false,
  onInspectionReady,
  onInspectionCancelled,
}: {
  active: boolean;
  onClose?: () => void;
  inspectionSession?: ComputerInspectionSession | null;
  autoStartInspection?: boolean;
  onInspectionReady?: (sessionId: string) => void;
  onInspectionCancelled?: (sessionId: string) => void;
}) {
  const [status, setStatus] = useState<ComputerStatus | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [inspectionStarting, setInspectionStarting] = useState(false);
  // Read-only is the safe default for a shared screen: opening the tab should
  // not let a stray click land on whatever the agent is doing mid-task.
  const [viewOnly, setViewOnly] = useState(true);
  // Relative (trackpad) pointing for FINGERS ONLY -- never a decision the
  // person has to make.
  //
  // Absolute pointing is right for a mouse and wrong for a finger. With a
  // mouse the cursor is already separate from the hand, so pointing straight
  // at a target is exactly what you want. With a finger the target ends up
  // underneath your own hand, there is no hover to aim with, and a tap
  // teleports the cursor instead of moving it.
  //
  // So this follows the input device rather than a toggle. It starts from the
  // media query and then corrects on first use, because a device can have both
  // -- an iPad with a trackpad attached reports coarse until a real mouse
  // event arrives.
  const [trackpad, setTrackpad] = useState(
    typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches,
  );
  const screenRef = useRef<HTMLDivElement | null>(null);
  const rfbRef = useRef<RFB | null>(null);
  const keyboardRef = useRef<HTMLTextAreaElement | null>(null);
  // The virtual cursor, in client coordinates. noVNC reads clientX/clientY off
  // real mouse events, so we keep a position here and synthesize events at it.
  const cursorRef = useRef<{ x: number; y: number } | null>(null);
  const touchRef = useRef<{ x: number; y: number; moved: boolean; at: number } | null>(null);
  const autoStartedForRef = useRef<string | null>(null);

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
    const t = setInterval(() => void refresh(), 2000);
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
      const rfb = new RFB(
        screenRef.current,
        new RfbChannel(socket) as unknown as object,
        { shared: true },
      ) as RfbViewportControls;
      const panInspection = !!inspectionSession && trackpad;
      // A desktop shrunk to 374x234 was technically complete and practically
      // untappable in the user's phone recording. In finger-driven inspection
      // show the remote pixels at readable size: a drag pans the clipped
      // desktop and a tap still selects through noVNC's own gesture handler.
      rfb.scaleViewport = !panInspection;
      rfb.clipViewport = panInspection;
      rfb.dragViewport = panInspection;
      rfb.background = "#0b0b0d";
      // Without this the remote cursor can be invisible, which makes a relative
      // pointer impossible to aim.
      rfb.showDotCursor = true;
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
  }, [viewOnly, inspectionSession, trackpad]);

  useEffect(() => {
    const rfb = rfbRef.current as RfbViewportControls | null;
    if (!rfb) return;
    const panInspection = !!inspectionSession && trackpad;
    if (panInspection) {
      rfb.scaleViewport = false;
      rfb.clipViewport = true;
      rfb.dragViewport = true;
    } else {
      rfb.dragViewport = false;
      rfb.clipViewport = false;
      rfb.scaleViewport = true;
    }
  }, [inspectionSession, trackpad]);

  // Keep the live connection's input mode in sync with the toggle.
  useEffect(() => {
    if (rfbRef.current) rfbRef.current.viewOnly = viewOnly;
  }, [viewOnly]);

  // Opening the Computer means you want the computer. Pressing Start on an
  // empty black page is a step with no decision in it -- the only reason it
  // existed was that starting is slow, which a progress indicator solves
  // better than a button does. Guarded on `starting` so the status poll cannot
  // fire a second start while the first is still coming up.
  useEffect(() => {
    if (!active || !status || status.running) return;
    if (!status.deps.ok || phase === "starting" || error) return;
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, status?.running, status?.deps.ok, phase, error]);

  // Connect once the desktop is up and this tab is on screen.
  useEffect(() => {
    if (!active) {
      disconnect();
      return;
    }
    if (status?.running && !rfbRef.current) void connect();
  }, [active, status?.running, connect, disconnect]);

  useEffect(() => disconnect, [disconnect]);


  // noVNC translates ordinary DOM mouse events on its canvas into remote
  // pointer events, so we drive a virtual cursor by synthesizing them at a
  // position we control. This uses only public behaviour -- no reaching into
  // RFB internals -- and keeps noVNC as the single owner of the RFB protocol.
  const canvas = useCallback(
    () => screenRef.current?.querySelector("canvas") ?? null,
    [],
  );

  const emitMouse = useCallback(
    (type: "mousemove" | "mousedown" | "mouseup", buttons: number, button = 0) => {
      const c = canvas();
      const at = cursorRef.current;
      if (!c || !at) return;
      c.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: at.x,
          clientY: at.y,
          button,
          buttons,
        }),
      );
    },
    [canvas],
  );

  /** Move the virtual cursor by a delta, clamped to the visible screen. */
  const moveCursor = useCallback(
    (dx: number, dy: number) => {
      const c = canvas();
      if (!c) return;
      const box = c.getBoundingClientRect();
      const at = cursorRef.current ?? { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      cursorRef.current = {
        x: Math.min(box.right - 1, Math.max(box.left, at.x + dx)),
        y: Math.min(box.bottom - 1, Math.max(box.top, at.y + dy)),
      };
      emitMouse("mousemove", 0);
    },
    [canvas, emitMouse],
  );

  const clickAtCursor = useCallback(
    (button: 0 | 2) => {
      emitMouse("mousedown", button === 2 ? 2 : 1, button);
      emitMouse("mouseup", 0, button);
    },
    [emitMouse],
  );

  // Touch handling for trackpad mode, bound natively rather than through React.
  //
  // Two reasons it cannot be React's onTouch* props. React registers touch
  // listeners as PASSIVE, so preventDefault there is ignored -- and without it
  // the browser fires its compatibility mouse events (and a synthesized click,
  // and possibly a dblclick) a moment after each touchend. Those arrive while
  // the next finger is already down, which is what made a drag immediately
  // after a tap feel stuck: the browser was still resolving whether the first
  // tap was half of a double-tap.
  //
  // The overlay also sits above noVNC's canvas so its own gesture handler never
  // sees these. Two pointer models fighting over one finger is worse than
  // either alone.
  const overlayRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;

    const onStart = (e: TouchEvent) => {
      // Suppress the compatibility mouse/click/dblclick burst outright.
      e.preventDefault();
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      touchRef.current = { x: t.clientX, y: t.clientY, moved: false, at: Date.now() };
    };

    const onMove = (e: TouchEvent) => {
      e.preventDefault();
      const prev = touchRef.current;
      if (!prev || e.touches.length !== 1) return;
      const t = e.touches[0];
      const dx = t.clientX - prev.x;
      const dy = t.clientY - prev.y;
      // 3px of slop, so the tiny wobble of a real tap is not read as a drag.
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) prev.moved = true;
      // Mild acceleration: slow drags stay precise, fast ones cross the screen.
      const speed = Math.min(2.5, 1 + Math.hypot(dx, dy) / 12);
      moveCursor(dx * speed, dy * speed);
      prev.x = t.clientX;
      prev.y = t.clientY;
    };

    const onEnd = (e: TouchEvent) => {
      e.preventDefault();
      const prev = touchRef.current;
      touchRef.current = null;
      // A tap clicks WHERE THE CURSOR IS, not where the finger landed. That is
      // the whole point of relative pointing.
      if (prev && !prev.moved && Date.now() - prev.at < 400) clickAtCursor(0);
    };

    el.addEventListener("touchstart", onStart, { passive: false });
    el.addEventListener("touchmove", onMove, { passive: false });
    el.addEventListener("touchend", onEnd, { passive: false });
    el.addEventListener("touchcancel", onEnd, { passive: false });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
      el.removeEventListener("touchend", onEnd);
      el.removeEventListener("touchcancel", onEnd);
    };
  }, [moveCursor, clickAtCursor, status?.running, viewOnly, trackpad]);

  /** Raise the soft keyboard. A canvas cannot hold focus on iOS, so we focus a
   *  hidden field and forward what it receives. */
  const openKeyboard = useCallback(() => {
    setViewOnly(false);
    keyboardRef.current?.focus();
  }, []);

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

  const cancelInspection = async () => {
    try {
      const res = await omgFetch("/api/computer/browser/inspect/cancel", { method: "POST" });
      if (!res.ok) throw new Error((await res.text()) || "failed to cancel inspection");
      await refresh();
      if (inspectionSession) onInspectionCancelled?.(inspectionSession.sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to cancel inspection");
    }
  };

  const startInspection = async () => {
    const target = inspectionSession;
    if (!target) {
      setError("Open Design Mode from the session that should receive the element.");
      return;
    }

    setInspectionStarting(true);
    setError(null);
    // Pointing at the remote page is the purpose of this action. Make the RFB
    // bridge writable immediately as well as updating React state, so the first
    // click cannot be swallowed by the previous view-only mode.
    if (rfbRef.current) rfbRef.current.viewOnly = false;
    setViewOnly(false);

    try {
      // The shared Computer remembers its last global tab. Bind the source as
      // well as the destination: a session-provided URL must replace stale
      // browser state before the blocking element picker is armed.
      await navigateComputerToInspectionTarget(target.pageUrl);
      const response = await omgFetch("/api/computer/browser/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeoutMs: 120_000 }),
      });
      if (!response.ok) {
        throw new Error((await response.text()) || "element inspection failed");
      }
      const inspection = (await response.json()) as ComputerInspectionResult;
      if (inspection.status === "cancelled") {
        onInspectionCancelled?.(target.sessionId);
        return;
      }
      if (inspection.status !== "selected" || !inspection.selector) {
        throw new Error("the page returned no selected element");
      }

      let screenshotPath: string | undefined;
      if (inspection.screenshotBase64) {
        const filename = `computer-design-mode-${Date.now()}.png`;
        const uploaded = await omgFetch(
          `/api/sessions/${encodeURIComponent(target.sessionId)}/upload?filename=${encodeURIComponent(filename)}`,
          {
            method: "POST",
            headers: { "Content-Type": "image/png" },
            body: inspectionPngBlob(inspection.screenshotBase64),
          },
        );
        if (!uploaded.ok) {
          throw new Error((await uploaded.text()) || "could not persist the element crop");
        }
        const saved = (await uploaded.json()) as { path?: string };
        if (!saved.path) throw new Error("the crop upload returned no file path");
        screenshotPath = saved.path;
      }

      const contextKey = `session:${target.sessionId}`;
      const inspectionDraft = computerInspectionDraft(inspection, screenshotPath);
      stashPromptDraft({
        contextKey,
        source: "session",
        text: mergeComputerInspectionDraft(
          inspectionDraft,
          readPromptDraft(contextKey)?.text,
        ),
        sessionId: target.sessionId,
        sessionTitle: target.title,
        project: target.project,
      });
      onInspectionReady?.(target.sessionId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "element inspection failed");
    } finally {
      setInspectionStarting(false);
      void refresh();
    }
  };


  const deps = status?.deps;
  const running = !!status?.running;

  // Session-first is intentionally one action: the session composer names the
  // immutable target, navigation opens Computer, and selection arms as soon as
  // the RFB screen is live. The ref prevents 2s status polls from launching a
  // second blocking inspection request for the same route.
  useEffect(() => {
    const sessionId = inspectionSession?.sessionId;
    if (
      !active ||
      !autoStartInspection ||
      !sessionId ||
      !running ||
      phase !== "live" ||
      status?.inspection?.active ||
      inspectionStarting ||
      autoStartedForRef.current === sessionId
    ) {
      return;
    }
    autoStartedForRef.current = sessionId;
    void startInspection();
    // startInspection intentionally belongs to this route attempt. Depending
    // on its render identity would re-arm the blocking request every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    active,
    autoStartInspection,
    inspectionSession?.sessionId,
    inspectionStarting,
    phase,
    running,
    status?.inspection?.active,
  ]);

  // Browser back and the mobile back gesture unmount this page. Cancel the
  // outstanding server-side inspection as cleanup so the shared Computer is
  // never left behind in a two-minute selection mode.
  useEffect(() => {
    if (!autoStartInspection || !inspectionSession?.sessionId) return;
    return () => {
      void omgFetch("/api/computer/browser/inspect/cancel", { method: "POST" });
    };
  }, [autoStartInspection, inspectionSession?.sessionId]);

  return (
    // Full bleed: the screen is the page. No title, no chrome, no padding --
    // every pixel spent on framing is a pixel not spent on the desktop.
    <div
      className="relative h-full min-h-0 w-full overflow-hidden bg-[#0b0b0d]"
      // Correct the mode from what actually touched the screen. The media
      // query cannot distinguish an iPad from an iPad with a trackpad, so a
      // real mouse event switches to absolute pointing and a finger switches
      // back. Capture phase, because in trackpad mode the overlay above stops
      // these from bubbling.
      onPointerDownCapture={(e) => {
        const wants = e.pointerType === "touch";
        setTrackpad((current) => (current === wants ? current : wants));
      }}
    >
      {/* touch-none is load-bearing on mobile: noVNC's GestureHandler needs the
          raw touch stream. Without it the browser claims the gestures for page
          panning and zooming, and the desktop appears to ignore every touch.
          select-none stops long-press from raising the text-selection callout
          over the canvas, which otherwise eats the right-click gesture. */}
      <div
        ref={screenRef}
        className="absolute inset-0 touch-none select-none [-webkit-touch-callout:none] [overscroll-behavior:none]"
      />

      {/* Trackpad surface. Mounted only while controlling AND on a finger, so a
          mouse keeps absolute pointing and reaches noVNC's own handlers
          untouched. Listeners are attached natively in the effect above, not
          here: React's touch props are passive, and preventDefault is the whole
          point. No onDoubleClick either -- the browser synthesizes dblclick
          from taps, and reacting to it is what made a tap-then-drag stall. */}
      {running && !viewOnly && trackpad && !status?.inspection?.active ? (
        <div
          ref={overlayRef}
          className="absolute inset-0 z-[6] touch-none select-none"
          onContextMenu={(e) => {
            e.preventDefault();
            clickAtCursor(2);
          }}
        />
      ) : null}

      {/* Exists only to raise the soft keyboard: a canvas cannot take focus on
          iOS, so the OS has nothing to attach a keyboard to. Whatever lands
          here is forwarded a character at a time and the field is emptied. */}
      <textarea
        ref={keyboardRef}
        aria-hidden
        tabIndex={-1}
        className="pointer-events-none absolute size-px opacity-0"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => {
          const rfb = rfbRef.current;
          const text = e.target.value;
          e.target.value = "";
          if (!rfb) return;
          for (const ch of text) {
            const cp = ch.codePointAt(0) ?? 0;
            // Latin-1 is its own keysym; anything above uses the Unicode plane
            // offset X11 defines.
            const keysym = cp < 0x100 ? cp : 0x01000000 + cp;
            rfb.sendKey(keysym, null, true);
            rfb.sendKey(keysym, null, false);
          }
        }}
        onKeyDown={(e) => {
          const rfb = rfbRef.current;
          if (!rfb) return;
          // Keys that produce no character still have to reach the desktop.
          const named: Record<string, number> = {
            Enter: 0xff0d,
            Backspace: 0xff08,
            Tab: 0xff09,
            Escape: 0xff1b,
            ArrowLeft: 0xff51,
            ArrowUp: 0xff52,
            ArrowRight: 0xff53,
            ArrowDown: 0xff54,
          };
          const keysym = named[e.key];
          if (!keysym) return;
          e.preventDefault();
          rfb.sendKey(keysym, e.code || null, true);
          rfb.sendKey(keysym, e.code || null, false);
        }}
      />

      {running && inspectionSession ? (
        <div className="absolute bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-3 z-10">
          <ComputerInspectionControl
            active={status?.inspection?.active ?? false}
            starting={inspectionStarting}
            mobilePan={trackpad}
            session={inspectionSession}
            onStart={() => void startInspection()}
            onCancel={() => void cancelInspection()}
          />
        </div>
      ) : null}

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
            {/* Keyboard is visible whether or not you have taken control, and
                takes control itself when used. Hiding it until you are already
                controlling made it undiscoverable. */}
            <>
                <Button
                  variant="secondary"
                  size="icon-sm"
                  className="shadow-lg"
                  onClick={openKeyboard}
                  aria-label="Show the keyboard"
                  title="Keyboard"
                >
                  <Keyboard className="size-3.5" />
                </Button>
            </>
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
