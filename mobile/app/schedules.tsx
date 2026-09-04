/**
 * Schedules — the auto agent roster, the web's AutoManageView
 * (/settings/computer/auto, titled "Schedules").
 *
 * One row per agent, in the web's shape: name, an "N open" badge when it has
 * findings waiting, a spinner while a run is in flight, the schedule in words
 * ("Every day at 9:00 AM · in 10h"), and a switch that pauses it. Paused rows
 * dim. The user's own agents come first without a heading; bot-owned ones
 * are grouped under the bot's name, as the web groups them.
 *
 * Tapping a row shows what the list truncates — the prompt preview, the
 * project and the last run. There is no editor here: creating and rewriting a
 * schedule stays on the web, the same split the phone already makes for
 * findings (auto-agents.ts).
 */

import { useNavigation } from "expo-router";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, ScrollView, Switch, View } from "react-native";

import { Card, EmptyState, Row, SectionHeader, Separator } from "../src/components";
import { useAutoAgents, type AutoAgent } from "../src/omg/auto-agents";
import { useBots } from "../src/omg/bots";
import { describeCron, nextRunAt } from "../src/omg/cron";
import { relativeTime } from "../src/omg/format";
import { Text } from "../src/omg/text";
import { useTheme } from "../src/omg/theme";

/**
 * "in 12h", "in 4m", "in 3d" — web/src/App.tsx formatRelativeShort, the
 * compact tail the Schedules row has room for.
 */
export function formatRelativeShort(at: number, now: number = Date.now()): string {
  const diff = at - now;
  if (diff < 45_000) return "now";
  const m = Math.round(diff / 60_000);
  if (m < 60) return `in ${m}m`;
  const h = Math.round(diff / 3_600_000);
  if (h < 48) return `in ${h}h`;
  return `in ${Math.round(diff / 86_400_000)}d`;
}

/** The web's compact ScheduleSummary: description plus a short "next" tail. */
export function scheduleSummary(expr: string, tz: string, now: number = Date.now()): string {
  const desc = describeCron(expr);
  const next = nextRunAt(expr, tz, now);
  return next ? `${desc} · ${formatRelativeShort(next, now)}` : desc;
}

type Group = { key: string; label?: string; items: AutoAgent[] };

/**
 * The web's grouping: the user's own rows first, then one group per bot, and
 * within a group the enabled rows before the paused ones.
 */
export function groupAgents(agents: AutoAgent[], botName: (id: string) => string): Group[] {
  const own: AutoAgent[] = [];
  const byBot = new Map<string, AutoAgent[]>();
  for (const a of agents) {
    if (a.owner?.kind === "bot") {
      const list = byBot.get(a.owner.botId) ?? [];
      list.push(a);
      byBot.set(a.owner.botId, list);
    } else own.push(a);
  }
  const order = (list: AutoAgent[]) =>
    [...list].sort((a, b) => Number(b.enabled) - Number(a.enabled));
  const groups: Group[] = [];
  if (own.length) groups.push({ key: "own", items: order(own) });
  for (const [botId, items] of byBot) {
    groups.push({ key: `bot:${botId}`, label: botName(botId), items: order(items) });
  }
  return groups;
}

export default function SchedulesScreen() {
  const navigation = useNavigation();
  const { colors, type, space, radius } = useTheme();
  const { agents, findings, tz, loading, refresh, setAgentEnabled } = useAutoAgents();
  const { bots } = useBots();
  const [pulling, setPulling] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // The relative tail ("in 10h") is derived at render time; a 30s tick is
  // the clock, as on the web.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({ title: "Schedules", headerLargeTitle: true });
  }, [navigation]);

  useEffect(() => {
    if (!loading) setPulling(false);
  }, [loading]);

  const openByAgent = useMemo(() => {
    const counts = new Map<string, number>();
    for (const f of findings) counts.set(f.agentId, (counts.get(f.agentId) ?? 0) + 1);
    return counts;
  }, [findings]);

  const botName = useCallback(
    (id: string) => bots.find((bot) => bot.id === id)?.name ?? "Bot",
    [bots],
  );
  const groups = useMemo(() => groupAgents(agents, botName), [agents, botName]);

  const onCount = agents.filter((a) => a.enabled).length;

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: space.xxl, gap: space.md }}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={
        <RefreshControl
          refreshing={pulling}
          onRefresh={() => {
            setPulling(true);
            refresh();
          }}
          tintColor={colors.textMuted}
        />
      }
    >
      <Text
        style={{
          ...type.footnote,
          color: colors.textMuted,
          paddingHorizontal: space.lg,
          paddingTop: space.xs,
        }}
      >
        {agents.length
          ? `${onCount} of ${agents.length} on · times in ${tz}`
          : "Agents that run on a timer and report what they find."}
      </Text>

      {agents.length === 0 && loading ? null : agents.length === 0 ? (
        <EmptyState
          title="No schedules yet"
          detail="Create one on the web: Schedules, then New."
        />
      ) : (
        groups.map((group) => (
          <View key={group.key} style={{ gap: space.sm }}>
            {group.label ? <SectionHeader label={group.label} count={group.items.length} /> : null}
            <Card>
              {group.items.map((a, index) => {
                const open = openByAgent.get(a.id) ?? 0;
                const isOpen = expanded === a.id;
                return (
                  <View key={a.id}>
                    {index > 0 ? <Separator inset={space.lg} /> : null}
                    <Row onPress={() => setExpanded((cur) => (cur === a.id ? null : a.id))}>
                      <View style={{ flex: 1, minWidth: 0, gap: 2, opacity: a.enabled ? 1 : 0.6 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                          <Text
                            numberOfLines={1}
                            style={{ ...type.subhead, color: colors.text, flexShrink: 1 }}
                          >
                            {a.name}
                          </Text>
                          {open ? (
                            <View
                              style={{
                                borderRadius: radius.pill,
                                paddingHorizontal: 6,
                                paddingVertical: 2,
                                backgroundColor: colors.accentSoft,
                              }}
                            >
                              <Text style={{ ...type.caption, fontSize: 10, color: colors.primary }}>
                                {open} open
                              </Text>
                            </View>
                          ) : null}
                          {a.running ? (
                            <ActivityIndicator size="small" color={colors.primary} />
                          ) : null}
                        </View>
                        <Text
                          numberOfLines={isOpen ? undefined : 1}
                          style={{ ...type.footnote, color: colors.textMuted }}
                        >
                          {scheduleSummary(a.schedule, tz, now)}
                        </Text>
                        {isOpen ? (
                          <View style={{ gap: 2, paddingTop: space.xs }}>
                            {a.prompt ? (
                              <Text style={{ ...type.footnote, color: colors.textSecondary }}>
                                {a.prompt}
                              </Text>
                            ) : null}
                            <Text style={{ ...type.caption, color: colors.textMuted }}>
                              {[
                                a.project ? `Project ${a.project}` : null,
                                a.lastRunAt ? `Last run ${relativeTime(a.lastRunAt)}` : "Never run",
                                a.schedule,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <Switch
                        value={a.enabled}
                        onValueChange={(next) => void setAgentEnabled(a.id, next)}
                        accessibilityLabel={`${a.enabled ? "Disable" : "Enable"} ${a.name}`}
                      />
                    </Row>
                  </View>
                );
              })}
            </Card>
          </View>
        ))
      )}
    </ScrollView>
  );
}
