import { Loader2, Sparkles } from "lucide-react";

import type { AgentReport, GroupableFinding } from "@/lib/finding-groups";
import { cn } from "@/lib/utils";

export const SEV_DOT: Record<GroupableFinding["severity"], string> = {
  high: "bg-destructive",
  med: "bg-warning",
  low: "bg-muted-foreground",
};
export const SEV_LABEL: Record<GroupableFinding["severity"], string> = {
  high: "High",
  med: "Medium",
  low: "Low",
};
export function relTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// One row per agent in the Updates list: one line, so a long list scans.
// The leading dot is the agent's worst open severity, the grey number is how
// many findings it is sitting on, and the time is the newest. The lead
// finding's title is the tooltip and part of the accessible name, not a
// second line: two lines per agent, a blue count pill and a trailing dot on
// every row made 89 updates read as a wall of alerts. Tapping opens the
// agent's report, not a finding.
//
// `onTriage` adds a per-group Triage & execute button. It shows on hover (and
// on keyboard focus) where the time sits, so the header button is no longer
// the only way in: one agent's findings can be triaged without the rest.
export function AutoReportRow<F extends GroupableFinding & { title: string }>({
  report,
  agentName,
  onOpen,
  onTriage,
  triageBusy = false,
}: {
  report: AgentReport<F>;
  agentName: string;
  onOpen: () => void;
  onTriage?: () => void;
  triageBusy?: boolean;
}) {
  const count = report.findings.length;
  const lead = report.findings[0];
  return (
    <div className="group/report relative flex w-full items-center rounded-lg hover:bg-muted focus-within:bg-muted">
      <button
        type="button"
        onClick={onOpen}
        title={lead.title}
        aria-label={`${agentName}, ${SEV_LABEL[report.severity].toLowerCase()} severity, ${count} open finding${count === 1 ? "" : "s"}. ${lead.title}`}
        className="flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 text-left outline-none"
      >
        <span
          role="status"
          aria-label={`${SEV_LABEL[report.severity]} severity`}
          className={cn("inline-block size-1.5 shrink-0 rounded-full", SEV_DOT[report.severity])}
        />
        <span className="min-w-0 flex-1 truncate text-sm leading-tight">{agentName}</span>
        {count > 1 ? (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground" aria-hidden="true">
            {count}
          </span>
        ) : null}
        <span
          className={cn(
            "w-7 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground/70",
            onTriage &&
              "group-hover/report:invisible group-focus-within/report:invisible",
          )}
        >
          {relTime(report.latestAt)}
        </span>
      </button>
      {onTriage ? (
        <button
          type="button"
          onClick={onTriage}
          disabled={triageBusy}
          aria-label={`Triage and execute ${count} ${agentName} finding${count === 1 ? "" : "s"}`}
          title={`Triage & execute ${agentName} findings`}
          className="pointer-events-none absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md bg-primary/12 text-primary opacity-0 transition-opacity hover:bg-primary/20 focus-visible:pointer-events-auto focus-visible:opacity-100 disabled:opacity-50 group-hover/report:pointer-events-auto group-hover/report:opacity-100 group-focus-within/report:pointer-events-auto group-focus-within/report:opacity-100 [&_svg]:size-3.5"
        >
          {triageBusy ? <Loader2 className="animate-spin" /> : <Sparkles />}
        </button>
      ) : null}
    </div>
  );
}
