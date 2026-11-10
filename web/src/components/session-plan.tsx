// What the session's agent says it is doing: its to-do list and sub-agents.
//
// The agent harness writes the plan (src/session-plan.ts); the live socket
// sends it whole on every change as a `plan` event. This module shows it in
// three places: a chip in the session header, a page a phone swipes to from
// the chat, and a pane on the right of the chat on wider screens.
//
// Agents do not let anyone else edit their to-do list, so the actions here
// ("Do this next", "Skip", a note) are short messages to the agent about a
// step it already has, sent like any other message in the chat. The list
// itself is only ever the agent's.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { OmgPlanAgent, OmgPlanItem, OmgSessionPlan } from "@omg-dev/protocol";
import {
  Bot,
  ChevronLeft,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleStop,
  CircleX,
  ListTodo,
  LoaderCircle,
  Send,
} from "lucide-react";
import type { OmgTranscriptSubscribe } from "@/lib/omg-chat-transport";
import { openSessionRef } from "@/lib/session-ref-link";
import { flattenTeam, useSessionTeam, type TeamMember } from "@/lib/session-team";
import { PanelStatusSection, TeamNeedsSection, useTeamQuestions } from "./session-panel-sections";

export type SessionPlan = OmgSessionPlan;

/** How far along the plan is, and what the agent is on now. */
export function planProgress(plan: SessionPlan | null): {
  done: number;
  total: number;
  current: OmgPlanItem | null;
  running: number;
} {
  const items = plan?.items ?? [];
  return {
    done: items.filter((i) => i.status === "completed").length,
    total: items.length,
    current: items.find((i) => i.status === "in_progress") ?? null,
    running: (plan?.agents ?? []).filter((a) => a.status === "running").length,
  };
}

/** True when the agent's own plan or status has anything to show. */
export const hasPlan = (plan: SessionPlan | null): plan is SessionPlan =>
  !!plan && (plan.items.length > 0 || plan.agents.length > 0 || !!plan.status);

/** True when the pane has anything to show: the plan, the status, or a team of child sessions. */
export const hasPanel = (plan: SessionPlan | null, team: readonly TeamMember[] = []): boolean =>
  hasPlan(plan) || team.length > 0;

/** Child sessions working now, at any depth. */
export const teamWorking = (team: readonly TeamMember[]): number =>
  flattenTeam(team).filter((m) => m.state === "working").length;

/** "now", "40s", "5m", "3h", "2d": how long ago, coarse. */
export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return "now";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * The session's plan, live. Listens passively: the chat holds the session's
 * subscription, and the client replays the current plan to a late listener.
 */
export function useSessionPlan(sid: string | null | undefined, subscribe?: OmgTranscriptSubscribe): SessionPlan | null {
  const [plan, setPlan] = useState<SessionPlan | null>(null);
  useEffect(() => {
    setPlan(null);
    if (!sid || !subscribe) return;
    return subscribe(
      sid,
      (event) => {
        if (event.type === "plan") setPlan(event.plan ?? null);
      },
      { passive: true },
    );
  }, [sid, subscribe]);
  return plan;
}

// Whether the desktop pane is open: one choice for every session, as an
// editor's side bar is.
const PANE_KEY = "lfg_plan_pane_open";
const paneListeners = new Set<() => void>();
function readPaneOpen(): boolean {
  try {
    return localStorage.getItem(PANE_KEY) !== "0";
  } catch {
    return true;
  }
}
export function setPlanPaneOpen(open: boolean): void {
  try {
    localStorage.setItem(PANE_KEY, open ? "1" : "0");
  } catch {}
  paneListeners.forEach((l) => l());
}
export function usePlanPaneOpen(): boolean {
  return useSyncExternalStore(
    (l) => {
      paneListeners.add(l);
      return () => paneListeners.delete(l);
    },
    readPaneOpen,
    () => true,
  );
}

/** The message an action sends. Plain sentences: the agent reads them as the user's words. */
export function planActionMessage(
  action: "next" | "skip" | "note",
  item: Pick<OmgPlanItem, "text">,
  note = "",
): string {
  const step = `"${item.text}"`;
  if (action === "next") return `Please do this step next: ${step}.`;
  if (action === "skip") return `Please skip this step: ${step}.`;
  return `About the step ${step}: ${note.trim()}`;
}

