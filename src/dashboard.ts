// The local generative dashboard (omg_dashboard, /api/dashboard).
//
// Information-first, modelled on omg-admin: labels and numbers only, compact
// KPI tiles with deltas and sparklines, bar/line/breakdown charts, tables, and
// "Needs you" lists.
//
// Single owner for persistent dashboard views: `<data>/dashboard/dashboard.json`.
// Built-in views ("today" and "system") are computed live from the local
// runtime unless replaced or removed by an agent edit. Custom or edited views
// can also attach an executable refresh script inside the owning session's
// workspace; the server invokes it with explicit argv (never a shell) and
// merges the JSON output in place.
import { execFile } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { uptime } from "node:os";
import { hostMemory } from "./host-memory.ts";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { PATHS } from "./config.ts";

export type DashboardTone = "good" | "warn" | "bad" | "neutral";

export type DashboardKpi = {
  label: string;
  value: string;
  sub?: string;
  delta?: string;
  deltaTone?: DashboardTone;
  tone?: DashboardTone;
  spark?: number[];
};

export type DashboardChartPoint = {
  label: string;
  value: number;
  detail?: string;
  tone?: DashboardTone;
};

export type DashboardChart = {
  title: string;
  value?: string;
  sub?: string;
  kind: "bar" | "line" | "breakdown";
  unit?: string;
  points: DashboardChartPoint[];
};

export type DashboardTableColumn = {
  key: string;
  label: string;
  align?: "left" | "right";
};

export type DashboardTableRow = {
  id?: string;
  tone?: DashboardTone;
  cells: Record<string, string | number | null>;
};

export type DashboardTable = {
  title: string;
  sub?: string;
  columns: DashboardTableColumn[];
  rows: DashboardTableRow[];
};

export type DashboardListItem = {
  title: string;
  detail?: string;
  value?: string;
  when?: string;
  tone?: DashboardTone;
  badge?: string;
};

export type DashboardList = {
  title: string;
  count?: number | string;
  emptyText?: string;
  items: DashboardListItem[];
};

export type DashboardSection =
  | { kind: "kpis"; title?: string; items: DashboardKpi[] }
  | { kind: "chart"; chart: DashboardChart }
  | { kind: "charts"; title?: string; charts: DashboardChart[] }
  | { kind: "table"; table: DashboardTable }
  | { kind: "list"; list: DashboardList };

export type DashboardSourceConfig = {
  scriptPath: string;
  argv: string[];
  scopeRoot: string;
  /**
   * The session folder the script came from. The dashboard runs its own copy
   * (scriptPath, under <data>/dashboard/scripts), so a session worktree can be
   * cleaned up without stopping the refresh. The script still runs here when
   * the folder exists, so relative paths keep working.
   */
  workspace?: string;
  intervalSeconds: number;
  timeoutSeconds: number;
  enabled: boolean;
  status: "idle" | "running" | "ok" | "error";
  lastRefreshedAt?: number;
  lastError?: string;
};

export type DashboardView = {
  id: string;
  title: string;
  order?: number;
  updatedAt: number;
  builtin?: boolean;
  kpis?: DashboardKpi[];
  sections?: DashboardSection[];
  source?: DashboardSourceConfig;
};

export type DashboardStoreData = {
  version: 1;
  updatedAt: number;
  editorSessionId?: string | null;
  hiddenBuiltins?: string[];
  views: Record<string, DashboardView>;
};

export const DASHBOARD_LIMITS = {
  views: 16,
  viewId: /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/,
  title: 60,
  kpis: 12,
  kpiLabel: 48,
  kpiValue: 48,
  kpiSub: 80,
  kpiDelta: 24,
  sparkPoints: 60,
  sections: 16,
  chartPoints: 120,
  tableColumns: 12,
  tableRows: 100,
  listItems: 50,
} as const;

const TONES = new Set<DashboardTone>(["good", "warn", "bad", "neutral"]);

export class DashboardInputError extends Error {}

const line = (value: unknown, max: number): string => {
  const s = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

function parseTone(value: unknown, strict = false): DashboardTone | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (TONES.has(value as DashboardTone)) return value as DashboardTone;
  if (strict) throw new DashboardInputError("tone must be good, warn, bad, or neutral");
  return undefined;
}

export function normalizeDashboardKpi(raw: unknown, strict = false): DashboardKpi | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const label = line(o.label, DASHBOARD_LIMITS.kpiLabel);
  const value =
    typeof o.value === "number" && Number.isFinite(o.value)
      ? String(o.value)
      : line(o.value, DASHBOARD_LIMITS.kpiValue);
  if (!label || !value) {
    if (strict) throw new DashboardInputError("every KPI needs a label and a value");
    return null;
  }
  const kpi: DashboardKpi = { label, value };
  const sub = line(o.sub, DASHBOARD_LIMITS.kpiSub);
  if (sub) kpi.sub = sub;
  const delta = line(o.delta, DASHBOARD_LIMITS.kpiDelta);
  if (delta) kpi.delta = delta;
  const deltaTone = parseTone(o.deltaTone, strict);
  if (deltaTone) kpi.deltaTone = deltaTone;
  const tone = parseTone(o.tone, strict);
  if (tone) kpi.tone = tone;
  if (Array.isArray(o.spark)) {
    const spark = o.spark
      .slice(-DASHBOARD_LIMITS.sparkPoints)
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n));
    if (spark.length >= 2) kpi.spark = spark;
  }
  return kpi;
}

