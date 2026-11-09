// What a session's agent says it is doing: its to-do list and its sub-agents.
//
// The agent harness (a separate process per session) owns the plan. It reads
// the agent's own planning events, folds them into one normalized shape, and
// writes it to `<data>/session-plans/<id>.json`. serve only reads that file:
// live-ws publishes it as a `plan` frame whenever it changes. The file outlives
// the harness, so a finished or restarted session still shows its last plan.
//
// Sources (see the trackers below):
// - Claude: TodoWrite (the whole list, every time), TaskCreate/TaskUpdate (one
//   task at a time), and the SDK's task_started/task_progress/task_updated/
//   task_notification events for sub-agents and background tasks.
// - Codex: the todo_list thread item (the whole list, with a done flag).
//
// The shapes mirror OmgSessionPlan in packages/protocol; the server does not
// import that package, so they are restated here.
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "./config.ts";

export type PlanItemStatus = "pending" | "in_progress" | "completed";
export type PlanItem = { id: string; text: string; activeText?: string; status: PlanItemStatus };
export type PlanAgentStatus = "running" | "completed" | "failed" | "stopped";
export type PlanAgent = {
  id: string;
  title: string;
  kind?: string;
  status: PlanAgentStatus;
  startedAt: number;
  endedAt?: number;
  detail?: string;
};
export type SessionPlan = { source: string; updatedAt: number; items: PlanItem[]; agents: PlanAgent[] };

const MAX_ITEMS = 100;
const MAX_AGENTS = 30;
const MAX_TEXT = 500;
const MAX_DETAIL = 300;

const plansDir = () => join(PATHS.data, "session-plans");

/** A session id as a file name, or null when it cannot be one. */
function planFile(sessionId: string): string | null {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(sessionId) || sessionId.startsWith(".")) return null;
  return join(plansDir(), `${sessionId}.json`);
}

const clip = (value: unknown, max: number): string => {
  const s = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

type Cached = { mtimeMs: number; size: number; plan: SessionPlan | null };
const cache = new Map<string, Cached>();

/** The session's plan, or null when it has none. Cached on the file's mtime. */
export function readSessionPlan(sessionId: string): SessionPlan | null {
  const path = planFile(sessionId);
  if (!path) return null;
  let st;
  try {
    st = statSync(path);
  } catch {
    cache.delete(path);
    return null;
  }
  const hit = cache.get(path);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.plan;
  let plan: SessionPlan | null = null;
  try {
    plan = normalizePlan(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    plan = null;
  }
  cache.set(path, { mtimeMs: st.mtimeMs, size: st.size, plan });
  return plan;
}

/** Replace the session's plan. Atomic: a reader never sees half a file. */
export function writeSessionPlan(sessionId: string, plan: SessionPlan): void {
  const path = planFile(sessionId);
  if (!path) return;
  mkdirSync(plansDir(), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(plan));
  renameSync(tmp, path);
  cache.delete(path);
}

const ITEM_STATUSES = new Set<PlanItemStatus>(["pending", "in_progress", "completed"]);
const AGENT_STATUSES = new Set<PlanAgentStatus>(["running", "completed", "failed", "stopped"]);

/** A plan from untrusted JSON: bounded, typed, or null. */
export function normalizePlan(raw: unknown): SessionPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const items: PlanItem[] = [];
  for (const it of Array.isArray(r.items) ? r.items.slice(0, MAX_ITEMS) : []) {
    if (!it || typeof it !== "object") continue;
    const i = it as Record<string, unknown>;
    const text = clip(i.text, MAX_TEXT);
    const status = i.status as PlanItemStatus;
    if (!text || !ITEM_STATUSES.has(status)) continue;
    const activeText = clip(i.activeText, MAX_TEXT);
    items.push({ id: clip(i.id, 64) || String(items.length + 1), text, status, ...(activeText ? { activeText } : {}) });
  }
  const agents: PlanAgent[] = [];
  for (const ag of Array.isArray(r.agents) ? r.agents.slice(-MAX_AGENTS) : []) {
    if (!ag || typeof ag !== "object") continue;
    const a = ag as Record<string, unknown>;
    const status = a.status as PlanAgentStatus;
    const id = clip(a.id, 128);
    if (!id || !AGENT_STATUSES.has(status)) continue;
    const kind = clip(a.kind, 64);
    const detail = clip(a.detail, MAX_DETAIL);
    agents.push({
      id,
      title: clip(a.title, 200) || "Sub-agent",
      status,
      startedAt: Number(a.startedAt) || 0,
      ...(Number(a.endedAt) ? { endedAt: Number(a.endedAt) } : {}),
      ...(kind ? { kind } : {}),
      ...(detail ? { detail } : {}),
    });
  }
  if (!items.length && !agents.length) return null;
  return { source: clip(r.source, 32) || "agent", updatedAt: Number(r.updatedAt) || 0, items, agents };
}

type Block = Record<string, unknown>;
const contentBlocks = (msg: Record<string, unknown>): Block[] => {
  const content = (msg.message as { content?: unknown } | undefined)?.content;
  return Array.isArray(content) ? (content.filter((b) => b && typeof b === "object") as Block[]) : [];
};
const resultText = (block: Block): string => {
  const c = block.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (p && typeof p === "object" && typeof (p as Block).text === "string" ? (p as Block).text : "")).join("\n");
  return "";
};
const itemStatus = (s: unknown): PlanItemStatus | null =>
  s === "pending" || s === "in_progress" || s === "completed" ? s : null;

