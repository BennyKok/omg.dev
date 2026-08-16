/**
 * One auto agent as a home-screen row, and its findings underneath when you
 * open it.
 *
 * WHY THIS IS NOT A SessionCard. The two look alike on purpose — same card
 * shape, same agent mark, same density — because they sit in the same list and
 * a person should not have to learn a second visual language halfway down the
 * screen. But the affordances are different and must not be borrowed: there is
 * no transcript to push to, and nothing to swipe away. A SessionCard whose tap
 * did something else would be the worse kind of consistency.
 *
 * WHAT A ROW SAYS, AND WHY IT SAYS THAT.
 *
 * Matching the web's row (AutoManageView in web/src/App.tsx) is the bar, so
 * the vocabulary is lifted from it: the agent's NAME, an "N open" chip in the
 * primary tint, the running state, and the schedule rendered by the same
 * describeCron + "next …" pair its ScheduleSummary uses. Two deliberate
 * differences, both because a phone row is one line wide and the home screen
 * is a reading surface rather than an editing one:
 *
 * - The web's subtitle is the agent's PROMPT. Here it is the newest open
 *   FINDING's title. The prompt is what you need when you are editing the
 *   agent; the finding is what you need when you are deciding whether to care,
 *   and it is also the reason the row is on this screen at all. (The prompt
 *   arrives truncated from the server anyway — `promptTruncated` — so the row
 *   would have shown half a sentence.)
 * - Severity has no chip. It colours the dot in front of the finding title,
 *   which adds a fact the web's own list omits without spending a second
 *   badge on it.
 *
 * TAPPING OPENS IT IN PLACE. Nothing else on the phone lists findings, so a
 * row that advertises "2 open" and cannot show them is a tease. Expanding is
 * also all a read-only surface can honestly offer: dismiss/resolve/launch are
 * real mutations with a lifecycle behind them (see FindingStatus in
 * src/auto/store.ts) and belong to a screen that can do the whole loop.
 *
 * MOTION: `useListItemMotion()` and nothing else — no `exiting`, ever. See the
 * long note in motion.tsx. The expansion below is exactly the "a re-render
 * lands mid-animation" case that stranded views: it changes this row's height
 * while a 10s poll may be resizing its siblings, and it is safe only because
 * `entering` and `layout` both END with the view in its correct flow position.
 */

import { useRef } from "react";
import Reanimated from "react-native-reanimated";
import { View } from "react-native";

import { AgentAvatar } from "../components";
import { Text } from "./text";
import { useListItemMotion, PressableScale } from "./motion";
import { useTheme } from "./theme";
import { describeCron, nextRunAt } from "./cron";
import type { AutoAgentRow, AutoFinding, AutoFindingSeverity } from "./auto-agents";

/**
 * "in 3h", "in 2d" — the future half of format.ts's relativeTime, in the same
 * compact register.
 *
 * Deliberately NOT web/src/cron.ts's formatRelative, which is built on
 * `Intl.RelativeTimeFormat`. The web can assume a full-ICU browser; Hermes'
 * Intl coverage is thinner and varies by platform, and the failure mode is a
 * throw on a row that is otherwise fine. The phone already spells relative
 * time itself for the Recent section, so this matches that instead of adding
 * a second, wordier style ("in 3 hours") three lines below it.
 */
function nextRunLabel(at: number, now: number = Date.now()): string {
  const seconds = Math.round((at - now) / 1000);
  if (seconds <= 60) return "in <1m";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}

/**
 * The schedule, the way the web's ScheduleSummary says it.
 *
 * A DISABLED agent never gets a "next" — it appears on this screen only
 * because it left an open finding behind, and telling someone it runs again in
 * three hours when it will never run again is the kind of small lie that makes
 * a whole screen untrustworthy. It says "Paused" and keeps the cadence for
 * context.
 *
 * Both calls are wrapped: they go through `Intl.DateTimeFormat` with a
 * timezone and `formatToParts`, and a device whose ICU cannot do that should
 * lose the "next in 3h" clause, not the row.
 *
 * NEXT-RUN IS CACHED, AND CACHED CORRECTLY. nextRunAt scans forward a minute
 * at a time for up to 400 days, so a daily agent costs ~1440 formatToParts
 * calls; the list polls every 30s, and recomputing every row on every poll is
 * the exact lag the web's own ScheduleSummary comment warns about.
 *
 * The cache is TAGGED with the schedule+timezone it was computed for and
 * checked during render, rather than cached in state and invalidated from an
 * effect. An effect runs after commit, so the frame where an agent's schedule
 * changes would render the OLD agent's next-run — a stale value that is merely
 * scheduled for deletion is still a stale value that reached the screen. A tag
 * that does not match is unusable rather than pending. (Same failure the
 * composer's pill-width cache had.)
 *
 * The second condition is what the web gets from its 30s tick: once the cached
 * instant is in the past, it is recomputed. Everything else reuses it.
 */
function useScheduleLine(schedule: string, enabled: boolean, tz: string): string {
  const cache = useRef<{ key: string; at: number | null } | null>(null);
  const now = Date.now();
  const key = `${schedule}|${tz}`;
  if (!cache.current || cache.current.key !== key || (cache.current.at ?? Infinity) <= now) {
    let at: number | null = null;
    try {
      at = nextRunAt(schedule, tz, now);
    } catch {
      at = null;
    }
    cache.current = { key, at };
  }

  let described: string;
  try {
    described = describeCron(schedule);
  } catch {
    described = schedule.trim();
  }
  if (!enabled) return `Paused · ${described}`;
  const at = cache.current.at;
  return at ? `${described} · next ${nextRunLabel(at, now)}` : described;
}