export function normalizeDashboardChart(raw: unknown, strict = false): DashboardChart | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const title = line(o.title, DASHBOARD_LIMITS.title);
  if (!title) {
    if (strict) throw new DashboardInputError("chart title is required");
    return null;
  }
  const kind =
    o.kind === "line" ? "line" : o.kind === "breakdown" ? "breakdown" : o.kind === "bar" || o.kind === undefined ? "bar" : null;
  if (!kind) {
    if (strict) throw new DashboardInputError("chart kind must be bar, line, or breakdown");
    return null;
  }
  if (!Array.isArray(o.points)) {
    if (strict) throw new DashboardInputError("chart points must be an array");
    return null;
  }
  const points: DashboardChartPoint[] = [];
  for (const p of o.points.slice(-DASHBOARD_LIMITS.chartPoints)) {
    const po = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    if (typeof po.value !== "number" || !Number.isFinite(po.value)) {
      if (strict) throw new DashboardInputError("every chart point needs a finite numeric value");
      continue;
    }
    const pt: DashboardChartPoint = {
      label: line(po.label, 32),
      value: po.value,
    };
    const detail = line(po.detail, 80);
    if (detail) pt.detail = detail;
    const tone = parseTone(po.tone, strict);
    if (tone) pt.tone = tone;
    points.push(pt);
  }
  if (!points.length) {
    if (strict) throw new DashboardInputError("chart needs at least one point");
    return null;
  }
  const chart: DashboardChart = { title, kind, points };
  const value =
    typeof o.value === "number" && Number.isFinite(o.value)
      ? String(o.value)
      : line(o.value, DASHBOARD_LIMITS.kpiValue);
  if (value) chart.value = value;
  const sub = line(o.sub, DASHBOARD_LIMITS.kpiSub);
  if (sub) chart.sub = sub;
  const unit = line(o.unit, 16);
  if (unit) chart.unit = unit;
  return chart;
}

export function normalizeDashboardTable(raw: unknown, strict = false): DashboardTable | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const title = line(o.title, DASHBOARD_LIMITS.title);
  if (!title) {
    if (strict) throw new DashboardInputError("table title is required");
    return null;
  }
  if (!Array.isArray(o.columns) || !o.columns.length) {
    if (strict) throw new DashboardInputError("table columns are required");
    return null;
  }
  const columns: DashboardTableColumn[] = [];
  for (const c of o.columns.slice(0, DASHBOARD_LIMITS.tableColumns)) {
    const co = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
    const key = line(co.key, 32);
    const label = line(co.label ?? co.key, 40);
    if (!key || !label) continue;
    columns.push({
      key,
      label,
      ...(co.align === "right" ? { align: "right" } : {}),
    });
  }
  if (!columns.length) {
    if (strict) throw new DashboardInputError("table needs at least one valid column");
    return null;
  }
  const rows: DashboardTableRow[] = [];
  if (Array.isArray(o.rows)) {
    for (const r of o.rows.slice(0, DASHBOARD_LIMITS.tableRows)) {
      const ro = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
      const rawCells = (ro.cells && typeof ro.cells === "object" ? ro.cells : ro) as Record<string, unknown>;
      const cells: Record<string, string | number | null> = {};
      for (const col of columns) {
        const v = rawCells[col.key];
        cells[col.key] =
          typeof v === "number" && Number.isFinite(v)
            ? v
            : typeof v === "string"
              ? line(v, 120)
              : null;
      }
      const row: DashboardTableRow = { cells };
      const id = line(ro.id, 48);
      if (id) row.id = id;
      const tone = parseTone(ro.tone, strict);
      if (tone) row.tone = tone;
      rows.push(row);
    }
  }
  const table: DashboardTable = { title, columns, rows };
  const sub = line(o.sub, DASHBOARD_LIMITS.kpiSub);
  if (sub) table.sub = sub;
  return table;
}

export function normalizeDashboardList(raw: unknown, strict = false): DashboardList | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const title = line(o.title, DASHBOARD_LIMITS.title);
  if (!title) {
    if (strict) throw new DashboardInputError("list title is required");
    return null;
  }
  const items: DashboardListItem[] = [];
  if (Array.isArray(o.items)) {
    for (const item of o.items.slice(0, DASHBOARD_LIMITS.listItems)) {
      const io = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      const itemTitle = line(io.title, 120);
      if (!itemTitle) continue;
      const out: DashboardListItem = { title: itemTitle };
      const detail = line(io.detail, 160);
      if (detail) out.detail = detail;
      const value =
        typeof io.value === "number" && Number.isFinite(io.value)
          ? String(io.value)
          : line(io.value, 40);
      if (value) out.value = value;
      const when = line(io.when, 32);
      if (when) out.when = when;
      const badge = line(io.badge, 24);
      if (badge) out.badge = badge;
      const tone = parseTone(io.tone, strict);
      if (tone) out.tone = tone;
      items.push(out);
    }
  }
  const list: DashboardList = { title, items };
  if (typeof o.count === "number" && Number.isFinite(o.count)) list.count = o.count;
  else if (typeof o.count === "string" && o.count.trim()) list.count = line(o.count, 16);
  const emptyText = line(o.emptyText, 80);
  if (emptyText) list.emptyText = emptyText;
  return list;
}