/**
 * Folds one agent's planning events into a SessionPlan and writes it when it
 * changes. One per harness. Never throws into the caller: a plan is a view,
 * and a malformed event must not take the agent down with it.
 */
export class PlanTracker {
  private plan: SessionPlan;
  private lastWritten: string;
  /** TaskCreate calls waiting for the id their result carries. */
  private pendingTasks = new Map<string, string>();
  /** Agent tool calls the SDK also reports as tasks (their bookends own the status). */
  private taskBacked = new Set<string>();
  /** SDK task id → the agent row key (its tool_use_id when it has one). */
  private taskKeys = new Map<string, string>();

  constructor(
    private readonly sessionId: string,
    source: string,
    private readonly write: (id: string, plan: SessionPlan) => void = writeSessionPlan,
    private readonly now: () => number = Date.now,
    initial: SessionPlan | null = readSessionPlan(sessionId),
  ) {
    this.plan = initial ? { ...initial, source } : { source, updatedAt: 0, items: [], agents: [] };
    this.lastWritten = JSON.stringify({ items: this.plan.items, agents: this.plan.agents });
  }

  current(): SessionPlan {
    return this.plan;
  }

  /** One raw Claude Agent SDK message. */
  claudeMessage(msg: Record<string, unknown>): void {
    try {
      this.applyClaude(msg);
    } catch {}
    this.commit();
  }

  /** One Codex SDK thread event. */
  codexEvent(event: { type?: string; item?: unknown }): void {
    try {
      const item = event.item as Block | undefined;
      if (!item || item.type !== "todo_list" || !Array.isArray(item.items)) return;
      if (event.type !== "item.started" && event.type !== "item.updated" && event.type !== "item.completed") return;
      const live = event.type !== "item.completed";
      let current = false;
      this.plan.items = (item.items as Block[]).slice(0, MAX_ITEMS).flatMap((t, i) => {
        const text = clip(t.text, MAX_TEXT);
        if (!text) return [];
        let status: PlanItemStatus = t.completed ? "completed" : "pending";
        // Codex marks only done or not. While its turn runs, the first open
        // step is the one it is on; once the turn ends, nothing is.
        if (status === "pending" && live && !current) {
          status = "in_progress";
          current = true;
        }
        return [{ id: String(i + 1), text, status }];
      });
    } catch {}
    this.commit();
  }

