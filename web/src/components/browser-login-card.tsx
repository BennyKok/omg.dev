import { lazy, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { latestBrowserLoginRequest, type BrowserLoginSnapshot } from "../../../packages/protocol/src/browser-login";
import { omgFetch } from "../lib/omg-client";
const Computer = lazy(() => import("../views/computer-page").then(m => ({ default: m.ComputerPage })));

export function BrowserLoginCard({ sessionId, user }: { sessionId: string | null; user?: string | null }) {
  const [state, setState] = useState<BrowserLoginSnapshot | null>(null);
  const [showComputer, setShowComputer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const suffix = `?sessionId=${encodeURIComponent(sessionId ?? "")}&user=${encodeURIComponent(user ?? "")}`;
  useEffect(() => {
    if (!sessionId) return;
    let live = true;
    setState(null);
    const refresh = async () => {
      try {
        const response = await omgFetch(`/api/browser-login${suffix}`);
        if (response.ok) { const data = await response.json(); if (live) setState(data); }
      } catch { /* Compatible with computers without browser login. */ }
    };
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 3000);
    return () => { live = false; clearInterval(timer); };
  }, [sessionId, suffix]);
  const request = state && latestBrowserLoginRequest(state.requests);
  if (!request) return null;
  const done = request.status === "imported" || request.status === "failed";
  return <>
    <div className="mb-2 rounded-xl border bg-card p-3 text-sm" role="status">
      <div className="font-medium">Sign in to {new URL(request.origin).hostname}</div>
      <p className="mt-1 text-muted-foreground">{request.reason}</p>
      <p className="text-muted-foreground">Login for {request.computerName}</p>
      <p className="mt-2">{done ? request.message : request.status === "importing" ? "Transferring login…" : request.status === "in_progress" ? "Login is open on a device." : state?.iosAvailable ? "Open this chat in the iOS app and tap the website login button." : "Sign in from this chat in the latest iOS app, or use the Computer below."}</p>
      {!done && <div className="mt-2 flex gap-4">
        <button className="font-medium text-primary" onClick={() => setShowComputer(true)}>Open Computer</button>
        <button disabled={request.status === "importing"} className="text-muted-foreground" onClick={async () => {
          try {
            const res = await omgFetch(`/api/browser-login/${request.id}/cancel${suffix}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
            if (!res.ok) throw new Error();
            setState(null);
          } catch { setError("Could not cancel. Try again."); }
        }}>Cancel request</button>
      </div>}
      {error && <p role="alert">{error}</p>}
    </div>
    {showComputer && createPortal(<div className="fixed inset-0 z-[100] bg-background" role="dialog" aria-label="Computer login">
      <Suspense fallback={<p>Opening Computer…</p>}><Computer active onClose={() => setShowComputer(false)} /></Suspense>
    </div>, document.body)}
  </>;
}