export function normalizeDashboardSection(raw: unknown, strict = false): DashboardSection | null {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = o.kind;
  if (kind === "kpis") {
    const rawItems = Array.isArray(o.items) ? o.items : Array.isArray(o.kpis) ? o.kpis : [];
    const items = rawItems
      .slice(0, DASHBOARD_LIMITS.kpis)
      .map((item) => normalizeDashboardKpi(item, strict))
      .filter((item): item is DashboardKpi => !!item);
    if (!items.length) {
      if (strict) throw new DashboardInputError("kpis section needs at least one KPI");
      return null;
    }
    const title = line(o.title, DASHBOARD_LIMITS.title);
    return title ? { kind: "kpis", title, items } : { kind: "kpis", items };
  }
  if (kind === "chart") {
    const chart = normalizeDashboardChart(o.chart ?? o, strict);
    return chart ? { kind: "chart", chart } : null;
  }
  if (kind === "charts") {
    const rawCharts = Array.isArray(o.charts) ? o.charts : [];
    const charts = rawCharts
      .slice(0, 6)
      .map((c) => normalizeDashboardChart(c, strict))
      .filter((c): c is DashboardChart => !!c);
    if (!charts.length) {
      if (strict) throw new DashboardInputError("charts section needs at least one chart");
      return null;
    }
    const title = line(o.title, DASHBOARD_LIMITS.title);
    return title ? { kind: "charts", title, charts } : { kind: "charts", charts };
  }
  if (kind === "table") {
    const table = normalizeDashboardTable(o.table ?? o, strict);
    return table ? { kind: "table", table } : null;
  }
  if (kind === "list") {
    const list = normalizeDashboardList(o.list ?? o, strict);
    return list ? { kind: "list", list } : null;
  }
  if (strict) throw new DashboardInputError("section kind must be kpis, chart, charts, table, or list");
  return null;
}

