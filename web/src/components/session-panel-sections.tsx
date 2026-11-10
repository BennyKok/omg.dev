// The two sections an agent's pane leads with:
//
// - "Needs you": open questions from the session's team (its omg child
//   sessions, at any depth), answerable in place. The session's own questions
//   already show in its chat, so they are not repeated here. The source is the
//   one questions feed (ask-center); this only filters it.
// - Status: what the agent set with omg_panel (src/session-panel.ts). It is
//   data, never markup: a headline, markdown, key numbers and one chart drawn
//   here from plain numbers, so it always matches the app.
import { useMemo } from "react";
import type { OmgPanelChart, OmgPanelStatus } from "@omg-dev/protocol";
import { CircleAlert } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { stripMd, useOptionalAsk, type Question } from "@/components/ask-center";
import { flattenTeam, type TeamMember } from "@/lib/session-team";

export type TeamQuestion = { question: Question; member: TeamMember };

/** Open questions from the team, oldest first, each with the member that asked. */
export function teamQuestions(questions: readonly Question[], team: readonly TeamMember[]): TeamQuestion[] {
  if (!questions.length || !team.length) return [];
  const byId = new Map<string, TeamMember>();
  for (const m of flattenTeam(team)) {
    byId.set(m.id, m);
    if (m.nativeId) byId.set(m.nativeId, m);
  }
  const out: TeamQuestion[] = [];
  for (const q of questions) {
    const member = q.sessionId ? byId.get(q.sessionId) : undefined;
    if (member) out.push({ question: q, member });
  }
  return out.sort((a, b) => a.question.createdAt - b.question.createdAt);
}

const NONE: TeamQuestion[] = [];

export function useTeamQuestions(team: readonly TeamMember[]): TeamQuestion[] {
  const ask = useOptionalAsk();
  const questions = ask?.questions;
  return useMemo(() => (questions ? teamQuestions(questions, team) : NONE), [questions, team]);
}

