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

// One row per agent in the Auto section. The dot is the agent's worst open
// severity, the pill is how many findings it is sitting on, the caption is
// the one to read first. Tapping opens the agent's report, not a finding —
// one row per finding put five "Fleet Health" rows in a list meant for
// sessions, each distinguishable only by a truncated title.
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
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2 text-left outline-none"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium leading-tight">{agentName}</span>
            {count > 1 ? (
              <span
                className="shrink-0 rounded-full bg-primary/12 px-1.5 py-px text-[10px] font-semibold tabular-nums text-primary"
                aria-label={`${count} open findings`}
              >
                {count}
              </span>
            ) : null}
          </span>
          <span className="truncate text-xs leading-tight text-muted-foreground">{lead.title}</span>
        </span>
        {/* Severity sits where a session row puts its unread dot: same size,
            same slot, right of the text and left of the time. One place for
            "this needs you" across the list, coloured by how badly. */}
        <span
          role="status"
          aria-label={`${SEV_LABEL[report.severity]} severity`}
          className={cn("inline-block size-2 shrink-0 rounded-full", SEV_DOT[report.severity])}
        />
        <span
          className={cn(
            "shrink-0 text-[11px] tabular-nums text-muted-foreground/70",
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