function pathInside(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function validateDashboardScript(scriptPath: string, scopeRoot: string): { scriptPath: string; scopeRoot: string } {
  if (!isAbsolute(scriptPath)) throw new DashboardInputError("refreshScriptPath must be an absolute path");
  let realScope: string;
  let realScript: string;
  try {
    realScope = realpathSync(resolve(scopeRoot));
    realScript = realpathSync(resolve(scriptPath));
  } catch {
    throw new DashboardInputError("refreshScriptPath does not exist");
  }
  if (!pathInside(realScript, realScope)) {
    throw new DashboardInputError("refreshScriptPath must be inside the session workspace");
  }
  const st = statSync(realScript);
  if (!st.isFile()) throw new DashboardInputError("refreshScriptPath is not a regular file");
  if ((st.mode & 0o111) === 0) throw new DashboardInputError("refreshScriptPath must be executable (chmod +x)");
  return { scriptPath: realScript, scopeRoot: realScope };
}

export function normalizeDashboardView(raw: unknown, strict = false): DashboardView | null {
  if (!raw || typeof raw !== "object") {
    if (strict) throw new DashboardInputError("view must be an object");
    return null;
  }
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim().toLowerCase() : "";
  if (!DASHBOARD_LIMITS.viewId.test(id)) {
    if (strict) throw new DashboardInputError("view id must be 3-64 lowercase letters, digits, or dashes");
    return null;
  }
  const title = line(o.title ?? id, DASHBOARD_LIMITS.title);
  if (!title) {
    if (strict) throw new DashboardInputError("view title is required");
    return null;
  }
  const view: DashboardView = {
    id,
    title,
    updatedAt: typeof o.updatedAt === "number" && Number.isFinite(o.updatedAt) ? o.updatedAt : Date.now(),
  };
  if (typeof o.order === "number" && Number.isFinite(o.order)) view.order = o.order;
  if (o.builtin === true) view.builtin = true;

  if (Array.isArray(o.kpis)) {
    if (strict && o.kpis.length > DASHBOARD_LIMITS.kpis) {
      throw new DashboardInputError(`at most ${DASHBOARD_LIMITS.kpis} KPIs per view`);
    }
    const kpis = o.kpis
      .slice(0, DASHBOARD_LIMITS.kpis)
      .map((item) => normalizeDashboardKpi(item, strict))
      .filter((item): item is DashboardKpi => !!item);
    if (kpis.length) view.kpis = kpis;
  }

  if (Array.isArray(o.sections)) {
    if (strict && o.sections.length > DASHBOARD_LIMITS.sections) {
      throw new DashboardInputError(`at most ${DASHBOARD_LIMITS.sections} sections per view`);
    }
    const sections = o.sections
      .slice(0, DASHBOARD_LIMITS.sections)
      .map((s) => normalizeDashboardSection(s, strict))
      .filter((s): s is DashboardSection => !!s);
    if (sections.length) view.sections = sections;
  }

  if (!strict && o.source && typeof o.source === "object") {
    const so = o.source as Record<string, unknown>;
    if (typeof so.scriptPath === "string" && typeof so.scopeRoot === "string") {
      view.source = {
        scriptPath: so.scriptPath,
        scopeRoot: so.scopeRoot,
        argv: Array.isArray(so.argv) ? so.argv.filter((a): a is string => typeof a === "string").slice(0, 32) : [],
        intervalSeconds: typeof so.intervalSeconds === "number" ? so.intervalSeconds : 300,
        timeoutSeconds: typeof so.timeoutSeconds === "number" ? so.timeoutSeconds : 30,
        ...(typeof so.workspace === "string" ? { workspace: so.workspace } : {}),
        enabled: so.enabled !== false,
        status: so.status === "ok" || so.status === "error" || so.status === "running" ? so.status : "idle",
        ...(typeof so.lastRefreshedAt === "number" ? { lastRefreshedAt: so.lastRefreshedAt } : {}),
        ...(typeof so.lastError === "string" ? { lastError: so.lastError } : {}),
      };
    }
  }
  return view;
}

const dashboardDir = () => join(PATHS.data, "dashboard");
const dashboardFile = () => join(dashboardDir(), "dashboard.json");
const dashboardScriptsDir = () => join(dashboardDir(), "scripts");

/** Largest refresh script the dashboard keeps a copy of. */
const MAX_SCRIPT_BYTES = 256 * 1024;

/**
 * Keep the dashboard's own copy of a validated refresh script. The copy is
 * private to the server (0700) and fixed at registration, so a later edit in
 * the session folder cannot change what the server runs without a new
 * registration.
 */
function adoptDashboardScript(viewId: string, validatedScript: string): { scriptPath: string; scopeRoot: string } {
  const size = statSync(validatedScript).size;
  if (size > MAX_SCRIPT_BYTES) {
    throw new DashboardInputError(`refresh script must be at most ${MAX_SCRIPT_BYTES / 1024} KB`);
  }
  const dir = dashboardScriptsDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const ext = extname(validatedScript).replace(/[^.a-zA-Z0-9]/g, "").slice(0, 8);
  const dest = join(dir, `${viewId}${ext}`);
  const tmp = `${dest}.${process.pid}.tmp`;
  copyFileSync(validatedScript, tmp);
  chmodSync(tmp, 0o700);
  renameSync(tmp, dest);
  return { scriptPath: realpathSync(dest), scopeRoot: realpathSync(dir) };
}

function removeAdoptedScript(source: DashboardSourceConfig | undefined): void {
  if (!source) return;
  try {
    if (pathInside(realpathSync(source.scriptPath), realpathSync(dashboardScriptsDir()))) {
      rmSync(source.scriptPath, { force: true });
    }
  } catch {
    // Already gone, or never adopted (a view saved before copies existed).
  }
}

type CachedStore = { mtimeMs: number; size: number; data: DashboardStoreData };
let storeCache: CachedStore | null = null;

export function readDashboardStore(): DashboardStoreData {
  const path = dashboardFile();
  let st;
  try {
    st = statSync(path);
  } catch {
    storeCache = null;
    return { version: 1, updatedAt: 0, views: {} };
  }
  if (storeCache && storeCache.mtimeMs === st.mtimeMs && storeCache.size === st.size) {
    return storeCache.data;
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const views: Record<string, DashboardView> = {};
    const rawViews = raw.views && typeof raw.views === "object" ? (raw.views as Record<string, unknown>) : {};
    for (const [key, val] of Object.entries(rawViews)) {
      const normalized = normalizeDashboardView(val, false);
      if (normalized) views[normalized.id] = normalized;
      else if (typeof key === "string") {
        const withId = normalizeDashboardView({ ...(val as object), id: key }, false);
        if (withId) views[withId.id] = withId;
      }
    }
    const hiddenBuiltins = Array.isArray(raw.hiddenBuiltins)
      ? raw.hiddenBuiltins.filter((id): id is string => typeof id === "string")
      : undefined;
    const data: DashboardStoreData = {
      version: 1,
      updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : st.mtimeMs,
      editorSessionId: typeof raw.editorSessionId === "string" ? raw.editorSessionId : null,
      ...(hiddenBuiltins?.length ? { hiddenBuiltins } : {}),
      views,
    };
    storeCache = { mtimeMs: st.mtimeMs, size: st.size, data };
    return data;
  } catch {
    return { version: 1, updatedAt: 0, views: {} };
  }
}

function writeDashboardStore(data: DashboardStoreData): void {
  const dir = dashboardDir();
  // Views can hold private figures (revenue, users), so only the owner reads them.
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = dashboardFile();
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  storeCache = null;
}

export function setDashboardEditorSession(sessionId: string | null): void {
  const store = readDashboardStore();
  store.editorSessionId = sessionId;
  store.updatedAt = Date.now();
  writeDashboardStore(store);
}

export function upsertDashboardView(
  raw: unknown,
  options: {
    scopeRoot?: string;
    refreshScriptPath?: string | null;
    refreshArgv?: string[];
    refreshIntervalSeconds?: number;
    refreshTimeoutSeconds?: number;
    refreshEnabled?: boolean;
  } = {},
): DashboardView {
  const store = readDashboardStore();
  const normalized = normalizeDashboardView({ ...(raw as object), updatedAt: Date.now() }, true)!;
  const existing = store.views[normalized.id];
  if (!existing && Object.keys(store.views).length >= DASHBOARD_LIMITS.views) {
    throw new DashboardInputError(`at most ${DASHBOARD_LIMITS.views} dashboard views allowed`);
  }

  // Preserve existing KPIs/sections when only updating source or title and none were supplied.
  if (!normalized.kpis && existing?.kpis && !(raw as Record<string, unknown>).kpis) {
    normalized.kpis = existing.kpis;
  }
  if (!normalized.sections && existing?.sections && !(raw as Record<string, unknown>).sections) {
    normalized.sections = existing.sections;
  }
  if (normalized.order === undefined && existing?.order !== undefined) {
    normalized.order = existing.order;
  }

  if (options.refreshScriptPath === null) {
    removeAdoptedScript(existing?.source);
    delete normalized.source;
  } else if (options.refreshScriptPath !== undefined) {
    if (!options.scopeRoot) {
      throw new DashboardInputError("refreshScriptPath requires an active session workspace");
    }
    const checked = validateDashboardScript(options.refreshScriptPath, options.scopeRoot);
    const validated = adoptDashboardScript(normalized.id, checked.scriptPath);
    const argv = (options.refreshArgv ?? existing?.source?.argv ?? []).slice(0, 32).map(String);
    const intervalSeconds = Math.max(10, Math.min(604_800, Math.round(options.refreshIntervalSeconds ?? existing?.source?.intervalSeconds ?? 300)));
    const timeoutSeconds = Math.max(1, Math.min(300, Math.round(options.refreshTimeoutSeconds ?? existing?.source?.timeoutSeconds ?? 30)));
    normalized.source = {
      scriptPath: validated.scriptPath,
      scopeRoot: validated.scopeRoot,
      workspace: checked.scopeRoot,
      argv,
      intervalSeconds,
      timeoutSeconds,
      enabled: options.refreshEnabled ?? existing?.source?.enabled ?? true,
      status: "idle",
      lastRefreshedAt: existing?.source?.lastRefreshedAt,
    };
  } else if (existing?.source) {
    normalized.source = {
      ...existing.source,
      ...(options.refreshArgv ? { argv: options.refreshArgv.slice(0, 32).map(String) } : {}),
      ...(options.refreshIntervalSeconds !== undefined
        ? { intervalSeconds: Math.max(10, Math.min(604_800, Math.round(options.refreshIntervalSeconds))) }
        : {}),
      ...(options.refreshTimeoutSeconds !== undefined
        ? { timeoutSeconds: Math.max(1, Math.min(300, Math.round(options.refreshTimeoutSeconds))) }
        : {}),
      ...(options.refreshEnabled !== undefined ? { enabled: options.refreshEnabled } : {}),
    };
  }

  store.views[normalized.id] = normalized;
  if (store.hiddenBuiltins?.includes(normalized.id)) {
    store.hiddenBuiltins = store.hiddenBuiltins.filter((id) => id !== normalized.id);
  }
  store.updatedAt = normalized.updatedAt;
  writeDashboardStore(store);
  return normalized;
}

export function deleteDashboardView(id: string): boolean {
  const cleanId = id.trim().toLowerCase();
  const store = readDashboardStore();
  const hadCustom = Boolean(store.views[cleanId]);
  removeAdoptedScript(store.views[cleanId]?.source);
  delete store.views[cleanId];
  const isBuiltin = cleanId === "today" || cleanId === "system";
  if (isBuiltin && !hadCustom) {
    const hidden = new Set(store.hiddenBuiltins ?? []);
    hidden.add(cleanId);
    store.hiddenBuiltins = [...hidden];
    store.updatedAt = Date.now();
    writeDashboardStore(store);
    return true;
  }
  if (hadCustom) {
    store.updatedAt = Date.now();
    writeDashboardStore(store);
    return true;
  }
  return false;
}

export function resetDashboardBuiltinViews(): void {
  const store = readDashboardStore();
  delete store.views.today;
  delete store.views.system;
  delete store.hiddenBuiltins;
  store.updatedAt = Date.now();
  writeDashboardStore(store);
}

export async function refreshDashboardView(id: string): Promise<DashboardView> {
  const cleanId = id.trim().toLowerCase();
  const store = readDashboardStore();
  const view = store.views[cleanId];
  if (!view) throw new DashboardInputError(`dashboard view "${cleanId}" is not a custom or script-backed view`);
  if (!view.source) return view;

  const source = view.source;
  const validated = validateDashboardScript(source.scriptPath, source.scopeRoot);
  const output = await new Promise<string>((resolveOut, rejectOut) => {
    execFile(
      validated.scriptPath,
      source.argv,
      {
        cwd: source.workspace && existsSync(source.workspace) ? source.workspace : validated.scopeRoot,
        timeout: (source.timeoutSeconds || 30) * 1000,
        maxBuffer: 2 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr?.trim() || error.message || "script failed";
          rejectOut(new Error(detail.slice(0, 300)));
          return;
        }
        resolveOut(stdout);
      },
    );
  }).catch((err: unknown) => {
    const freshStore = readDashboardStore();
    const target = freshStore.views[cleanId];
    if (target?.source) {
      target.source.status = "error";
      target.source.lastError = err instanceof Error ? err.message : String(err);
      freshStore.updatedAt = Date.now();
      writeDashboardStore(freshStore);
    }
    throw new DashboardInputError(err instanceof Error ? err.message : "refresh script failed");
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new DashboardInputError("refresh script must print valid JSON");
  }
  const merged = normalizeDashboardView(
    {
      ...view,
      ...(parsed && typeof parsed === "object" ? (parsed as object) : {}),
      id: view.id,
      title: (parsed as { title?: string })?.title || view.title,
      updatedAt: Date.now(),
    },
    true,
  )!;
  merged.source = {
    ...source,
    status: "ok",
    lastRefreshedAt: Date.now(),
    lastError: undefined,
  };
  const freshStore = readDashboardStore();
  freshStore.views[cleanId] = merged;
  freshStore.updatedAt = merged.updatedAt;
  writeDashboardStore(freshStore);
  return merged;
}

const refreshing = new Set<string>();
const lastAttempt = new Map<string, number>();

/**
 * Start a background refresh for every script-backed view older than its
 * interval. Called on each dashboard read, so an open dashboard keeps its
 * views current without a timer of its own. One run per view at a time.
 */
export function refreshStaleDashboardViews(now = Date.now()): string[] {
  const started: string[] = [];
  for (const view of Object.values(readDashboardStore().views)) {
    const source = view.source;
    if (!source?.enabled || refreshing.has(view.id)) continue;
    const intervalMs = Math.max(10, source.intervalSeconds || 300) * 1000;
    if (source.lastRefreshedAt && now - source.lastRefreshedAt < intervalMs) continue;
    // A failing script waits its interval too, rather than running on every poll.
    if (now - (lastAttempt.get(view.id) ?? 0) < intervalMs) continue;
    refreshing.add(view.id);
    lastAttempt.set(view.id, now);
    started.push(view.id);
    void refreshDashboardView(view.id)
      .catch(() => {})
      .finally(() => refreshing.delete(view.id));
  }
  return started;
}

export type LiveRuntimeDashboardInput = {
  sessions: ReadonlyArray<{
    sessionId?: string;
    project?: string | null;
    agent?: string | null;
    busy?: boolean;
    lastActivityAt?: number | null;
  }>;
  findings: ReadonlyArray<{
    id: string;
    agentId: string;
    title: string;
    severity?: "low" | "med" | "medium" | "high" | string;
    lastSeenAt?: number;
    createdAt?: number;
  }>;
  autoAgents: ReadonlyArray<{
    id: string;
    name: string;
    schedule: string;
    enabled: boolean;
    running?: boolean;
    lastRunAt?: number | null;
  }>;
  shippedPosts: ReadonlyArray<{
    id: string;
    title: string;
    project?: string;
    agent?: string;
    ts: number;
  }>;
  reposCount: number;
  diskFreeBytes?: number | null;
  diskTotalBytes?: number | null;
  now?: number;
};

const DAY_MS = 86_400_000;

function formatShortDay(ts: number): string {
  return new Date(ts).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function formatAgo(ts: number | null | undefined, now: number): string {
  if (!ts) return "—";
  const s = Math.max(0, Math.floor((now - ts) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function formatGb(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  const gb = bytes / (1024 * 1024 * 1024);
  return gb >= 100 ? `${Math.round(gb)} GB` : `${gb.toFixed(1)} GB`;
}

function formatUptime(sec: number): string {
  const m = Math.max(1, Math.floor(sec / 60));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/**
 * Compute the built-in "Today" and "System" views from live local machine
 * state. Follows omg-admin's strict rule: labels and numbers only.
 */
export function buildLiveRuntimeViews(input: LiveRuntimeDashboardInput): DashboardView[] {
  const now = input.now ?? Date.now();
  const workingCount = input.sessions.filter((s) => s.busy).length;
  const idleCount = Math.max(0, input.sessions.length - workingCount);

  const highFindings = input.findings.filter((f) => f.severity === "high").length;
  const medFindings = input.findings.filter((f) => f.severity === "medium" || f.severity === "med").length;
  const lowFindings = Math.max(0, input.findings.length - highFindings - medFindings);

  // 14-day buckets (UTC days)
  const todayStart = Math.floor(now / DAY_MS) * DAY_MS;
  const dayStarts: number[] = [];
  for (let i = 13; i >= 0; i--) {
    dayStarts.push(todayStart - i * DAY_MS);
  }
  const shippedByDay = dayStarts.map((start) => {
    const end = start + DAY_MS;
    const count = input.shippedPosts.filter((p) => p.ts >= start && p.ts < end).length;
    return { label: formatShortDay(start), value: count, detail: `${count} shipped · ${formatShortDay(start)}` };
  });
  const sessionsByDay = dayStarts.map((start) => {
    const end = start + DAY_MS;
    const count = input.sessions.filter((s) => (s.lastActivityAt ?? 0) >= start && (s.lastActivityAt ?? 0) < end).length;
    return { label: formatShortDay(start), value: count, detail: `${count} active · ${formatShortDay(start)}` };
  });

  const shipped14d = shippedByDay.reduce((sum, d) => sum + d.value, 0);
  const prev14dStart = todayStart - 27 * DAY_MS;
  const first14dStart = todayStart - 13 * DAY_MS;
  const shippedPrev14d = input.shippedPosts.filter((p) => p.ts >= prev14dStart && p.ts < first14dStart).length;
  const shippedDelta =
    shippedPrev14d > 0
      ? `${shipped14d >= shippedPrev14d ? "+" : ""}${Math.round(((shipped14d - shippedPrev14d) / shippedPrev14d) * 100)}%`
      : undefined;

  const enabledSchedules = input.autoAgents.filter((a) => a.enabled).length;
  const runningSchedules = input.autoAgents.filter((a) => a.running).length;

  const { availableBytes: memFree, totalBytes: memTotal } = hostMemory();
  const memUsedPct = memTotal > 0 ? Math.round(((memTotal - memFree) / memTotal) * 100) : 0;

  const diskFree = input.diskFreeBytes ?? null;
  const diskTotal = input.diskTotalBytes ?? null;
  const diskUsedPct =
    diskFree != null && diskTotal != null && diskTotal > 0
      ? Math.round(((diskTotal - diskFree) / diskTotal) * 100)
      : null;

  const agentNameById = new Map(input.autoAgents.map((a) => [a.id, a.name]));
  const severityWeight = (s?: string) => (s === "high" ? 3 : s === "medium" || s === "med" ? 2 : 1);
  const sortedFindings = [...input.findings].sort(
    (a, b) =>
      severityWeight(b.severity) - severityWeight(a.severity) ||
      (b.lastSeenAt ?? b.createdAt ?? 0) - (a.lastSeenAt ?? a.createdAt ?? 0),
  );

  // Project activity table
  const projectMap = new Map<
    string,
    { active: number; working: number; shipped: number }
  >();
  for (const s of input.sessions) {
    const proj = s.project?.trim() || "No project";
    const row = projectMap.get(proj) ?? { active: 0, working: 0, shipped: 0 };
    row.active += 1;
    if (s.busy) row.working += 1;
    projectMap.set(proj, row);
  }
  for (const p of input.shippedPosts) {
    if (p.ts < first14dStart) continue;
    const proj = p.project?.trim() || "No project";
    const row = projectMap.get(proj) ?? { active: 0, working: 0, shipped: 0 };
    row.shipped += 1;
    projectMap.set(proj, row);
  }
  const projectRows: DashboardTableRow[] = [...projectMap.entries()]
    .sort((a, b) => b[1].working - a[1].working || b[1].active - a[1].active || b[1].shipped - a[1].shipped)
    .slice(0, 10)
    .map(([proj, stats]) => ({
      id: proj,
      tone: stats.working > 0 ? "good" : "neutral",
      cells: {
        project: proj,
        active: stats.active,
        working: stats.working,
        shipped: stats.shipped,
      },
    }));

  const todayView: DashboardView = {
    id: "today",
    title: "Today",
    order: 0,
    updatedAt: now,
    builtin: true,
    kpis: [
      {
        label: "Sessions",
        value: String(input.sessions.length),
        sub: `${workingCount} working · ${idleCount} idle`,
        tone: workingCount > 0 ? "good" : "neutral",
        spark: sessionsByDay.map((d) => d.value),
      },
      {
        label: "Findings",
        value: String(input.findings.length),
        sub: input.findings.length
          ? `${highFindings} high · ${medFindings} med · ${lowFindings} low`
          : "All clear",
        tone: highFindings > 0 ? "bad" : input.findings.length > 0 ? "warn" : "good",
      },
      {
        label: "Shipped 14d",
        value: String(shipped14d),
        sub: `${shippedByDay.at(-1)?.value ?? 0} today`,
        ...(shippedDelta
          ? {
              delta: shippedDelta,
              deltaTone: shipped14d >= shippedPrev14d ? "good" : "warn",
            }
          : {}),
        spark: shippedByDay.map((d) => d.value),
      },
      {
        label: "Schedules",
        value: `${enabledSchedules}/${input.autoAgents.length}`,
        sub: runningSchedules > 0 ? `${runningSchedules} running now` : `${enabledSchedules} enabled`,
      },
      {
        label: "Disk free",
        value: formatGb(diskFree),
        sub: diskUsedPct != null ? `${diskUsedPct}% used` : "Local storage",
        tone: diskUsedPct != null && diskUsedPct > 90 ? "bad" : diskUsedPct != null && diskUsedPct > 80 ? "warn" : "neutral",
      },
      {
        label: "Memory free",
        value: formatGb(memFree),
        sub: `${memUsedPct}% used of ${formatGb(memTotal)}`,
        tone: memUsedPct > 90 ? "bad" : memUsedPct > 80 ? "warn" : "neutral",
      },
    ],
    sections: [
      {
        kind: "list",
        list: {
          title: "Needs you",
          count: sortedFindings.length,
          emptyText: "Nothing needs you",
          items: sortedFindings.slice(0, 8).map((f) => ({
            title: f.title,
            detail: agentNameById.get(f.agentId) ?? f.agentId,
            when: formatAgo(f.lastSeenAt ?? f.createdAt, now),
            badge: f.severity ?? "open",
            tone: f.severity === "high" ? "bad" : f.severity === "medium" || f.severity === "med" ? "warn" : "neutral",
          })),
        },
      },
      {
        kind: "charts",
        charts: [
          {
            title: "Shipped / day",
            value: String(shipped14d),
            kind: "bar",
            points: shippedByDay,
          },
          {
            title: "Active sessions / day",
            value: String(input.sessions.length),
            kind: "bar",
            points: sessionsByDay,
          },
        ],
      },
      {
        kind: "table",
        table: {
          title: "Folders",
          columns: [
            { key: "project", label: "Folder" },
            { key: "working", label: "Working", align: "right" },
            { key: "active", label: "Sessions", align: "right" },
            { key: "shipped", label: "Shipped 14d", align: "right" },
          ],
          rows: projectRows,
        },
      },
    ],
  };

  // System view: agent harness breakdown + schedule table
  const agentCounts = new Map<string, number>();
  for (const s of input.sessions) {
    const key = s.agent?.trim() || "claude";
    agentCounts.set(key, (agentCounts.get(key) ?? 0) + 1);
  }
  const agentPoints: DashboardChartPoint[] = [...agentCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value }));

  const findingsByAgent = new Map<string, number>();
  for (const f of input.findings) {
    findingsByAgent.set(f.agentId, (findingsByAgent.get(f.agentId) ?? 0) + 1);
  }

  const scheduleRows: DashboardTableRow[] = [...input.autoAgents]
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name))
    .slice(0, 20)
    .map((a) => {
      const openCount = findingsByAgent.get(a.id) ?? 0;
      return {
        id: a.id,
        tone: a.running ? "good" : openCount > 0 ? "warn" : "neutral",
        cells: {
          name: a.name,
          schedule: a.schedule,
          lastRun: formatAgo(a.lastRunAt, now),
          findings: openCount,
          state: a.running ? "Running" : a.enabled ? "On" : "Off",
        },
      };
    });

  const systemView: DashboardView = {
    id: "system",
    title: "System",
    order: 1,
    updatedAt: now,
    builtin: true,
    kpis: [
      { label: "Uptime", value: formatUptime(uptime()), sub: "Local runtime" },
      { label: "Folders", value: String(input.reposCount), sub: `${projectMap.size} with chats` },
      { label: "Working", value: String(workingCount), sub: `${input.sessions.length} total sessions` },
      { label: "Schedules", value: String(enabledSchedules), sub: `${input.autoAgents.length} configured` },
    ],
    sections: [
      ...(agentPoints.length
        ? [
            {
              kind: "chart" as const,
              chart: {
                title: "Sessions by agent",
                value: String(input.sessions.length),
                kind: "breakdown" as const,
                points: agentPoints,
              },
            },
          ]
        : []),
      {
        kind: "table",
        table: {
          title: "Schedules",
          columns: [
            { key: "name", label: "Name" },
            { key: "lastRun", label: "Last run", align: "right" },
            { key: "findings", label: "Open", align: "right" },
            { key: "state", label: "State", align: "right" },
          ],
          rows: scheduleRows,
        },
      },
    ],
  };

  return [todayView, systemView];
}

export function resolveDashboardResponse(input: LiveRuntimeDashboardInput): {
  updatedAt: number;
  editorSessionId: string | null;
  views: DashboardView[];
} {
  const store = readDashboardStore();
  const builtins = buildLiveRuntimeViews(input);
  const hidden = new Set(store.hiddenBuiltins ?? []);
  const byId = new Map<string, DashboardView>();

  for (const b of builtins) {
    if (!hidden.has(b.id)) byId.set(b.id, b);
  }
  for (const [id, custom] of Object.entries(store.views)) {
    byId.set(id, custom);
  }

  const views = [...byId.values()].sort(
    (a, b) => (a.order ?? 100) - (b.order ?? 100) || a.title.localeCompare(b.title),
  );
  return {
    updatedAt: Math.max(store.updatedAt, input.now ?? Date.now()),
    editorSessionId: store.editorSessionId ?? null,
    views,
  };
}
