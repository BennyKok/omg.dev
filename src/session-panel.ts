// What a long-running agent wants the person to see at a glance: its status.
//
// The agent writes it with the omg_panel MCP tool, which calls serve, which
// stores it here as `<data>/session-panels/<id>.json`. This module is the only
// writer. The plan (src/session-plan.ts) is a separate file with a separate
// owner, the agent's harness; live-ws reads both and sends them in one `plan`
// frame, so the browser keeps one cache and one subscription.
//
// The status is data, never markup: a headline, markdown text, a few numbers,
// and one chart as plain numbers. The browser renders all of it with its own
// components, so it always matches the app's design and carries no script.
//
// The shapes mirror OmgPanelStatus in packages/protocol; the server does not
// import that package, so they are restated here.
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "./config.ts";

export type PanelTone = "good" | "warn" | "bad";
export type PanelStat = { label: string; value: string; tone?: PanelTone };
export type PanelChartPoint = { label: string; value: number };
export type PanelChart = { title?: string; kind: "line" | "bar"; unit?: string; points: PanelChartPoint[] };
export type PanelStatus = {
  updatedAt: number;
  /** One line: where the work stands. Also shown on the parent's Team row. */
  headline: string;
  /** Markdown. */
  text?: string;
  stats?: PanelStat[];
  chart?: PanelChart;
};

export const PANEL_LIMITS = {
  headline: 120,
  text: 4000,
  stats: 8,
  statLabel: 40,
  statValue: 40,
  chartTitle: 80,
  chartUnit: 16,
  points: 120,
  pointLabel: 24,
} as const;

const TONES = new Set<PanelTone>(["good", "warn", "bad"]);

