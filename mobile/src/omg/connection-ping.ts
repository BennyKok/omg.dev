import type { OmgSocket, OmgTransport } from "@omg-dev/client";

export type ConnectionPing = { route: string; ms: number | null; status: "checking" | "connected" | "unavailable" };

export function connectionRoute(url: string | undefined, cloud = false): string {
  if (cloud) return "Cloud computer";
  try {
    const host = new URL(url ?? "").hostname;
    if (host === "sessions-ca.omgs.app") return "Relay · Canada";
    if (host === "sessions.omgs.app") return "Relay · Germany";
    if (host.endsWith(".ts.net") || host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return "Direct";
    return "Hosted connection";
  } catch { return "Connection"; }
}

/** A screen-scoped diagnostic socket. The transport still owns authentication and routing. */
export function startConnectionPing(
  transport: Pick<OmgTransport, "openLiveSocket">,
  report: (state: ConnectionPing) => void,
  cloud = false,
  timing = { now: () => performance.now(), interval: 5000, timeout: 8000 },
): () => void {
  let stopped = false;
  let socket: OmgSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let route = "Connection";
  let sequence = 0;
  let pending: { id: string; started: number } | null = null;
  const publish = (status: ConnectionPing["status"], ms: number | null = null) => report({ route, status, ms });
  const clear = () => { clearTimeout(timer); pending = null; };
  const failed = () => {
    if (stopped) return;
    clear();
    const old = socket;
    socket = null;
    old?.close();
    publish("unavailable");
    timer = setTimeout(connect, timing.interval);
  };
  const ping = () => {
    if (stopped || !socket) return;
    const id = `settings-ping-${++sequence}`;
    pending = { id, started: timing.now() };
    timer = setTimeout(failed, timing.timeout);
    try { socket.send(JSON.stringify({ t: "ping", id })); } catch { failed(); }
  };
  const connect = async () => {
    if (stopped) return;
    publish("checking");
    // A late grant/socket after timeout or disposal must never start a probe.
    let expired = false;
    timer = setTimeout(() => { expired = true; failed(); }, timing.timeout);
    try {
      const next = await transport.openLiveSocket();
      if (stopped || expired) { next.close(); return; }
      socket = next;
      route = connectionRoute((next as OmgSocket & { url?: string }).url, cloud);
      const opened = () => { if (socket !== next || stopped) return; clear(); ping(); };
      next.addEventListener("open", opened);
      next.addEventListener("message", event => {
        if (socket !== next || stopped) return;
        try {
          const message = JSON.parse(String(event.data));
          if (message.t === "ping") next.send(JSON.stringify({ t: "pong" }));
          if (!pending || message.t !== "pong" || message.id !== pending.id) return;
          const ms = Math.max(0, Math.round(timing.now() - pending.started));
          clear();
          publish("connected", ms);
          timer = setTimeout(ping, timing.interval);
        } catch { /* unrelated protocol messages do not complete a measurement */ }
      });
      const closed = () => { if (socket === next && !stopped) failed(); };
      next.addEventListener("close", closed);
      next.addEventListener("error", closed);
      if (next.readyState === 1) opened();
    } catch { if (!stopped && !expired) failed(); }
  };
  void connect();
  return () => { stopped = true; clear(); socket?.close(); socket = null; };
}
