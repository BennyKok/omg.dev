import { lazy, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { latestBrowserLoginRequest, type BrowserLoginSnapshot } from "../../../packages/protocol/src/browser-login";
import { omgFetch } from "../lib/omg-client";
const Computer = lazy(() => import("../views/computer-page").then(m => ({ default: m.ComputerPage })));

function WebsiteIcon({ origin }: { origin: string }) {
  const [failed, setFailed] = useState(false);
  const host = new URL(origin).hostname;
  return <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-muted">
    {failed
      ? <span aria-label={`${host} website`} className="text-xl font-semibold text-muted-foreground">{host.replace(/^www\./, "").charAt(0).toUpperCase()}</span>
      : <img src={`${origin}/favicon.ico`} alt={`${host} icon`} onError={() => setFailed(true)} className="size-7 object-contain" />}
  </div>;
}

/**
 * One row, matching the iOS card: the site, then the verb, then the dismissal.
 * The reason is already in the agent's message above, so the card does not
 * repeat it. On the web, "Log in" opens the shared Computer.
 */
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
  const latest = state && latestBrowserLoginRequest(state.requests);
  // The transcript carries "Signed in to <host>" once the agent is told.
  const request = latest?.status === "imported" && latest.agentNotified ? null : latest;
  if (!request) return null;
  const status = request.status === "imported" ? { text: "Signed in", className: "text-success" }
    : request.status === "failed" ? { text: request.message || "Could not transfer the login.", className: "text-destructive" }
    : request.status === "importing" ? { text: "Transferring…", className: "text-muted-foreground" }
    : request.status === "in_progress" ? { text: "Open on a device", className: "text-muted-foreground" }
    : null;
  const cancel = async () => {
    try {
      const res = await omgFetch(`/api/browser-login/${request.id}/cancel${suffix}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) throw new Error();
      setState(null);
    } catch { setError("Could not cancel. Try again."); }
  };
  return <>
    <div className="mb-2 rounded-2xl border bg-card py-2 pl-3 pr-2 text-sm" role="status">
      <div className="flex items-center gap-2.5">
        <WebsiteIcon key={request.origin} origin={request.origin} />
        <span className="min-w-0 flex-1 truncate text-base font-semibold">{new URL(request.origin).hostname}</span>
        {status
          ? <span className={`min-w-0 shrink truncate text-[13px] ${status.className}`}>{status.text}</span>
          : <button className="min-h-[34px] rounded-full bg-primary px-4 font-semibold text-primary-foreground" onClick={() => setShowComputer(true)}>Log in</button>}
        {request.status !== "imported" && <button aria-label="Cancel the login request" disabled={request.status === "importing"}
          className="flex size-[30px] items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-50" onClick={cancel}>
          <X className="size-3.5" strokeWidth={2.5} />
        </button>}
      </div>
      {error && <p role="alert" className="mt-1 text-destructive">{error}</p>}
    </div>
    {showComputer && createPortal(<div className="fixed inset-0 z-[100] bg-background" role="dialog" aria-label="Computer login">
      <Suspense fallback={<p>Opening Computer…</p>}><Computer active onClose={() => setShowComputer(false)} /></Suspense>
    </div>, document.body)}
  </>;
}