const line = (value: unknown, max: number): string => {
  const s = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

const block = (value: unknown, max: number): string => {
  const s = typeof value === "string" ? value.replace(/\r\n?/g, "\n").trim() : "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

export class PanelInputError extends Error {}

/**
 * A status from untrusted input: bounded and typed.
 *
 * `strict` (the write path) rejects input the agent should fix: no headline,
 * a chart with no points, a value that is not a number. Reading a stored file
 * is lenient and drops what does not fit, so one bad field never hides the rest.
 */
export function normalizePanelStatus(raw: unknown, strict = false): PanelStatus | null {
  const fail = (message: string) => {
    if (strict) throw new PanelInputError(message);
    return null;
  };
  if (!raw || typeof raw !== "object") return fail("status must be an object");
  const r = raw as Record<string, unknown>;
  const headline = line(r.headline, PANEL_LIMITS.headline);
  if (!headline) return fail("headline is required");
  const status: PanelStatus = {
    updatedAt: typeof r.updatedAt === "number" && Number.isFinite(r.updatedAt) ? r.updatedAt : Date.now(),
    headline,
  };
  const text = block(r.text, PANEL_LIMITS.text);
  if (text) status.text = text;

  if (r.stats !== undefined) {
    if (!Array.isArray(r.stats)) return fail("stats must be a list");
    if (strict && r.stats.length > PANEL_LIMITS.stats) fail(`at most ${PANEL_LIMITS.stats} stats`);
    const stats: PanelStat[] = [];
    for (const s of r.stats.slice(0, PANEL_LIMITS.stats)) {
      const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
      const label = line(o.label, PANEL_LIMITS.statLabel);
      const value =
        typeof o.value === "number" && Number.isFinite(o.value)
          ? String(o.value)
          : line(o.value, PANEL_LIMITS.statValue);
      if (!label || !value) {
        if (strict) fail("every stat needs a label and a value");
        continue;
      }
      const tone = TONES.has(o.tone as PanelTone) ? (o.tone as PanelTone) : undefined;
      if (strict && o.tone !== undefined && !tone) fail("stat tone must be good, warn or bad");
      stats.push(tone ? { label, value, tone } : { label, value });
    }
    if (stats.length) status.stats = stats;
  }

  if (r.chart !== undefined && r.chart !== null) {
    const c = (typeof r.chart === "object" ? r.chart : {}) as Record<string, unknown>;
    const kind = c.kind === "bar" ? "bar" : c.kind === "line" || c.kind === undefined ? "line" : null;
    if (!kind) return fail("chart kind must be line or bar");
    if (!Array.isArray(c.points)) return fail("chart points must be a list");
    if (strict && c.points.length > PANEL_LIMITS.points) fail(`at most ${PANEL_LIMITS.points} chart points`);
    const points: PanelChartPoint[] = [];
    for (const p of c.points.slice(-PANEL_LIMITS.points)) {
      const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
      const value = o.value;
      if (typeof value !== "number" || !Number.isFinite(value)) {
        if (strict) fail("every chart point needs a finite number value");
        continue;
      }
      points.push({ label: line(o.label, PANEL_LIMITS.pointLabel), value });
    }
    if (!points.length) {
      if (strict) fail("a chart needs at least one point");
    } else {
      const chart: PanelChart = { kind, points };
      const title = line(c.title, PANEL_LIMITS.chartTitle);
      if (title) chart.title = title;
      const unit = line(c.unit, PANEL_LIMITS.chartUnit);
      if (unit) chart.unit = unit;
      status.chart = chart;
    }
  }
  return status;
}

const panelsDir = () => join(PATHS.data, "session-panels");

/** A session id as a file name, or null when it cannot be one. */
function panelFile(sessionId: string): string | null {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(sessionId) || sessionId.startsWith(".")) return null;
  return join(panelsDir(), `${sessionId}.json`);
}

type Cached = { mtimeMs: number; size: number; status: PanelStatus | null };
const cache = new Map<string, Cached>();

/** The session's status, or null when it has none. Cached on the file's mtime. */
export function readPanelStatus(sessionId: string): PanelStatus | null {
  const path = panelFile(sessionId);
  if (!path) return null;
  let st;
  try {
    st = statSync(path);
  } catch {
    cache.delete(path);
    return null;
  }
  const hit = cache.get(path);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.status;
  let status: PanelStatus | null = null;
  try {
    status = normalizePanelStatus(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    status = null;
  }
  cache.set(path, { mtimeMs: st.mtimeMs, size: st.size, status });
  return status;
}

/**
 * Replace the session's status with validated input. Atomic: a reader never
 * sees half a file. Throws PanelInputError for input the agent should fix.
 */
export function writePanelStatus(sessionId: string, raw: unknown): PanelStatus {
  const path = panelFile(sessionId);
  if (!path) throw new PanelInputError("bad session id");
  const status = normalizePanelStatus({ ...(raw as object), updatedAt: Date.now() }, true)!;
  mkdirSync(panelsDir(), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(status));
  renameSync(tmp, path);
  cache.delete(path);
  return status;
}

/** Remove the session's status. True when there was one. */
export function clearPanelStatus(sessionId: string): boolean {
  const path = panelFile(sessionId);
  if (!path) return false;
  cache.delete(path);
  try {
    statSync(path);
  } catch {
    return false;
  }
  rmSync(path, { force: true });
  return true;
}

const MAX_BODY = 64 * 1024;

/**
 * PUT (replace) or DELETE (clear) a session's status over HTTP.
 *
 * Only the session itself may write its status: `caller` is the session id
 * the request claims (the X-OMG-Session-ID header the MCP layer sets from
 * its own session, never from a tool argument), and it must be this session.
 */
export async function handlePanelRequest(req: Request, sessionId: string, caller: string | null): Promise<Response> {
  if (caller !== sessionId) {
    return Response.json({ error: "only the session itself can set its status" }, { status: 403 });
  }
  if (req.method === "DELETE") return Response.json({ ok: true, cleared: clearPanelStatus(sessionId) });
  if (req.method !== "PUT") return Response.json({ error: "method not allowed" }, { status: 405 });
  const text = await req.text().catch(() => "");
  if (text.length > MAX_BODY) return Response.json({ error: "status is too large" }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ error: "request body must be JSON" }, { status: 400 });
  }
  try {
    return Response.json({ ok: true, status: writePanelStatus(sessionId, body) });
  } catch (e) {
    if (e instanceof PanelInputError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}
