// The Computer's screen over the voxl stream (lib/voxl-stream.ts). Used by the
// Computer page and its inline chat view by default, when the box has the
// voxl binary and the browser can decode it.
//
// The screen is always controllable: there is no watch-only mode to switch
// out of. Keyboard, paste and copy sit in one small bar at the bottom.

import { useEffect, useRef, useState } from "react";
import { ClipboardCopy, ClipboardPaste, Keyboard, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openOmgSocket } from "@/lib/omg-client";
import { readRemoteClipboard, setRemoteClipboard } from "@/lib/computer-clipboard-transport";
import { openVoxlStream, voxlSupported, type VoxlStats, type VoxlStream } from "@/lib/voxl-stream";
import {
  attachComputerClipboard,
  clipboardButtonHandlers,
  type ComputerClipboard,
} from "../../../packages/protocol/src/computer-clipboard";

/** Keys the on-screen keyboard produces without a character. */
const SOFT_KEYS: Record<string, number> = {
  Enter: 0xff0d,
  Backspace: 0xff08,
  Tab: 0xff09,
  Escape: 0xff1b,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
};

export function ComputerVoxlScreen({
  active,
  autoFocus = true,
  controls = true,
}: {
  active: boolean;
  /** Take the keyboard when the stream opens. Off inline, where the person is typing in the chat. */
  autoFocus?: boolean;
  /** Show the keyboard / paste / copy bar. */
  controls?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<HTMLImageElement | null>(null);
  const keyboardRef = useRef<HTMLTextAreaElement | null>(null);
  const streamRef = useRef<VoxlStream | null>(null);
  const clipboardRef = useRef<ComputerClipboard | null>(null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<VoxlStats | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const unsupported = voxlSupported();

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const surface = surfaceRef.current;
    if (!active || !root || !canvas || !surface || unsupported) return;
    let cancelled = false;
    let stream: VoxlStream | null = null;
    let clipboard: ComputerClipboard | null = null;
    setError(null);
    setLive(false);
    void openOmgSocket("/api/computer/voxl")
      .then((socket) => {
        if (cancelled) {
          socket.close();
          return;
        }
        stream = openVoxlStream({
          socket,
          canvas,
          surface,
          cursor: cursorRef.current ?? undefined,
          onLive: setLive,
          onStats: setStats,
          onError: setError,
        });
        streamRef.current = stream;
        // Same copy / paste / shortcut handling as the VNC stream.
        clipboard = attachComputerClipboard(stream.clipboard, root, {
          notice: setNotice,
          readRemoteText: readRemoteClipboard,
          setRemoteText: setRemoteClipboard,
          focusKeyboard: () => keyboardRef.current?.focus({ preventScroll: true }),
          restoreFocus: () => surface.focus({ preventScroll: true }),
        });
        clipboardRef.current = clipboard;
        if (autoFocus) surface.focus({ preventScroll: true });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "could not open the fast stream");
      });
    return () => {
      cancelled = true;
      clipboard?.dispose();
      clipboardRef.current = null;
      stream?.close();
      streamRef.current = null;
    };
  }, [active, attempt, unsupported, autoFocus]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 1800);
    return () => clearTimeout(t);
  }, [notice]);

  return (
    <div ref={rootRef} className="absolute inset-0">
      <div
        ref={surfaceRef}
        tabIndex={0}
        className="absolute inset-0 touch-none select-none outline-none [-webkit-touch-callout:none] [overscroll-behavior:none]"
      >
        <canvas ref={canvasRef} className="size-full object-contain" />
        {/* The remote pointer, drawn while a finger drives it. */}
        <img
          ref={cursorRef}
          alt=""
          aria-hidden
          draggable={false}
          style={{ display: "none" }}
          className="pointer-events-none absolute left-0 top-0 z-[4]"
        />
      </div>

      {/* Exists to raise the phone's keyboard: a canvas cannot take focus on
          iOS. What lands here is typed on the Computer and the field emptied. */}
      <textarea
        ref={keyboardRef}
        aria-hidden
        tabIndex={-1}
        className="pointer-events-none absolute bottom-0 left-0 size-px opacity-0"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => {
          const text = e.target.value;
          e.target.value = "";
          if (text) streamRef.current?.typeText(text);
        }}
        onKeyDown={(e) => {
          const keysym = SOFT_KEYS[e.key];
          if (!keysym || e.ctrlKey || e.metaKey) return;
          e.preventDefault();
          streamRef.current?.tapKey(keysym);
        }}
      />

      {controls && live ? (
        <div className="absolute inset-x-0 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-10 flex justify-center">
          <div className="flex items-center gap-1 rounded-full border border-border bg-card/85 p-1 shadow-lg backdrop-blur">
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => keyboardRef.current?.focus()}
              aria-label="Show the keyboard"
              title="Keyboard"
            >
              <Keyboard className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              {...clipboardButtonHandlers(() => void clipboardRef.current?.pasteFromDevice())}
              aria-label="Paste from this device"
              title="Paste"
            >
              <ClipboardPaste className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full"
              {...clipboardButtonHandlers(() => void clipboardRef.current?.copy())}
              aria-label="Copy selected text from the Computer"
              title="Copy"
            >
              <ClipboardCopy className="size-4" />
            </Button>
          </div>
        </div>
      ) : null}

      {stats && controls ? (
        <div className="pointer-events-none absolute bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-3 z-10 hidden rounded-full bg-card/80 px-2.5 py-1 font-mono text-[11px] text-muted-foreground backdrop-blur sm:block">
          voxl · {Math.round(stats.fps)} fps · {stats.pipeMs.toFixed(1)} ms
        </div>
      ) : null}

      {notice ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-20 z-10 flex justify-center">
          <div className="rounded-full bg-card/90 px-3 py-1.5 text-xs shadow-lg backdrop-blur">{notice}</div>
        </div>
      ) : null}

      {!live && !error && !unsupported ? (
        <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center">
          <div className="flex items-center gap-2 rounded-full bg-card/90 px-4 py-2 text-sm shadow-lg backdrop-blur">
            <Loader2 className="size-4 animate-spin" />
            Connecting to the screen…
          </div>
        </div>
      ) : null}

      {error || unsupported ? (
        <div className="absolute inset-0 z-[5] flex items-center justify-center p-6">
          <div className="space-y-3 rounded-2xl border border-border bg-card/90 p-5 text-center backdrop-blur">
            <p className="text-sm text-destructive">{unsupported ?? error}</p>
            {!unsupported ? (
              <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>
                <RotateCcw className="mr-1.5 size-3.5" />
                Reconnect
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