  private applyClaude(msg: Record<string, unknown>): void {
    const type = msg.type;
    if (type === "system") return this.applyClaudeTask(msg);
    // A sub-agent's own to-do list is its business; only the session's
    // top-level calls make the plan.
    if (msg.parent_tool_use_id != null) return;
    if (type === "assistant") {
      for (const block of contentBlocks(msg)) {
        if (block.type !== "tool_use") continue;
        const id = typeof block.id === "string" ? block.id : "";
        const name = typeof block.name === "string" ? block.name : "";
        const input = (block.input && typeof block.input === "object" ? block.input : {}) as Block;
        if (name === "TodoWrite" && Array.isArray(input.todos)) {
          this.plan.items = (input.todos as Block[]).slice(0, MAX_ITEMS).flatMap((t, i) => {
            const text = clip(t.content, MAX_TEXT);
            const status = itemStatus(t.status);
            if (!text || !status) return [];
            const activeText = clip(t.activeForm, MAX_TEXT);
            return [{ id: `todo-${i + 1}`, text, status, ...(activeText ? { activeText } : {}) }];
          });
        } else if (name === "TaskCreate") {
          const text = clip(input.subject, MAX_TEXT);
          if (!text || this.plan.items.length >= MAX_ITEMS) continue;
          const activeText = clip(input.activeForm, MAX_TEXT);
          // Shown at once under a provisional id; the result names the real one.
          this.plan.items.push({ id: `pending:${id}`, text, status: "pending", ...(activeText ? { activeText } : {}) });
          this.pendingTasks.set(id, `pending:${id}`);
        } else if (name === "TaskUpdate") {
          const taskId = clip(input.taskId, 64);
          const at = this.plan.items.findIndex((it) => it.id === taskId);
          if (at < 0) continue;
          if (input.status === "deleted") {
            this.plan.items.splice(at, 1);
            continue;
          }
          const item = { ...this.plan.items[at] };
          const status = itemStatus(input.status);
          if (status) item.status = status;
          const subject = clip(input.subject, MAX_TEXT);
          if (subject) item.text = subject;
          const activeText = clip(input.activeForm, MAX_TEXT);
          if (activeText) item.activeText = activeText;
          this.plan.items[at] = item;
        } else if ((name === "Agent" || name === "Task") && typeof input.prompt === "string" && id) {
          this.upsertAgent(id, {
            title: clip(input.description, 200) || "Sub-agent",
            ...(clip(input.subagent_type, 64) ? { kind: clip(input.subagent_type, 64) } : {}),
          });
        }
      }
      return;
    }
    if (type === "user") {
      const structured = msg.tool_use_result as Block | undefined;
      for (const block of contentBlocks(msg)) {
        if (block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
        const toolUseId = block.tool_use_id;
        const provisional = this.pendingTasks.get(toolUseId);
        if (provisional) {
          this.pendingTasks.delete(toolUseId);
          const task = structured?.task as Block | undefined;
          const realId = clip(task?.id, 64) || /#\s*([A-Za-z0-9_-]+)/.exec(resultText(block))?.[1] || "";
          const item = this.plan.items.find((it) => it.id === provisional);
          if (item && block.is_error) this.plan.items = this.plan.items.filter((it) => it !== item);
          else if (item && realId) item.id = realId;
          continue;
        }
        // A foreground Agent call ends with its result. One the SDK tracks as
        // a task (background agents return at once) ends with its bookend.
        const agent = this.plan.agents.find((a) => a.id === toolUseId);
        if (agent && agent.status === "running" && !this.taskBacked.has(toolUseId)) {
          const text = resultText(block);
          if (/running in the background|async agent|launched in the background/i.test(text)) continue;
          this.finishAgent(agent, block.is_error ? "failed" : "completed", undefined);
        }
      }
    }
  }

  private applyClaudeTask(msg: Record<string, unknown>): void {
    const subtype = msg.subtype;
    const taskId = typeof msg.task_id === "string" ? msg.task_id : "";
    if (!taskId) return;
    const toolUseId = typeof msg.tool_use_id === "string" ? msg.tool_use_id : "";
    const key = this.taskKeys.get(taskId) ?? (toolUseId || taskId);
    if (subtype === "task_started") {
      // Housekeeping tasks the SDK itself hides from the transcript.
      if (msg.skip_transcript === true) return;
      this.taskKeys.set(taskId, key);
      if (toolUseId) this.taskBacked.add(toolUseId);
      const kind = clip(msg.subagent_type, 64) || clip(msg.workflow_name, 64) || clip(msg.task_type, 64);
      this.upsertAgent(key, {
        title: clip(msg.description, 200) || "Background task",
        ...(kind ? { kind } : {}),
      });
      return;
    }
    const agent = this.plan.agents.find((a) => a.id === key);
    if (!agent) return;
    if (toolUseId) this.taskBacked.add(toolUseId);
    if (subtype === "task_progress") {
      // A progress event's description is the current activity ("Reading
      // two.txt"), not the sub-agent's name: it goes in the detail line.
      const tool = clip(msg.last_tool_name, 64);
      const detail =
        clip(msg.summary, MAX_DETAIL) || clip(msg.description, MAX_DETAIL) || (tool ? `Using ${tool}` : "");
      if (detail) agent.detail = detail;
    } else if (subtype === "task_updated") {
      const patch = (msg.patch && typeof msg.patch === "object" ? msg.patch : {}) as Block;
      const description = clip(patch.description, 200);
      if (description) agent.title = description;
      const s = patch.status;
      if (s === "completed") this.finishAgent(agent, "completed", undefined, Number(patch.end_time) || undefined);
      else if (s === "failed") this.finishAgent(agent, "failed", clip(patch.error, MAX_DETAIL) || undefined, Number(patch.end_time) || undefined);
      else if (s === "killed") this.finishAgent(agent, "stopped", undefined, Number(patch.end_time) || undefined);
      else if (s === "running" || s === "pending" || s === "paused") agent.status = "running";
    } else if (subtype === "task_notification") {
      const s = msg.status;
      const status: PlanAgentStatus = s === "failed" ? "failed" : s === "stopped" ? "stopped" : "completed";
      this.finishAgent(agent, status, clip(msg.summary, MAX_DETAIL) || undefined);
    }
  }

  private upsertAgent(id: string, fields: { title: string; kind?: string }): void {
    const existing = this.plan.agents.find((a) => a.id === id);
    if (existing) {
      existing.title = fields.title || existing.title;
      if (fields.kind) existing.kind = fields.kind;
      return;
    }
    this.plan.agents.push({ id, status: "running", startedAt: this.now(), ...fields });
    // Keep the newest; drop the oldest finished ones first.
    while (this.plan.agents.length > MAX_AGENTS) {
      const done = this.plan.agents.findIndex((a) => a.status !== "running");
      this.plan.agents.splice(done >= 0 ? done : 0, 1);
    }
  }

  private finishAgent(agent: PlanAgent, status: PlanAgentStatus, detail?: string, endedAt?: number): void {
    agent.status = status;
    agent.endedAt = endedAt ?? agent.endedAt ?? this.now();
    if (detail) agent.detail = detail;
  }

  private commit(): void {
    const sig = JSON.stringify({ items: this.plan.items, agents: this.plan.agents });
    if (sig === this.lastWritten) return;
    this.lastWritten = sig;
    this.plan = { ...this.plan, updatedAt: this.now() };
    try {
      this.write(this.sessionId, this.plan);
    } catch {}
  }
}
