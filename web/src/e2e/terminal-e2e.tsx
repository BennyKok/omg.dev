// The page test/browser/terminal-e2e.ts drives: the real session terminal
// dock under a stand-in chat column, at the size of a session pane. Only the
// Vite dev server serves it (web/e2e/terminal.html).
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { SessionTerminalDock } from "@/components/session-terminal-dock";
import "../index.css";

const params = new URLSearchParams(location.search);
const sessionId = params.get("sid") || "e2e-session";

function Page() {
  const [open, setOpen] = useState(params.get("open") !== "0");
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div className="flex shrink-0 items-center gap-2 border-b border-border p-2 text-sm">
        <button type="button" data-testid="toggle-terminal" onClick={() => setOpen((o) => !o)}>
          {open ? "Hide terminal" : "Terminal"}
        </button>
      </div>
      <section className="flex min-h-0 flex-1 flex-col">
        {/* Shaped like the real SessionChatBody: a scrolling transcript and a
            composer that does not shrink, under the same lfg-session-chat
            root the stylesheet hides when the dock fills the column. */}
        <div data-testid="chat" className="lfg-session-chat flex min-h-0 flex-1 flex-col text-sm">
          <div className="flex min-h-0 flex-1 flex-col justify-end overflow-auto p-3">
            <p>Transcript stand-in.</p>
          </div>
          <div data-testid="composer" className="relative mx-3 mb-3 h-24 shrink-0 rounded border border-border p-2">
            Composer stand-in
          </div>
        </div>
        {open ? <SessionTerminalDock sessionId={sessionId} label="~/e2e" onClose={() => setOpen(false)} /> : null}
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