function elapsed(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

/** Re-render once a second while something is running, for the clocks. */
function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/**
 * The header chip: "3/7", the current step on wider screens while the plan is
 * closed, and how many agents are working (the session's own sub-agents and
 * its child sessions). Opens the plan.
 */
export function SessionPlanChip({
  plan,
  team = [],
  onClick,
  pressed,
  className = "",
}: {
  plan: SessionPlan | null;
  team?: readonly TeamMember[];
  onClick: () => void;
  pressed?: boolean;
  className?: string;
}) {
  const needs = useTeamQuestions(team).length;
  if (!hasPanel(plan, team)) return null;
  const { done, total, current, running } = planProgress(plan);
  const working = running + teamWorking(team);
  // On wide screens the chip says what the agent is on: its own headline
  // first, then the current step.
  const now = plan?.status?.headline || (current ? current.activeText || current.text : "");
  const parts = [
    needs ? `${needs} need${needs === 1 ? "s" : ""} you` : "",
    total ? `${done} of ${total} done` : "",
    now ? `now ${now}` : "",
    working ? `${working} agent${working === 1 ? "" : "s"} working` : "",
  ].filter(Boolean);
  const label = `Plan${parts.length ? `: ${parts.join(", ")}` : ""}`;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      data-testid="session-plan-chip"
      className={`flex h-8 min-w-0 shrink items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted ${
        pressed ? "bg-muted" : ""
      } ${className}`}
    >
      <ListTodo className="size-3.5 shrink-0 text-muted-foreground" />
      {needs ? (
        <span className="flex shrink-0 items-center gap-0.5 text-amber-600 dark:text-amber-400">
          <CircleAlert className="size-3.5" />
          <span className="tabular-nums">{needs}</span>
        </span>
      ) : null}
      {total ? <span className="shrink-0 tabular-nums">{done}/{total}</span> : null}
      {now && !pressed ? (
        <span className="hidden max-w-[16rem] truncate text-muted-foreground lg:inline">{now}</span>
      ) : null}
      {working ? (
        <span className="flex shrink-0 items-center gap-0.5 text-sky-600 dark:text-sky-400">
          <Bot className="size-3.5" />
          <span className="tabular-nums">{working}</span>
        </span>
      ) : null}
    </button>
  );
}

function ItemIcon({ status }: { status: OmgPlanItem["status"] }) {
  if (status === "completed") return <CircleCheck className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />;
  if (status === "in_progress") return <LoaderCircle className="size-4 animate-spin text-sky-600 dark:text-sky-400" aria-hidden />;
  return <Circle className="size-4 text-muted-foreground/50" aria-hidden />;
}

const STATUS_WORD: Record<OmgPlanItem["status"], string> = {
  completed: "Done",
  in_progress: "In progress",
  pending: "To do",
};

type SendState = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "error"; message: string };

