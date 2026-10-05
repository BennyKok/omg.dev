/**
 * The plan card's two meters for Settings: agents running and AI credit used.
 * The dashboard drew them first (vibes #1887, #1894); plan-card.ts owns the
 * words and the arithmetic, this file only reads and draws.
 *
 * Renders nothing until a read answers with something to show, and nothing on
 * a plan without an allowance or a Computer. A failed read is silent, as on
 * the web: the meters are a glance, not a status page.
 */
import { useCallback, useEffect, useState } from "react";
import { AppState, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";

import { fetchBalance } from "./billing";
import { isDemoMode } from "./demo";
import { control } from "./palette";
import { planCardModel, parseAgentCount, parseBuildUsage, type AgentCount, type BuildUsage, type PlanCardModel } from "./plan-card";
import { controlPlane } from "./provider";
import { useTheme } from "./theme";

/** Demo mode has no account. A fixed, believable state, so the card can be seen. */
const DEMO_STATE = {
  build: { limitUsd: 38, remainingUsd: 34.5, resetsAt: Date.now() + 26 * 86_400_000 } satisfies BuildUsage,
  agents: { active: 2, limit: 5 } satisfies AgentCount,
};

export function usePlanUsage(): PlanCardModel | null {
  const [state, setState] = useState<{ build: BuildUsage | null; agents: AgentCount | null } | null>(null);

  const refresh = useCallback(() => {
    if (isDemoMode()) {
      setState(DEMO_STATE);
      return;
    }
    // Two independent reads. One failing must not hide the other's meter.
    void Promise.allSettled([fetchBalance(), controlPlane<unknown>("getCloudComputerAgents")]).then(([balance, agents]) => {
      setState({
        build: balance.status === "fulfilled" ? parseBuildUsage(balance.value) : null,
        agents: agents.status === "fulfilled" ? parseAgentCount(agents.value) : null,
      });
    });
  }, []);

  // Agents start and stop on other devices, so re-read on every visit and
  // whenever the app comes back to the foreground.
  useFocusEffect(refresh);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  if (!state) return null;
  return planCardModel(state);
}

function Meter({ percent, low }: { percent: number; low: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={{ height: control.meter, marginTop: 8, borderRadius: control.meter / 2, overflow: "hidden", backgroundColor: colors.meterTrack }}
    >
      <View
        style={{
          width: `${Math.max(0, Math.min(100, percent))}%`,
          height: "100%",
          borderRadius: control.meter / 2,
          backgroundColor: low ? colors.meterLow : colors.brand,
        }}
      />
    </View>
  );
}

/** The meters, for the inside of a grouped card. Null when there is nothing to show. */
export function PlanUsageMeters({ model }: { model: PlanCardModel | null }) {
  const { colors } = useTheme();
  if (!model || (!model.agents && !model.credit)) return null;
  const { agents, credit } = model;
  return (
    <View testID="plan-usage" style={{ paddingHorizontal: 16, paddingVertical: 14, gap: 14 }}>
      {agents ? (
        <View accessible accessibilityLabel={agents.full ? `${agents.label}. All in use` : agents.label}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
            <Text style={{ fontSize: 13, fontWeight: "500", color: colors.text, fontVariant: ["tabular-nums"] }}>
              {agents.label}
            </Text>
            {agents.full ? <Text style={{ fontSize: 13, color: colors.meterLowText }}>All in use</Text> : null}
          </View>
          <Meter percent={agents.usedPercent} low={agents.full} />
        </View>
      ) : null}
      {credit ? (
        <View
          accessible
          accessibilityLabel={`${credit.used}${credit.low ? ". Running low" : ""}. ${credit.resets}`}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
            <Text style={{ fontSize: 13, fontWeight: "500", color: colors.text, fontVariant: ["tabular-nums"] }}>
              {credit.used}
              {credit.low ? <Text style={{ fontWeight: "400", color: colors.meterLowText }}>  Running low</Text> : null}
            </Text>
            <Text style={{ fontSize: 13, color: colors.textMuted }}>{credit.resets}</Text>
          </View>
          <Meter percent={credit.usedPercent} low={credit.low} />
        </View>
      ) : null}
    </View>
  );
}
