// The local generative dashboard (/dashboard).
//
// Modelled on omg-admin: labels and numbers only. No subtitles, explanations,
// or prose filler. Views are stored locally in `<data>/dashboard/dashboard.json`
// and edited with an agent through the `omg_dashboard` MCP tool or `/api/dashboard`.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/omg-client";
import { toast } from "@/lib/notify";
import { cn } from "@/lib/utils";

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

export type DashboardView = {
  id: string;
  title: string;
  order?: number;
  updatedAt: number;
  builtin?: boolean;
  kpis?: DashboardKpi[];
  sections?: DashboardSection[];
};

export type DashboardPayload = {
  updatedAt: number;
  editorSessionId: string | null;
  views: DashboardView[];
};

const TONE_TEXT: Record<DashboardTone, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-red-600 dark:text-red-400",
  neutral: "text-foreground",
};

const DELTA_BADGE: Record<DashboardTone, string> = {
  good: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  warn: "bg-amber-500/12 text-amber-600 dark:text-amber-400",
  bad: "bg-red-500/12 text-red-600 dark:text-red-400",
  neutral: "bg-muted text-muted-foreground",
};

const TONE_DOT: Record<DashboardTone, string> = {
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-red-500",
  neutral: "bg-muted-foreground/40",
};

const compactFmt = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const exactFmt = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
});

function formatChartNumber(n: number, unit?: string): string {
  const num = Math.abs(n) >= 10_000 ? compactFmt.format(n) : exactFmt.format(n);
  if (!unit) return num;
  if (unit === "$" || unit === "usd") return `$${num}`;
  if (unit === "%") return `${num}%`;
  return `${num} ${unit}`;
}