/** Open questions from the team. A tap on an option answers; a tap on the text opens the member. */
export function TeamNeedsSection({
  needs,
  onOpen,
}: {
  needs: readonly TeamQuestion[];
  onOpen: (id: string) => void;
}) {
  const ask = useOptionalAsk();
  if (!needs.length) return null;
  return (
    <section
      aria-label="Needs you"
      data-testid="plan-needs"
      className="mx-3 mt-3 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 first:mt-3"
    >
      <h3 className="flex items-center gap-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
        <CircleAlert className="size-3.5" aria-hidden />
        Needs you · {needs.length}
      </h3>
      <ul className="flex flex-col divide-y divide-amber-500/15">
        {needs.map(({ question: q, member }) => {
          const options = q.secret ? [] : (q.options ?? []);
          return (
            <li key={q.id} data-testid="team-need" data-id={q.id} className="py-1.5">
              <button
                type="button"
                onClick={() => onOpen(member.id)}
                title="Open the session that asked"
                className="block w-full text-left"
              >
                <span className="block truncate text-[11px] font-medium text-muted-foreground">{member.title}</span>
                <span className="line-clamp-3 text-[13px] leading-5 text-foreground">{stripMd(q.question)}</span>
              </button>
              {options.length && ask ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {options.map((label) => (
                    <button
                      key={label}
                      type="button"
                      disabled={ask.busy}
                      onClick={() => void ask.answer(q, label)}
                      className="min-h-7 max-w-full rounded-full border border-border bg-background px-2.5 py-0.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpen(member.id)}
                  className="mt-1 text-xs font-medium text-primary hover:opacity-80"
                >
                  {q.secret ? "Open to enter the key" : "Open to reply"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });
const fmt = (n: number, unit?: string) => `${compact.format(n)}${unit ? (unit === "%" ? "%" : ` ${unit}`) : ""}`;

const TONE: Record<string, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-red-600 dark:text-red-400",
};

/** Bars this many or fewer get a labeled row each; more are drawn as a strip. */
const LABELED_BARS = 12;

/** One chart from plain numbers: a line over time, or bars to compare. */
export function PanelChartView({ chart }: { chart: OmgPanelChart }) {
  const points = chart.points;
  const last = points[points.length - 1];
  const values = points.map((p) => p.value);
  const lo = Math.min(0, ...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const summary = `${chart.title ? `${chart.title}: ` : ""}${points.length} points, latest ${last.label ? `${last.label} ` : ""}${fmt(last.value, chart.unit)}`;

  if (chart.kind === "bar" && points.length <= LABELED_BARS) {
    return (
      <figure data-testid="panel-chart" data-kind="bar" className="mt-3">
        {chart.title ? <figcaption className="pb-1.5 text-[11px] font-medium text-muted-foreground">{chart.title}</figcaption> : null}
        <ul aria-label={summary} className="flex flex-col gap-1">
          {points.map((p, i) => (
            <li key={i} className="grid grid-cols-[minmax(0,6.5rem)_1fr_auto] items-center gap-2 text-[11px] leading-4">
              <span className="truncate text-muted-foreground">{p.label}</span>
              <span className="h-2 overflow-hidden rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-sky-500/80"
                  style={{ width: `${Math.max(0, ((p.value - lo) / span) * 100)}%` }}
                />
              </span>
              <span className="tabular-nums text-foreground/80">{fmt(p.value, chart.unit)}</span>
            </li>
          ))}
        </ul>
      </figure>
    );
  }

  const W = 300;
  const H = 72;
  const x = (i: number) => (points.length === 1 ? W / 2 : (i / (points.length - 1)) * W);
  const y = (v: number) => H - ((v - lo) / span) * (H - 4) - 2;
  let shape: React.ReactNode;
  if (chart.kind === "bar") {
    const w = W / points.length;
    shape = points.map((p, i) => (
      <rect key={i} x={i * w + w * 0.15} width={w * 0.7} y={y(Math.max(p.value, 0))} height={Math.abs(y(p.value) - y(0)) || 1} className="fill-sky-500/80" />
    ));
  } else {
    const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
    shape = (
      <>
        <polygon points={`0,${H} ${line} ${W},${H}`} className="fill-sky-500/10" />
        <polyline points={line} fill="none" strokeWidth={1.75} vectorEffect="non-scaling-stroke" className="stroke-sky-500" />
      </>
    );
  }
  return (
    <figure data-testid="panel-chart" data-kind={chart.kind} className="mt-3">
      <div className="flex items-baseline gap-2 pb-1">
        <figcaption className="min-w-0 flex-1 truncate text-[11px] font-medium text-muted-foreground">{chart.title}</figcaption>
        <span className="shrink-0 text-[13px] font-semibold tabular-nums">{fmt(last.value, chart.unit)}</span>
      </div>
      <svg role="img" aria-label={summary} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-16 w-full overflow-visible">
        {shape}
      </svg>
      {points.length > 1 && (points[0].label || last.label) ? (
        <div className="flex justify-between pt-0.5 text-[10px] tabular-nums text-muted-foreground">
          <span>{points[0].label}</span>
          <span>{last.label}</span>
        </div>
      ) : null}
    </figure>
  );
}

/** What the agent set with omg_panel. */
export function PanelStatusSection({ status, ago }: { status: OmgPanelStatus; ago: string }) {
  return (
    <section aria-label="Status" data-testid="plan-status" className="mx-4 mt-3 border-t border-border/60 pt-2 first:mt-0 first:border-t-0 first:pt-3">
      <h3 className="flex items-baseline pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="flex-1">Status</span>
        <span className="font-normal normal-case tracking-normal tabular-nums">{ago === "now" ? "just now" : `${ago} ago`}</span>
      </h3>
      <p className="text-[14px] font-semibold leading-5 text-foreground">{status.headline}</p>
      {status.stats?.length ? (
        <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2">
          {status.stats.map((s, i) => (
            <div key={i} data-testid="panel-stat" className="flex min-w-0 flex-col-reverse">
              <dt className="truncate text-[11px] leading-4 text-muted-foreground">{s.label}</dt>
              <dd className={`truncate text-[15px] font-semibold leading-5 tabular-nums ${s.tone ? TONE[s.tone] : "text-foreground"}`}>{s.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {status.chart?.points.length ? <PanelChartView chart={status.chart} /> : null}
      {status.text ? (
        <MessageResponse
          className={
            "mt-2.5 text-[13px] leading-relaxed text-foreground/90 " +
            "[&_h1]:text-[13px] [&_h2]:text-[13px] [&_h3]:text-[13px] [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold " +
            "[&_h1]:mt-2 [&_h2]:mt-2 [&_h3]:mt-1.5 [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5"
          }
        >
          {status.text}
        </MessageResponse>
      ) : null}
    </section>
  );
}