function useSender(send: (text: string) => Promise<void>) {
  const [state, setState] = useState<SendState>({ kind: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const run = useCallback(
    async (text: string): Promise<boolean> => {
      if (!text.trim()) return false;
      setState({ kind: "sending" });
      try {
        await send(text);
        setState({ kind: "sent" });
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setState({ kind: "idle" }), 2500);
        return true;
      } catch (e) {
        setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
        return false;
      }
    },
    [send],
  );
  return { state, run };
}

function PlanItemRow({
  item,
  open,
  onToggle,
  onAction,
  busy,
}: {
  item: OmgPlanItem;
  open: boolean;
  onToggle: () => void;
  onAction: (text: string) => Promise<boolean>;
  busy: boolean;
}) {
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState("");
  const done = item.status === "completed";
  const current = item.status === "in_progress";
  useEffect(() => {
    if (!open) setNoting(false);
  }, [open]);
  return (
    <li data-testid="plan-item" data-status={item.status} className="px-1.5">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-muted/60 ${
          current ? "bg-sky-500/[0.07]" : ""
        } ${open ? "bg-muted/60" : ""}`}
      >
        <span className="mt-px shrink-0">
          <ItemIcon status={item.status} />
        </span>
        <span
          className={`min-w-0 flex-1 text-[13px] leading-5 ${
            done
              ? "text-muted-foreground line-through decoration-muted-foreground/30"
              : current
                ? "font-medium text-foreground"
                : "text-foreground/90"
          }`}
        >
          {current && item.activeText ? item.activeText : item.text}
        </span>
        <span className="sr-only">{STATUS_WORD[item.status]}</span>
      </button>
      {open ? (
        <div className="pb-1.5 pl-9 pr-2.5 pt-1" data-testid="plan-item-actions">
          {noting ? (
            <form
              className="flex items-end gap-1.5"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await onAction(planActionMessage("note", item, note))) {
                  setNote("");
                  setNoting(false);
                }
              }}
            >
              <textarea
                autoFocus
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="What should the agent know?"
                aria-label="Note for the agent"
                className="min-h-[2.25rem] flex-1 resize-none rounded-lg border border-border bg-background px-2.5 py-1.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
              />
              <button
                type="submit"
                disabled={busy || !note.trim()}
                aria-label="Send note"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background disabled:opacity-40"
              >
                <Send className="size-3.5" />
              </button>
            </form>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {item.status === "pending" ? (
                <ActionButton disabled={busy} onClick={() => void onAction(planActionMessage("next", item))}>
                  Do this next
                </ActionButton>
              ) : null}
              {!done ? (
                <ActionButton disabled={busy} onClick={() => void onAction(planActionMessage("skip", item))}>
                  Skip
                </ActionButton>
              ) : null}
              <ActionButton disabled={busy} onClick={() => setNoting(true)}>
                Add a note
              </ActionButton>
            </div>
          )}
        </div>
      ) : null}
    </li>
  );
}

function ActionButton({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-7 rounded-full border border-border bg-background px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
    >
      {children}
    </button>
  );
}

const AGENT_WORD: Record<OmgPlanAgent["status"], string> = {
  running: "Running",
  completed: "Done",
  failed: "Failed",
  stopped: "Stopped",
};

function AgentIcon({ status }: { status: OmgPlanAgent["status"] }) {
  if (status === "running") return <LoaderCircle className="size-4 animate-spin text-sky-600 dark:text-sky-400" aria-hidden />;
  if (status === "completed") return <CircleCheck className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />;
  if (status === "failed") return <CircleX className="size-4 text-red-600 dark:text-red-400" aria-hidden />;
  return <CircleStop className="size-4 text-muted-foreground" aria-hidden />;
}

/** One line per sub-agent. A running or failed one adds what it is doing, or why it failed. */
function AgentRow({ agent, now }: { agent: OmgPlanAgent; now: number }) {
  const took = agent.startedAt ? elapsed((agent.endedAt ?? now) - agent.startedAt) : null;
  const line = [agent.kind, agent.detail].filter(Boolean).join(" · ");
  const showLine = !!line && (agent.status === "running" || agent.status === "failed");
  return (
    <li
      data-testid="plan-agent"
      data-status={agent.status}
      title={line || undefined}
      className="flex items-start gap-2.5 px-4 py-1.5"
    >
      <span className="mt-px shrink-0">
        <AgentIcon status={agent.status} />
      </span>
      <span className="min-w-0 flex-1 leading-5">
        <span className={`block truncate text-[13px] ${agent.status === "running" ? "text-foreground" : "text-muted-foreground"}`}>
          {agent.title}
        </span>
        {showLine ? (
          <span
            className={`block truncate text-[11px] leading-4 ${
              agent.status === "failed" ? "text-red-600/90 dark:text-red-400/90" : "text-muted-foreground"
            }`}
          >
            {line}
          </span>
        ) : null}
      </span>
      <span className="sr-only">{AGENT_WORD[agent.status]}</span>
      {took ? <span className="shrink-0 text-[11px] leading-5 tabular-nums text-muted-foreground">{took}</span> : null}
    </li>
  );
}

function TeamStateIcon({ state }: { state: TeamMember["state"] }) {
  if (state === "working") return <LoaderCircle className="size-4 animate-spin text-sky-600 dark:text-sky-400" aria-hidden />;
  if (state === "blocked") return <CircleAlert className="size-4 text-amber-600 dark:text-amber-400" aria-hidden />;
  return (
    <span className="flex size-4 items-center justify-center" aria-hidden>
      <span className="size-1.5 rounded-full bg-muted-foreground/50" />
    </span>
  );
}

const TEAM_WORD: Record<TeamMember["state"], string> = { working: "Working", blocked: "Blocked", idle: "Idle" };

/**
 * One child session: its state, title, latest activity and, when its agent
 * keeps one, its progress and running sub-agents. Its own children nest under
 * it. A tap opens the session.
 */
function TeamRow({ member, now, onOpen }: { member: TeamMember; now: number; onOpen: (id: string) => void }) {
  const plan = member.plan;
  // What the child says about itself beats what it did last ("Running a
  // command"); a blocked child's reason beats both.
  const line = (member.state === "blocked" ? member.activity : "") || plan?.headline || member.activity || plan?.current || "";
  return (
    <li data-testid="team-member" data-state={member.state} data-id={member.id}>
      <button
        type="button"
        onClick={() => onOpen(member.id)}
        title={member.title}
        className="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-muted/60"
      >
        <span className="mt-px shrink-0">
          <TeamStateIcon state={member.state} />
        </span>
        <span className="min-w-0 flex-1 leading-5">
          <span className={`block truncate text-[13px] ${member.state === "idle" ? "text-muted-foreground" : "text-foreground"}`}>
            {member.title}
          </span>
          {line || plan?.total ? (
            <span
              className={`flex min-w-0 items-center gap-1.5 text-[11px] leading-4 ${
                member.state === "blocked" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"
              }`}
            >
              {plan?.total ? (
                <span className="shrink-0 rounded bg-muted px-1 tabular-nums text-foreground/80">
                  {plan.done}/{plan.total}
                </span>
              ) : null}
              <span className="truncate">{line}</span>
            </span>
          ) : null}
        </span>
        <span className="sr-only">{TEAM_WORD[member.state]}</span>
        <span className="shrink-0 text-right text-[11px] leading-5 text-muted-foreground">
          {member.agent}
          {member.lastActivityAt ? <span className="tabular-nums"> · {ago(now - member.lastActivityAt)}</span> : null}
        </span>
      </button>
      {plan?.running.length ? (
        <ul aria-label="Sub-agents" className="mb-0.5 ml-[1.15rem] border-l border-border/60 pl-3">
          {plan.running.map((a, i) => (
            <li key={i} data-testid="team-subagent" className="flex min-w-0 items-center gap-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground">
              <LoaderCircle className="size-3 shrink-0 animate-spin text-sky-600 dark:text-sky-400" aria-hidden />
              <span className="truncate">
                <span className="text-foreground/80">{a.title}</span>
                {a.detail || a.kind ? ` · ${a.detail || a.kind}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {member.children.length ? (
        <ul className="ml-[1.15rem] border-l border-border/60 pl-1">
          {member.children.map((child) => (
            <TeamRow key={child.id} member={child} now={now} onOpen={onOpen} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

const openTeamMember = (id: string) => void openSessionRef(`omg:session_${id}`);

/** The child sessions this session started, and theirs, as a tree. */
function TeamSection({ team, now, onOpen }: { team: readonly TeamMember[]; now: number; onOpen: (id: string) => void }) {
  const all = flattenTeam(team);
  const working = all.filter((m) => m.state === "working").length;
  const blocked = all.filter((m) => m.state === "blocked").length;
  return (
    <section aria-label="Team" data-testid="plan-team" className="mx-4 mt-3 border-t border-border/60 pt-2 first:mt-0 first:border-t-0 first:pt-3">
      <h3 className="pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Team · {all.length}
        {working ? ` · ${working} working` : ""}
        {blocked ? ` · ${blocked} blocked` : ""}
      </h3>
      <ul className="-mx-2.5">
        {team.map((member) => (
          <TeamRow key={member.id} member={member} now={now} onOpen={onOpen} />
        ))}
      </ul>
    </section>
  );
}

/**
 * The plan itself: progress, steps and sub-agents. The agent owns the list;
 * the only input here is a message about a step the agent already has.
 */
export function SessionPlanView({
  plan,
  team = [],
  send,
  onOpenMember = openTeamMember,
  className = "",
}: {
  plan: SessionPlan | null;
  team?: readonly TeamMember[];
  send: (text: string) => Promise<void>;
  onOpenMember?: (id: string) => void;
  className?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [showFinished, setShowFinished] = useState(false);
  const { state, run } = useSender(send);
  const { done, total, running } = planProgress(plan);
  const needs = useTeamQuestions(team);
  const status = plan?.status;
  const now = useTick(running > 0 || team.length > 0 || !!status);
  const items = plan?.items ?? [];
  // Newest first. Running sub-agents stay in view; finished ones fold away.
  const agents = [...(plan?.agents ?? [])].reverse();
  const live = agents.filter((a) => a.status === "running");
  const finished = agents.filter((a) => a.status !== "running");
  const busy = state.kind === "sending";
  const act = useCallback(
    async (text: string) => {
      const ok = await run(text);
      if (ok) setOpenId(null);
      return ok;
    },
    [run],
  );
  return (
    <div data-testid="session-plan" className={`relative flex min-h-0 flex-1 flex-col ${className}`}>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(1rem+var(--lfg-safe-bottom,0px))]">
        <TeamNeedsSection needs={needs} onOpen={onOpenMember} />
        {status ? <PanelStatusSection status={status} ago={ago(now - status.updatedAt)} /> : null}
        {total ? (
          <div className={`flex items-center gap-3 px-4 pb-1.5 pt-3 ${status ? "mx-4 mt-3 border-t border-border/60 px-0" : ""}`}>
            <div
              className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={done}
              aria-label="Plan progress"
            >
              <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-300" style={{ width: `${(done / total) * 100}%` }} />
            </div>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {done} of {total} done
            </span>
          </div>
        ) : null}
        {items.length ? (
          <ul aria-label="To-do list" className="flex flex-col gap-px">
            {items.map((item) => (
              <PlanItemRow
                key={item.id}
                item={item}
                open={openId === item.id}
                onToggle={() => setOpenId((cur) => (cur === item.id ? null : item.id))}
                onAction={act}
                busy={busy}
              />
            ))}
          </ul>
        ) : team.length || status ? null : (
          <div className="px-4 py-8 text-center">
            <ListTodo className="mx-auto size-5 text-muted-foreground/50" aria-hidden />
            <p className="mt-2 text-[13px] text-muted-foreground">No to-do list yet. When the agent plans its work, the steps show here.</p>
          </div>
        )}
        {team.length ? <TeamSection team={team} now={now} onOpen={onOpenMember} /> : null}
        {agents.length ? (
          <section aria-label="Sub-agents" className="mx-4 mt-3 border-t border-border/60 pt-2 first:mt-0 first:border-t-0 first:pt-3">
            <h3 className="-mx-4 flex items-center px-4 pb-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span className="flex-1">
                Sub-agents{live.length ? ` · ${live.length} running` : ""}
              </span>
              {finished.length ? (
                <button
                  type="button"
                  onClick={() => setShowFinished((v) => !v)}
                  aria-expanded={showFinished}
                  className="-mr-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium normal-case tracking-normal text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {showFinished ? "Hide finished" : `${finished.length} finished`}
                </button>
              ) : null}
            </h3>
            <ul className="-mx-4">
              {live.map((agent) => (
                <AgentRow key={agent.id} agent={agent} now={now} />
              ))}
              {showFinished ? finished.map((agent) => <AgentRow key={agent.id} agent={agent} now={now} />) : null}
            </ul>
          </section>
        ) : null}
      </div>
      <div
        aria-live="polite"
        className={`pointer-events-none absolute inset-x-0 bottom-[calc(0.75rem+var(--lfg-safe-bottom,0px))] flex justify-center transition-opacity duration-200 ${
          state.kind === "sent" || state.kind === "error" ? "opacity-100" : "opacity-0"
        }`}
      >
        {state.kind === "sent" ? (
          <span className="rounded-full bg-foreground px-3 py-1 text-xs font-medium text-background shadow-sm">Sent to the agent</span>
        ) : null}
        {state.kind === "error" ? (
          <span className="pointer-events-auto max-w-[90%] rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white shadow-sm">
            Could not send: {state.message}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** The phone page: the plan, full screen, over the chat it came from. */
export function SessionPlanScreen({
  plan,
  team,
  send,
  onBack,
}: {
  plan: SessionPlan | null;
  team?: readonly TeamMember[];
  send: (text: string) => Promise<void>;
  onBack: () => void;
}) {
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div
        className="flex items-center gap-2 border-b border-border px-4 pb-3"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.75rem)" }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to chat"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg text-foreground hover:bg-muted"
        >
          <ChevronLeft className="size-5" />
        </button>
        <h2 className="min-w-0 flex-1 text-base font-semibold leading-tight">Plan</h2>
      </div>
      <SessionPlanView plan={plan} team={team} send={send} />
    </div>
  );
}

/** The desktop pane, on the right of the chat. The header chip opens and closes it. */
export function SessionPlanPane({
  plan,
  team,
  send,
}: {
  plan: SessionPlan | null;
  team?: readonly TeamMember[];
  send: (text: string) => Promise<void>;
}) {
  return (
    <aside
      aria-label="Plan"
      data-testid="session-plan-pane"
      className="hidden w-80 shrink-0 flex-col border-l border-border bg-[var(--lfg-pane-bg,var(--background))] @3xl:flex @6xl:w-96"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
        <ListTodo className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="flex-1 text-sm font-semibold">Plan</h2>
      </div>
      <SessionPlanView plan={plan} team={team} send={send} />
    </aside>
  );
}

/** The desktop header chip: opens and closes the pane. */
export function SessionPlanToggleChip({ sid, subscribe }: { sid: string | null; subscribe?: OmgTranscriptSubscribe }) {
  const plan = useSessionPlan(sid, subscribe);
  const team = useSessionTeam(sid);
  const open = usePlanPaneOpen();
  return (
    <SessionPlanChip plan={plan} team={team} pressed={open} onClick={() => setPlanPaneOpen(!open)} className="hidden md:flex" />
  );
}
