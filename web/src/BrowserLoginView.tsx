import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RotateCcw, Save, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

// Live, interactive remote-browser view. We open a WebSocket to the backend
// session stream, paint incoming JPEG frames onto a <canvas>, and forward the
// user's mouse/keyboard into the headless browser. Coordinates are sent in CSS
// px relative to the canvas (the backend maps them to the real viewport).
//
// server -> client:
//   { type:'frame', dataB64, w, h }
//   { type:'status', state, url, title }
//   { type:'saved', profileId }
//   { type:'error', message }
// client -> server:
//   { type:'input', kind, x?, y?, button?, deltaY?, key?, text? }
//   { type:'navigate', url }
//   { type:'save', name }
//   { type:'reload' }

type FrameMsg = { type: "frame"; dataB64: string; w: number; h: number };
type StatusMsg = {
  type: "status";
  state?: string;
  url?: string;
  title?: string;
};
type SavedMsg = { type: "saved"; profileId: string };
type ErrorMsg = { type: "error"; message: string };
type ServerMsg = FrameMsg | StatusMsg | SavedMsg | ErrorMsg;

type ConnState = "connecting" | "open" | "closed" | "error";

export default function BrowserLoginView(props: {
  sessionId: string;
  onClose: () => void;
  onSaved?: (profileId: string) => void;
}) {
  const { sessionId, onClose, onSaved } = props;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  // Latest known frame dimensions, so we keep the canvas backing store sized to
  // the remote viewport for crisp 1:1 painting.
  const frameSizeRef = useRef<{ w: number; h: number }>({ w: 1280, h: 800 });

  const [conn, setConn] = useState<ConnState>("connecting");
  const [status, setStatus] = useState<{
    state?: string;
    url?: string;
    title?: string;
  }>({});
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [addressBar, setAddressBar] = useState("");
  const [saving, setSaving] = useState(false);

  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  // --- WebSocket lifecycle ---------------------------------------------------
  useEffect(() => {
    let disposed = false;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${location.host}/api/browser/sessions/${encodeURIComponent(
      sessionId,
    )}/stream`;
    const ws = new WebSocket(url);
    wsRef.current = ws;
    setConn("connecting");

    ws.onopen = () => {
      if (disposed) return;
      setConn("open");
    };

    ws.onmessage = (e) => {
      if (disposed) return;
      if (typeof e.data !== "string") return;
      let msg: ServerMsg;
      try {
        msg = JSON.parse(e.data) as ServerMsg;
      } catch {
        return;
      }
      switch (msg.type) {
        case "frame":
          paintFrame(msg);
          break;
        case "status":
          setStatus({ state: msg.state, url: msg.url, title: msg.title });
          if (msg.url) setAddressBar((cur) => (cur ? cur : msg.url ?? ""));
          break;
        case "saved":
          setSaving(false);
          toast.success("Profile saved");
          onSaved?.(msg.profileId);
          break;
        case "error":
          setSaving(false);
          setErrorMsg(msg.message);
          toast.error(msg.message || "Browser session error");
          break;
      }
    };

    ws.onerror = () => {
      if (disposed) return;
      setConn("error");
      setErrorMsg("Connection error");
    };

    ws.onclose = () => {
      if (disposed) return;
      setConn("closed");
    };

    return () => {
      disposed = true;
      wsRef.current = null;
      try {
        ws.close();
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Draw a base64 JPEG frame onto the canvas, keeping the backing store sized to
  // the remote viewport.
  const paintFrame = useCallback((frame: FrameMsg) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (frame.w && frame.h) {
      frameSizeRef.current = { w: frame.w, h: frame.h };
      if (canvas.width !== frame.w) canvas.width = frame.w;
      if (canvas.height !== frame.h) canvas.height = frame.h;
    }
    let ctx = ctxRef.current;
    if (!ctx) {
      ctx = canvas.getContext("2d");
      ctxRef.current = ctx;
    }
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      const c = canvasRef.current;
      const cx = ctxRef.current;
      if (!c || !cx) return;
      cx.drawImage(img, 0, 0, c.width, c.height);
    };
    img.src = `data:image/jpeg;base64,${frame.dataB64}`;
  }, []);

  // --- Input forwarding ------------------------------------------------------
  // Translate a DOM mouse event into canvas-viewport CSS px. The canvas is
  // displayed scaled to fit; we map the on-screen position back to the remote
  // viewport's coordinate space (matching the frame dimensions).
  const toViewport = useCallback((e: { clientX: number; clientY: number }) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const { w, h } = frameSizeRef.current;
    const sx = rect.width > 0 ? w / rect.width : 1;
    const sy = rect.height > 0 ? h / rect.height : 1;
    const x = Math.round((e.clientX - rect.left) * sx);
    const y = Math.round((e.clientY - rect.top) * sy);
    return { x, y };
  }, []);

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { x, y } = toViewport(e);
      send({ type: "input", kind: "mousemove", x, y });
    },
    [send, toViewport],
  );

  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      canvasRef.current?.focus();
      const { x, y } = toViewport(e);
      send({ type: "input", kind: "mousedown", x, y, button: e.button });
    },
    [send, toViewport],
  );

  const onMouseUp = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { x, y } = toViewport(e);
      send({ type: "input", kind: "mouseup", x, y, button: e.button });
    },
    [send, toViewport],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      const { x, y } = toViewport(e);
      send({ type: "input", kind: "wheel", x, y, deltaY: e.deltaY });
    },
    [send, toViewport],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      // Keep focus & the remote browser in control of all keys.
      e.preventDefault();
      send({ type: "input", kind: "keydown", key: e.key });
      // For printable characters, also forward an insertText so the remote page
      // receives the actual typed text (covers IME/shift/layout differences).
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        send({ type: "input", kind: "char", text: e.key });
      }
    },
    [send],
  );

  const onKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      send({ type: "input", kind: "keyup", key: e.key });
    },
    [send],
  );

  // --- Toolbar actions -------------------------------------------------------
  const submitAddress = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const raw = addressBar.trim();
      if (!raw) return;
      const url = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
      send({ type: "navigate", url });
    },
    [addressBar, send],
  );

  const handleSave = useCallback(() => {
    const name = window.prompt("Save profile as:", status.title || "");
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    send({ type: "save", name: trimmed });
  }, [send, status.title]);

  const handleReload = useCallback(() => {
    send({ type: "reload" });
  }, [send]);

  const handleClose = useCallback(() => {
    try {
      wsRef.current?.close();
    } catch {
      // ignore
    }
    onClose();
  }, [onClose]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 bg-background text-foreground">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <form onSubmit={submitAddress} className="flex min-w-0 flex-1 items-center gap-2">
          <input
            type="text"
            value={addressBar}
            onChange={(e) => setAddressBar(e.target.value)}
            placeholder="Enter a URL to navigate"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground outline-none focus:border-primary"
          />
          <Button type="submit" size="sm" variant="outline">
            Go
          </Button>
        </form>
        <Button size="sm" variant="outline" onClick={handleReload}>
          <RotateCcw className="size-4" />
          <span className="ml-1 hidden sm:inline">Reload</span>
        </Button>
        <Button size="sm" variant="brand" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          <span className="ml-1 hidden sm:inline">Save profile</span>
        </Button>
        <Button size="sm" variant="ghost" onClick={handleClose}>
          <X className="size-4" />
          <span className="ml-1 hidden sm:inline">Close</span>
        </Button>
      </div>

      {/* Status line */}
      <div className="flex shrink-0 items-center gap-2 px-3 text-xs text-muted-foreground">
        <span
          className={
            "inline-block size-2 shrink-0 rounded-full " +
            (conn === "open"
              ? "bg-emerald-500"
              : conn === "connecting"
                ? "bg-amber-500"
                : "bg-destructive")
          }
          title={conn}
        />
        <span className="truncate">
          {status.title ? status.title : status.state || conn}
        </span>
        {status.url ? (
          <span className="truncate text-muted-foreground/70">· {status.url}</span>
        ) : null}
      </div>

      {errorMsg ? (
        <div className="mx-3 shrink-0 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {errorMsg}
        </div>
      ) : null}

      {/* Canvas viewport */}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black/80 p-2">
        <canvas
          ref={canvasRef}
          tabIndex={0}
          width={frameSizeRef.current.w}
          height={frameSizeRef.current.h}
          onMouseMove={onMouseMove}
          onMouseDown={onMouseDown}
          onMouseUp={onMouseUp}
          onWheel={onWheel}
          onContextMenu={(e) => e.preventDefault()}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          className="max-h-full max-w-full cursor-crosshair rounded-md shadow-lg outline-none"
          style={{ touchAction: "none" }}
        />
      </div>
    </div>
  );
}
