// The Computer's screen over the voxl stream (lib/voxl-stream.ts). Used by the
// full Computer page when the box runs with OMG_COMPUTER_STREAM=voxl.

import { useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openOmgSocket } from "@/lib/omg-client";
import { openVoxlStream, voxlSupported, type VoxlStats } from "@/lib/voxl-stream";

export function ComputerVoxlScreen({ active, viewOnly }: { active: boolean; viewOnly: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const viewOnlyRef = useRef(viewOnly);
  viewOnlyRef.current = viewOnly;
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<VoxlStats | null>(null);
  const [attempt, setAttempt] = useState(0);
  const unsupported = voxlSupported();

  useEffect(() => {
    const canvas = canvasRef.current;
    const surface = surfaceRef.current;
    if (!active || !canvas || !surface || unsupported) return;
    let cancelled = false;
    let stream: { close(): void } | null = null;
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
          onLive: setLive,
          onStats: setStats,
          onError: setError,
          viewOnly: () => viewOnlyRef.current,
        });
        surface.focus({ preventScroll: true });
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "could not open the fast stream");
      });
    return () => {
      cancelled = true;
      stream?.close();
    };
  }, [active, attempt, unsupported]);

  return (
    <div
      ref={surfaceRef}
      tabIndex={0}
      className="absolute inset-0 touch-none select-none outline-none [-webkit-touch-callout:none] [overscroll-behavior:none]"
    >
      <canvas ref={canvasRef} className="size-full object-contain" />

      {stats ? (
        <div className="pointer-events-none absolute bottom-3 left-3 z-10 rounded-full bg-card/80 px-2.5 py-1 font-mono text-[11px] text-muted-foreground backdrop-blur">
          voxl · {Math.round(stats.fps)} fps · {Math.round(stats.kbps / 1000 * 10) / 10} Mbps · {stats.pipeMs.toFixed(1)} ms
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
