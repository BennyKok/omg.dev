import { lazy, Suspense, useState } from "react";
import { createPortal } from "react-dom";
import { Monitor, X } from "lucide-react";

const Computer = lazy(() => import("../views/computer-page").then(m => ({ default: m.ComputerPage })));

/**
 * The live Computer screen, in the chat. One owner for both places it shows:
 * under a website login request and under the agent's latest Computer run.
 *
 * Inline and full screen share one connection (lib/computer-connection.ts):
 * switching between them moves the picture and does not reconnect.
 */
export function ComputerChatEmbed({ label, expanded: expandedProp, onExpandedChange }: {
  label: string;
  /** Lets a card with its own button (Log in) open the same full screen. */
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
}) {
  const [expandedState, setExpandedState] = useState(false);
  const expanded = expandedProp ?? expandedState;
  const setExpanded = (next: boolean) => { setExpandedState(next); onExpandedChange?.(next); };
  const [hidden, setHidden] = useState(false);
  if (hidden) {
    return <button type="button" onClick={() => setHidden(false)}
      className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
      <Monitor className="size-3.5" />Show the Computer
    </button>;
  }
  return <>
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <span className="size-1.5 rounded-full bg-success" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <button type="button" aria-label="Hide the Computer" onClick={() => setHidden(true)}
          className="flex size-6 items-center justify-center rounded-full hover:text-foreground">
          <X className="size-3.5" />
        </button>
      </div>
      {expanded
        ? <div className="flex aspect-[16/10] w-full items-center justify-center rounded-2xl border bg-muted text-xs text-muted-foreground">Showing full screen</div>
        : <Suspense fallback={<div className="aspect-[16/10] w-full rounded-2xl border bg-[#0b0b0d]" />}>
            <Computer active variant="inline" onExpand={() => setExpanded(true)} />
          </Suspense>}
    </div>
    {expanded && createPortal(<div className="fixed inset-0 z-[100] bg-background" role="dialog" aria-label="Computer">
      <Suspense fallback={<p>Opening Computer…</p>}><Computer active onClose={() => setExpanded(false)} /></Suspense>
    </div>, document.body)}
  </>;
}

/** A Computer tool call the person may want to see and take over. Status and
 *  stop calls show nothing worth watching. Matches the agent-facing names
 *  (`mcp__computer__computer_click`) and the policy names (`computer.click`). */
export function isComputerScreenCall(text: string | null | undefined): boolean {
  const name = (text || "").split(":")[0]!.trim().split(/\s+/)[0] ?? "";
  const match = /^(?:.*__)?computer[_.]([a-z_]+)$/i.exec(name);
  return !!match && match[1] !== "status" && match[1] !== "stop";
}
