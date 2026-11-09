// A tabbed terminal panel: a strip of tabs over one live terminal.
//
// Each tab is its own shell in the terminal host (src/term). Tabs are not kept
// in the browser: the host's list is the source of truth, so a tab opened on
// the laptop shows up on the phone, and a reload finds every running shell.
// Switching tabs re-attaches, and the host's snapshot repaints the screen.
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Keyboard, Maximize2, Minimize2, Plus, TerminalSquare, X } from "lucide-react";
import { omgFetch } from "@/lib/omg-client";
import {
  TerminalSurface,
  type TerminalAttachedInfo,
  type TerminalStatus,
  type TerminalSurfaceHandle,
} from "./TermView";

export type TerminalScope = { sessionId: string } | { name: string };

/** One tab. `tab` is null for a scope's first shell, which has no suffix. */
export interface TerminalTab {
  tab: string | null;
  title: string | null;
  program: string | null;
}

type ShellInfo = { id: string; title: string | null; program: string | null; createdAt: number };

export function scopeQuery(scope: TerminalScope, tab: string | null = null): string {
  const base =
    "sessionId" in scope
      ? `sessionId=${encodeURIComponent(scope.sessionId)}`
      : `session=${encodeURIComponent(scope.name)}`;
  return tab ? `${base}&tab=${encodeURIComponent(tab)}` : base;
}

/** The host id of a scope's first shell; later tabs are `<id>-<tab>`. */
export function scopeId(scope: TerminalScope): string {
  return "sessionId" in scope ? `s-${scope.sessionId.replace(/[^A-Za-z0-9_-]/g, "")}` : scope.name;
}

/** Map the host's shells onto this scope's tabs, oldest first. */
export function tabsFromShells(scope: TerminalScope, shells: ShellInfo[]): TerminalTab[] {
  const id = scopeId(scope);
  const out: TerminalTab[] = [];
  for (const s of [...shells].sort((a, b) => a.createdAt - b.createdAt)) {
    if (s.id === id) out.push({ tab: null, title: s.title, program: s.program });
    else if (s.id.startsWith(`${id}-`)) out.push({ tab: s.id.slice(id.length + 1), title: s.title, program: s.program });
  }
  return out;
}

export function newTabName(existing: readonly TerminalTab[], now = Date.now()): string {
  let name = `t${now.toString(36)}`;
  while (existing.some((t) => t.tab === name)) name = `${name}x`;
  return name;
}

const tabKey = (t: TerminalTab | { tab: string | null }) => t.tab ?? "";

/** A short label: the running program, else the shell's title, else a number. */
export function tabLabel(t: TerminalTab, index: number): string {
  const program = t.program?.trim();
  if (program) return program;
  const title = t.title?.trim();
  if (title) return title.length > 28 ? `${title.slice(0, 27)}…` : title;
  return `Terminal ${index + 1}`;
}