function severityColor(
  severity: AutoFindingSeverity | undefined,
  colors: ReturnType<typeof useTheme>["colors"],
): string {
  switch (severity) {
    case "high":
      return colors.danger;
    case "med":
      return colors.warning;
    default:
      return colors.textMuted;
  }
}

/** The severity dot. 7pt: reads next to 13pt text without becoming a bullet. */
function SeverityDot({ severity }: { severity?: AutoFindingSeverity }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        width: 7,
        height: 7,
        borderRadius: 3.5,
        marginTop: 5,
        backgroundColor: severityColor(severity, colors),
      }}
    />
  );
}

/** One open finding, expanded: what it found, why, and what it suggests. */
function FindingDetail({ finding }: { finding: AutoFinding }) {
  const { colors, type, space } = useTheme();
  const seen = finding.occurrences ?? 1;
  return (
    <View style={{ flexDirection: "row", gap: space.sm }}>
      <SeverityDot severity={finding.severity} />
      <View style={{ flex: 1, gap: space.xs }}>
        <Text style={{ ...type.footnote, fontWeight: "600", color: colors.text, lineHeight: 18 }}>
          {finding.title}
        </Text>
        {/* A repeat is the strongest signal a finding carries — the same
            problem reported N times is not N times as noisy, it is N times as
            real. src/auto/store.ts tracks it precisely because a recurrence
            that reads as brand new gets triaged as brand new. */}
        {seen > 1 ? (
          <Text style={{ ...type.caption, color: colors.warning }}>seen {seen}×</Text>
        ) : null}
        {finding.reasoning?.length ? (
          <View style={{ gap: 2 }}>
            {finding.reasoning.map((line, i) => (
              <Text
                key={i}
                style={{ ...type.caption, color: colors.textMuted, lineHeight: 17 }}
              >
                {`· ${line}`}
              </Text>
            ))}
          </View>
        ) : null}
        {finding.suggest ? (
          <Text style={{ ...type.caption, color: colors.textSecondary, lineHeight: 17 }}>
            <Text style={{ ...type.caption, color: colors.primary }}>Suggests </Text>
            {finding.suggest}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export function AutoAgentCard({
  row,
  tz,
  expanded,
  onToggle,
}: {
  row: AutoAgentRow;
  /** The MACHINE's schedule timezone. See cron.ts. */
  tz: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { colors, radius, type, space } = useTheme();
  // Outer, style-less view owns list membership, exactly as SessionCard does —
  // press feedback and list motion are different concerns with different
  // lifetimes.
  const listMotion = useListItemMotion();
  const { agent, findings } = row;
  const headline = findings[0];
  const open = findings.length;
  const schedule = useScheduleLine(agent.schedule, agent.enabled, tz);

  return (
    <Reanimated.View entering={listMotion.entering} layout={listMotion.layout}>
      <PressableScale
        onPress={onToggle}
        scale={0.98}
        accessibilityRole="button"
        accessibilityLabel={`${agent.name}, ${open} open finding${open === 1 ? "" : "s"}`}
        accessibilityState={{ expanded }}
        style={({ pressed }) => ({
          flexDirection: "row",
          gap: space.md,
          marginHorizontal: space.lg,
          padding: space.md,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: colors.borderStrong,
          backgroundColor: pressed ? colors.cardPressed : colors.card,
        })}
      >
        {/* The ring around the mark is how "working" reads everywhere else in
            this app, and a scheduled run in flight is the same fact. */}
        <AgentAvatar agent={agent.agent} size={26} plain busy={!!agent.running} />
        <View style={{ flex: 1, gap: 3 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <Text numberOfLines={1} style={{ ...type.headline, color: colors.text, flexShrink: 1 }}>
              {agent.name}
            </Text>
            {/* "N open" — the web's words, in the web's tint. */}
            {open ? (
              <View
                style={{
                  paddingHorizontal: 6,
                  paddingVertical: 1,
                  borderRadius: radius.pill,
                  backgroundColor: colors.accentSoft,
                }}
              >
                <Text
                  style={{
                    ...type.caption,
                    fontSize: 10,
                    fontWeight: "600",
                    color: colors.primary,
                  }}
                >
                  {open} open
                </Text>
              </View>
            ) : null}
            {/* An agent with no findings is here only because it is running,
                and the ring alone does not say so in words. */}
            {!open && agent.running ? (
              <Text style={{ ...type.caption, color: colors.warning }}>running</Text>
            ) : null}
          </View>

          {headline && !expanded ? (
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <SeverityDot severity={headline.severity} />
              <Text
                numberOfLines={2}
                style={{ ...type.footnote, color: colors.textSecondary, flex: 1, lineHeight: 18 }}
              >
                {headline.title}
              </Text>
            </View>
          ) : null}

          {expanded && findings.length ? (
            <View style={{ gap: space.md, paddingTop: space.xs }}>
              {findings.map((finding) => (
                <FindingDetail key={finding.id} finding={finding} />
              ))}
            </View>
          ) : null}

          {/* The schedule stays on every row, expanded or not: it is the one
              fact that makes this an AUTO agent rather than a session, and it
              answers "when do I get a better answer than this one". */}
          <Text numberOfLines={1} style={{ ...type.caption, color: colors.textMuted }}>
            {schedule}
          </Text>
        </View>
      </PressableScale>
    </Reanimated.View>
  );
}
