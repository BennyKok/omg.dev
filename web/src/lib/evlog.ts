// The one owner of browser-side diagnostic events.
//
// This is the client half of the live transport instrumentation described in
// docs/live-ws-protocol.md. Events posted here land in the same daily evlog
// file that the server writes ws_connect / ws_subscribe / ws_backlog to, so a
// single reconnect can be read end to end from one file. Only the browser
// knows the WebSocket close code and the retry count, which is why
// ConnectionStatus.tsx can keep that detail out of the user-facing copy.
//
// This helper used to be defined twice, in useLiveSocket.ts and in App.tsx,
// with identical bodies. Two copies of one helper drift, so there is now one.
import { omgFetch } from "./omg-client";

export function evlog(event: string, fields: Record<string, unknown> = {}) {
  try {
    const payload = JSON.stringify({
      event,
      source: "browser",
      pageMs: Math.round(performance.now() * 1000) / 1000,
      path: location.pathname + location.search,
      ...fields,
    });
    void omgFetch("/api/evlog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Diagnostics must never affect the app path being measured.
  }
}