export function TerminalPanel({
  scope,
  label,
  onClose,
  maximized,
  onToggleMaximize,
  className,
}: {
  scope: TerminalScope;
  /** Where these shells belong, shown when there is room. */
  label?: string;
  /** Hide the panel. Shells keep running. Omitted on the Terminal page. */
  onClose?: () => void;
  maximized?: boolean;
  onToggleMaximize?: () => void;
  className?: string;
}) {
  const scopeKey = scopeQuery(scope);
  const [tabs, setTabs] = useState<TerminalTab[]>([{ tab: null, title: null, program: null }]);
  const [active, setActive] = useState<string | null>(null);
  const [status, setStatus] = useState<TerminalStatus>("connecting");
  const [deckOpen, setDeckOpen] = useState(false);
  const surfaceRef = useRef<TerminalSurfaceHandle>(null);
  // Tabs this browser just opened or closed. A list poll that started before
  // the change must not undo it.
  const pendingAdds = useRef(new Set<string>());
  const pendingCloses = useRef(new Set<string>());
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const refresh = useCallback(async () => {
    try {
      const r = await omgFetch(`/api/term/list?${scopeKey}`);
      if (!r.ok) return;
      const d = (await r.json()) as { shells?: ShellInfo[] };
      if (!Array.isArray(d.shells)) return;
      const fromHost = tabsFromShells(scope, d.shells);
      setTabs((prev) => {
        const seen = new Set(fromHost.map(tabKey));
        for (const k of pendingAdds.current) if (seen.has(k)) pendingAdds.current.delete(k);
        const merged = fromHost.filter((t) => !pendingCloses.current.has(tabKey(t)));
        // Keep a tab this browser opened that the host has not created yet.
        for (const t of prev) {
          if (!seen.has(tabKey(t)) && pendingAdds.current.has(tabKey(t))) merged.push(t);
        }
        // An empty scope still shows one tab: attaching to it starts a shell.
        if (merged.length === 0) {
          const keep = prev.find((t) => tabKey(t) === "") ?? prev[0];
          return [keep ?? { tab: null, title: null, program: null }];
        }
        const same =
          merged.length === prev.length &&
          merged.every((t, i) => tabKey(t) === tabKey(prev[i]) && t.title === prev[i].title && t.program === prev[i].program);
        return same ? prev : merged;
      });
    } catch {}
    // `scope` is described by scopeKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

  useEffect(() => {
    setTabs([{ tab: null, title: null, program: null }]);
    setActive(null);
    pendingAdds.current.clear();
    pendingCloses.current.clear();
    void refresh();
    const iv = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 4000);
    return () => clearInterval(iv);
  }, [refresh]);

  // The active tab always exists: fall back to the first one.
  const activeTab = tabs.find((t) => tabKey(t) === (active ?? "")) ?? tabs[0];
  const activeKey = tabKey(activeTab);

  // Tab edits read the current list from a ref and compute synchronously:
  // whether the panel must close is known before any state update runs.
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;

  const addTab = useCallback(() => {
    const name = newTabName(tabsRef.current);
    pendingAdds.current.add(name);
    const next = [...tabsRef.current, { tab: name, title: null, program: null }];
    tabsRef.current = next;
    setTabs(next);
    setActive(name);
  }, []);

  // Drop a tab from the strip. The last one closes the panel; on the Terminal
  // page (no onClose) a fresh shell takes its place.
  const removeTab = useCallback((key: string) => {
    const prev = tabsRef.current;
    const index = prev.findIndex((t) => tabKey(t) === key);
    if (index < 0) return;
    const next = prev.filter((t) => tabKey(t) !== key);
    if (next.length === 0 && onCloseRef.current) {
      onCloseRef.current();
      return;
    }
    const list = next.length ? next : [{ tab: null, title: null, program: null }];
    tabsRef.current = list;
    setTabs(list);
    if (activeKeyRef.current === key) {
      setActive(tabKey(list[Math.min(index, list.length - 1)]));
    }
  }, []);

  const closeTab = useCallback(
    (t: TerminalTab) => {
      const key = tabKey(t);
      pendingCloses.current.add(key);
      void omgFetch(`/api/term/kill?${scopeQuery(scope, t.tab)}`, { method: "POST" })
        .catch(() => {})
        .finally(() => {
          // The host has dropped it now; a later shell may reuse the name.
          setTimeout(() => pendingCloses.current.delete(key), 5000);
        });
      removeTab(key);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scopeKey, removeTab],
  );

  const onExit = useCallback(() => {
    removeTab(activeKey);
  }, [activeKey, removeTab]);

  const onAttached = useCallback(
    (info: TerminalAttachedInfo) => {
      pendingAdds.current.delete(activeKey);
      setTabs((prev) =>
        prev.map((t) =>
          tabKey(t) === activeKey ? { ...t, title: info.title ?? t.title, program: info.program ?? t.program } : t,
        ),
      );
    },
    [activeKey],
  );

  const onTitle = useCallback(
    (title: string) => {
      setTabs((prev) => prev.map((t) => (tabKey(t) === activeKey && t.title !== title ? { ...t, title } : t)));
    },
    [activeKey],
  );

  return (
    <div
      data-testid="terminal-panel"
      className={`flex h-full min-h-0 flex-col overflow-hidden bg-[#0b0b0d] text-white ${className ?? ""}`}
    >
      <div className="flex h-9 shrink-0 items-stretch gap-1 border-b border-white/10 pl-2 pr-1.5 text-[12px]">
        <div role="tablist" aria-label="Terminals" className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto">
          {tabs.map((t, i) => {
            const key = tabKey(t);
            const selected = key === activeKey;
            return (
              <div
                key={key || "first"}
                className={`group flex max-w-[12rem] shrink-0 items-center border-b-2 ${
                  selected ? "border-white/80 text-white" : "border-transparent text-white/50 hover:text-white/80"
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  title={t.title ?? undefined}
                  onClick={() => {
                    setActive(key);
                    if (selected) surfaceRef.current?.focus();
                  }}
                  className="flex min-w-0 items-center gap-1.5 py-1 pl-1.5 pr-1 font-medium"
                  style={{ touchAction: "manipulation" }}
                >
                  <TerminalSquare className="size-3.5 shrink-0 opacity-70" />
                  <span className="truncate">{tabLabel(t, i)}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Close ${tabLabel(t, i)}`}
                  title="Close terminal (ends the shell)"
                  onClick={() => closeTab(t)}
                  className={`grid size-5 shrink-0 place-items-center rounded text-white/50 hover:bg-white/10 hover:text-white ${
                    selected ? "" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
                  } max-md:opacity-100`}
                  style={{ touchAction: "manipulation" }}
                >
                  <X className="size-3" />
                </button>
              </div>
            );
          })}
          <button
            type="button"
            aria-label="New terminal"
            title="New terminal"
            onClick={addTab}
            className="my-auto grid size-6 shrink-0 place-items-center rounded-md text-white/55 hover:bg-white/10 hover:text-white"
            style={{ touchAction: "manipulation" }}
          >
            <Plus className="size-3.5" />
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-white/55">
          {label ? <span className="hidden max-w-[16rem] truncate pr-1 text-[11px] lg:inline">{label}</span> : null}
          <span
            className={`size-1.5 rounded-full ${
              status === "open" ? "bg-emerald-400" : status === "closed" ? "bg-red-400" : "animate-pulse bg-white/50"
            }`}
            role="status"
            aria-label={`terminal ${status}`}
            title={`terminal ${status}`}
          />
          <button
            type="button"
            onClick={() => surfaceRef.current?.toggleDeck()}
            aria-pressed={deckOpen}
            aria-label="Terminal keys"
            title="Terminal keys (⌃⇧K)"
            className={`grid size-7 place-items-center rounded-md ${
              deckOpen ? "bg-white text-black" : "hover:bg-white/10 hover:text-white"
            }`}
            style={{ touchAction: "manipulation" }}
          >
            <Keyboard className="size-3.5" />
          </button>
          {onToggleMaximize ? (
            <button
              type="button"
              onClick={onToggleMaximize}
              aria-label={maximized ? "Restore terminal size" : "Maximize terminal"}
              title={maximized ? "Restore" : "Maximize"}
              className="grid size-7 place-items-center rounded-md hover:bg-white/10 hover:text-white"
              style={{ touchAction: "manipulation" }}
            >
              {maximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
            </button>
          ) : null}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Hide terminal"
              title="Hide terminal (shells keep running)"
              className="grid size-7 place-items-center rounded-md hover:bg-white/10 hover:text-white"
              style={{ touchAction: "manipulation" }}
            >
              <ChevronDown className="size-4" />
            </button>
          ) : null}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <TerminalSurface
          key={`${scopeKey}#${activeKey}`}
          ref={surfaceRef}
          query={scopeQuery(scope, activeTab.tab)}
          onStatus={setStatus}
          onAttached={onAttached}
          onTitle={onTitle}
          onExit={onExit}
          onDeckChange={setDeckOpen}
        />
      </div>
    </div>
  );
}

/**
 * The Terminal page: a full-height panel of global shells. The shell name
 * comes from localStorage so an agent login flow can point it at its own
 * terminal (`login-<agent>`).
 */
export function TermView() {
  const [name, setName] = useState(() => localStorage.getItem("lfg_term_session") || "main");
  useEffect(() => {
    const onSession = () => setName(localStorage.getItem("lfg_term_session") || "main");
    window.addEventListener("lfg:term-session", onSession);
    return () => window.removeEventListener("lfg:term-session", onSession);
  }, []);
  return (
    <div className="h-full overflow-hidden rounded-2xl border border-border">
      <TerminalPanel scope={{ name }} label={`terminal · ${name}`} />
    </div>
  );
}