function niceMax(max: number): number {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  const m = max / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

/** Rounded-top bar path anchored to baseline, matching omg-admin's ui.js. */
function roundedBarPath(x: number, y: number, w: number, h: number, r = 3.5): string {
  if (h <= 0) return "";
  const rad = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rad}Q${x},${y} ${x + rad},${y}H${x + w - rad}Q${x + w},${y} ${x + w},${y + rad}V${y + h}Z`;
}

function Sparkline({ values }: { values: readonly number[] }) {
  if (values.length < 2) return null;
  const W = 120;
  const H = 22;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => H - ((v - lo) / span) * (H - 4) - 2;
  const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      className="mt-1.5 block h-5 w-full overflow-visible"
    >
      <polygon points={`0,${H} ${pts} ${W},${H}`} className="fill-primary/10" />
      <polyline
        points={pts}
        fill="none"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        className="stroke-primary/80"
      />
    </svg>
  );
}

export function DashboardKpiGrid({ items }: { items: readonly DashboardKpi[] }) {
  if (!items.length) return null;
  return (
    <div
      data-testid="dashboard-kpis"
      className={cn(
        "grid grid-cols-2 gap-2",
        items.length >= 6 ? "sm:grid-cols-3 lg:grid-cols-6" : "sm:grid-cols-4",
      )}
    >
      {items.map((kpi, idx) => (
        <div
          key={`${kpi.label}-${idx}`}
          data-testid="dashboard-kpi"
          className="flex min-w-0 flex-col justify-between rounded-xl border border-border/70 bg-card/50 px-3 py-2.5"
        >
          <div>
            <div className="flex items-center justify-between gap-1.5">
              <span className="truncate text-[11px] font-medium text-muted-foreground">
                {kpi.label}
              </span>
              {kpi.delta ? (
                <span
                  className={cn(
                    "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                    DELTA_BADGE[kpi.deltaTone ?? "neutral"],
                  )}
                >
                  {kpi.delta}
                </span>
              ) : null}
            </div>
            <div
              className={cn(
                "mt-0.5 truncate text-[20px] font-bold leading-tight tracking-[-0.02em] tabular-nums",
                TONE_TEXT[kpi.tone ?? "neutral"],
              )}
            >
              {kpi.value}
            </div>
            {kpi.sub ? (
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground tabular-nums">
                {kpi.sub}
              </div>
            ) : null}
          </div>
          {kpi.spark && kpi.spark.length >= 2 ? <Sparkline values={kpi.spark} /> : null}
        </div>
      ))}
    </div>
  );
}

export function DashboardChartBody({ chart }: { chart: DashboardChart }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const points = chart.points;
  if (!points.length) return null;

  if (chart.kind === "breakdown") {
    const maxVal = Math.max(...points.map((p) => p.value), 1);
    return (
      <div data-testid="dashboard-chart" data-kind="breakdown" className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="truncate text-xs font-semibold text-muted-foreground">{chart.title}</h3>
          {chart.value ? (
            <span className="shrink-0 text-sm font-bold tabular-nums">{chart.value}</span>
          ) : null}
        </div>
        <ul className="space-y-1.5">
          {points.map((p, i) => (
            <li
              key={`${p.label}-${i}`}
              className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-2.5 text-xs"
            >
              <span className="truncate font-medium text-foreground/85">{p.label}</span>
              <span className="h-2 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary/80"
                  style={{ width: `${Math.max(2, Math.min(100, (p.value / maxVal) * 100))}%` }}
                />
              </span>
              <span className="font-semibold tabular-nums text-foreground">
                {formatChartNumber(p.value, chart.unit)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const W = 400;
  const H = 124;
  const pad = { l: 34, r: 6, t: 8, b: 20 };
  const ih = H - pad.t - pad.b;
  const iw = W - pad.l - pad.r;
  const values = points.map((p) => p.value);
  const lo = chart.kind === "bar" ? Math.min(0, ...values) : Math.min(...values);
  const top = chart.kind === "bar" ? niceMax(Math.max(...values, 0)) : Math.max(lo + 1, niceMax(Math.max(...values)));
  const span = top - lo || 1;
  const y = (v: number) => pad.t + ih - ((v - lo) / span) * ih;
  const ticks = [lo, lo + span / 2, top];
  const every = Math.max(1, Math.ceil(points.length / 5));
  const selected = selectedIndex != null ? points[selectedIndex] : null;
  const headlineValue = selected
    ? `${selected.label}: ${formatChartNumber(selected.value, chart.unit)}`
    : chart.value ?? formatChartNumber(points.at(-1)?.value ?? 0, chart.unit);

  return (
    <div data-testid="dashboard-chart" data-kind={chart.kind}>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <h3 className="truncate text-xs font-semibold text-muted-foreground">{chart.title}</h3>
        <span className="shrink-0 text-xs font-bold tabular-nums text-foreground">
          {headlineValue}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={chart.title}
        className="block h-28 w-full select-none overflow-visible"
        onMouseLeave={() => setSelectedIndex(null)}
      >
        <g className="text-[9px] fill-muted-foreground">
          {ticks.map((t, idx) => (
            <g key={idx}>
              <line
                x1={pad.l}
                x2={W - pad.r}
                y1={y(t)}
                y2={y(t)}
                className="stroke-border/70"
                strokeWidth={1}
              />
              <text x={pad.l - 5} y={y(t) + 3} textAnchor="end" className="tabular-nums">
                {formatChartNumber(t, chart.unit)}
              </text>
            </g>
          ))}
          {points.map((p, i) => {
            const isLast = i === points.length - 1;
            const onStride = i % every === 0 && points.length - 1 - i >= 2;
            if (!isLast && !onStride) return null;
            const step = iw / Math.max(1, points.length);
            const cx = chart.kind === "bar" ? pad.l + i * step + step / 2 : pad.l + (i / Math.max(1, points.length - 1)) * iw;
            return (
              <text key={i} x={cx} y={H - 4} textAnchor="middle" className="tabular-nums">
                {p.label}
              </text>
            );
          })}
        </g>

        {chart.kind === "bar" ? (
          points.map((p, i) => {
            const step = iw / Math.max(1, points.length);
            const bw = Math.max(3, Math.min(18, step - 3));
            const x = pad.l + i * step + (step - bw) / 2;
            const h = Math.max(0, y(0) - y(p.value));
            const active = selectedIndex === i;
            return (
              <g
                key={i}
                onMouseEnter={() => setSelectedIndex(i)}
                onClick={() => setSelectedIndex(active ? null : i)}
                className="cursor-pointer"
              >
                <rect x={pad.l + i * step} y={pad.t} width={step} height={ih} fill="transparent" />
                {h > 0 ? (
                  <path
                    d={roundedBarPath(x, y(p.value), bw, h)}
                    className={cn(
                      "transition-opacity",
                      active ? "fill-primary" : p.value === 0 ? "fill-muted-foreground/25" : "fill-primary/80",
                    )}
                  />
                ) : (
                  <rect
                    x={x}
                    y={y(0) - 1}
                    width={bw}
                    height={1}
                    className="fill-muted-foreground/30"
                  />
                )}
              </g>
            );
          })
        ) : (
          (() => {
            const x = (i: number) =>
              points.length === 1 ? pad.l + iw / 2 : pad.l + (i / (points.length - 1)) * iw;
            const linePts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
            const lastIdx = points.length - 1;
            const last = points[lastIdx]!;
            return (
              <>
                <polygon
                  points={`${pad.l},${pad.t + ih} ${linePts} ${x(lastIdx).toFixed(1)},${pad.t + ih}`}
                  className="fill-primary/10"
                />
                <polyline
                  points={linePts}
                  fill="none"
                  strokeWidth={2}
                  vectorEffect="non-scaling-stroke"
                  className="stroke-primary"
                />
                <circle
                  cx={x(lastIdx)}
                  cy={y(last.value)}
                  r={3.5}
                  className="fill-primary stroke-card"
                  strokeWidth={1.5}
                />
              </>
            );
          })()
        )}
      </svg>
    </div>
  );
}

export function DashboardTableCard({ table }: { table: DashboardTable }) {
  return (
    <section
      data-testid="dashboard-table"
      className="overflow-hidden rounded-xl border border-border/70 bg-card/50"
    >
      <div className="flex items-baseline justify-between gap-2 border-b border-border/60 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {table.title}
        </h2>
        {table.sub ? (
          <span className="text-[11px] tabular-nums text-muted-foreground">{table.sub}</span>
        ) : null}
      </div>
      {table.rows.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">No rows</div>
      ) : (
        <div data-no-page-swipe className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-border/60 text-[11px] font-medium text-muted-foreground">
                {table.columns.map((col) => (
                  <th
                    key={col.key}
                    className={cn(
                      "px-3 py-1.5 font-medium whitespace-nowrap",
                      col.align === "right" && "text-right",
                    )}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {table.rows.map((row, idx) => (
                <tr key={row.id ?? idx} className="hover:bg-muted/30">
                  {table.columns.map((col, colIdx) => {
                    const cell = row.cells[col.key];
                    return (
                      <td
                        key={col.key}
                        className={cn(
                          "px-3 py-2 whitespace-nowrap",
                          col.align === "right" ? "text-right tabular-nums" : "font-medium",
                        )}
                      >
                        {colIdx === 0 && row.tone ? (
                          <span className="inline-flex items-center gap-2">
                            <span
                              className={cn(
                                "size-1.5 shrink-0 rounded-full",
                                TONE_DOT[row.tone],
                              )}
                            />
                            <span className="truncate">{cell ?? "—"}</span>
                          </span>
                        ) : (
                          cell ?? "—"
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function DashboardListCard({ list }: { list: DashboardList }) {
  return (
    <section
      data-testid="dashboard-list"
      className="overflow-hidden rounded-xl border border-border/70 bg-card/50"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {list.title}
        </h2>
        {list.count !== undefined ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tabular-nums text-foreground">
            {list.count}
          </span>
        ) : null}
      </div>
      {list.items.length === 0 ? (
        <div className="px-3 py-5 text-center text-xs text-muted-foreground">
          {list.emptyText || "Nothing needs you"}
        </div>
      ) : (
        <ul className="divide-y divide-border/50">
          {list.items.map((item, idx) => (
            <li key={idx} className="flex items-center gap-2.5 px-3 py-2 text-[12.5px]">
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  TONE_DOT[item.tone ?? "neutral"],
                )}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-foreground">{item.title}</div>
                {item.detail ? (
                  <div className="truncate text-[11px] text-muted-foreground">{item.detail}</div>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-1.5 text-right text-[11px] tabular-nums text-muted-foreground">
                {item.badge ? (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                      DELTA_BADGE[item.tone ?? "neutral"],
                    )}
                  >
                    {item.badge}
                  </span>
                ) : null}
                {item.value ? <b className="font-semibold text-foreground">{item.value}</b> : null}
                {item.when ? <span>{item.when}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DashboardSectionView({ section }: { section: DashboardSection }) {
  if (section.kind === "kpis") {
    return (
      <section className="space-y-1.5">
        {section.title ? (
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {section.title}
          </h2>
        ) : null}
        <DashboardKpiGrid items={section.items} />
      </section>
    );
  }
  if (section.kind === "chart") {
    return (
      <section className="rounded-xl border border-border/70 bg-card/50 p-3">
        <DashboardChartBody chart={section.chart} />
      </section>
    );
  }
  if (section.kind === "charts") {
    return (
      <section className="rounded-xl border border-border/70 bg-card/50 p-3">
        {section.title ? (
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {section.title}
          </h2>
        ) : null}
        <div
          className={cn(
            "grid grid-cols-1 gap-4",
            section.charts.length >= 3
              ? "md:grid-cols-3"
              : section.charts.length === 2
                ? "md:grid-cols-2"
                : "",
          )}
        >
          {section.charts.map((chart, idx) => (
            <DashboardChartBody key={`${chart.title}-${idx}`} chart={chart} />
          ))}
        </div>
      </section>
    );
  }
  if (section.kind === "table") {
    return <DashboardTableCard table={section.table} />;
  }
  if (section.kind === "list") {
    return <DashboardListCard list={section.list} />;
  }
  return null;
}

export default function DashboardPage({
  active = true,
  initialData = null,
  isSessionBusy,
  onEdit,
  onOpenEditorSession,
}: {
  active?: boolean;
  initialData?: DashboardPayload | null;
  /**
   * Whether a session is running a turn. Only the dashboard's own editing
   * session (editorSessionId) drives "Updating…"; other agents at work on the
   * computer do not.
   */
  isSessionBusy?: (sessionId: string) => boolean;
  /**
   * Start an edit. The shell writes a prompt for the view in the normal chat
   * composer, where the person finishes it and picks the agent and model.
   */
  onEdit?: (activeView: DashboardView | null) => void;
  /** Open the chat transcript for the dashboard's editing session. */
  onOpenEditorSession?: (sessionId: string) => void;
}) {
  const [data, setData] = useState<DashboardPayload | null>(initialData);
  // Null until a tab is picked: the first view (lowest order) opens by default.
  const [selectedViewId, setSelectedViewId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const agentBusy = !!(data?.editorSessionId && isSessionBusy?.(data.editorSessionId));

  const load = useCallback(async () => {
    try {
      const next = await api<DashboardPayload>("/api/dashboard", { cache: "no-store" });
      setData(next);
    } catch {
      // Keep existing view if a background poll fails.
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
    const pollMs = agentBusy ? 3_000 : 15_000;
    const t = setInterval(() => void load(), pollMs);
    return () => clearInterval(t);
  }, [active, agentBusy, load]);

  const views = useMemo(() => data?.views ?? [], [data]);
  const activeView = useMemo(
    () => views.find((v) => v.id === selectedViewId) ?? views[0] ?? null,
    [views, selectedViewId],
  );

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const res = await api<{ ok: boolean; dashboard: DashboardPayload }>("/api/dashboard/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.dashboard) setData(res.dashboard);
      toast.success("Dashboard refreshed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not refresh dashboard");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-3 pb-28" data-lfg-page-column data-testid="dashboard-page">
      <div className="flex items-center gap-2 px-1">
        {/* A phone names the page in its header bar (mobileHeader). */}
        <h1 className="shrink-0 text-lg font-semibold tracking-[-0.01em] max-md:hidden">Dashboard</h1>

        {views.length > 1 ? (
          <div
            role="tablist"
            aria-label="Dashboard views"
            data-no-page-swipe
            className="flex min-w-0 items-center gap-1 overflow-x-auto rounded-full bg-muted/70 p-0.5"
          >
            {views.map((view) => {
              const selected = view.id === activeView?.id;
              return (
                <button
                  key={view.id}
                  type="button"
                  role="tab"
                  data-testid={`dashboard-tab-${view.id}`}
                  aria-selected={selected}
                  onClick={() => setSelectedViewId(view.id)}
                  className={cn(
                    "h-7 shrink-0 rounded-full px-3 text-xs font-medium transition-colors",
                    selected
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {view.title}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {agentBusy && onOpenEditorSession ? (
            <Button
              size="sm"
              variant="ghost"
              data-testid="dashboard-open-agent-session"
              title="Open the chat that is editing the dashboard"
              onClick={() => onOpenEditorSession(data!.editorSessionId!)}
              className="h-8 gap-1.5 px-2.5 text-xs"
            >
              <Loader2 className="size-3.5 animate-spin text-primary" />
              <span>Updating…</span>
            </Button>
          ) : null}
          {onEdit ? (
            <Button
              size="sm"
              variant="ghost"
              data-testid="dashboard-edit"
              title="Edit the dashboard with an agent"
              onClick={() => onEdit(activeView)}
              className="h-8 gap-1.5 px-2.5 text-xs"
            >
              <Sparkles className="size-3.5 text-primary" />
              <span>Edit</span>
            </Button>
          ) : null}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Refresh dashboard"
            title="Refresh dashboard"
            disabled={refreshing}
            onClick={() => void handleRefresh()}
          >
            <RotateCcw className={cn("size-4", refreshing && "animate-spin")} />
          </Button>
        </div>
      </div>

      {activeView === null ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-3">
          {activeView.kpis?.length ? <DashboardKpiGrid items={activeView.kpis} /> : null}
          {activeView.sections?.map((section, idx) => (
            <DashboardSectionView key={`${activeView.id}-sec-${idx}`} section={section} />
          ))}
        </div>
      )}
    </div>
  );
}
