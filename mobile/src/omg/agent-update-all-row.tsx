/**
 * Settings › Coding agents › "Update all agents".
 *
 * The run lives on the Computer (see agent-updates.ts). This row starts it,
 * lists each agent with its step and a bar while it runs, and ends with each
 * agent's result, so "done" is never a guess. `run` is injected so a test
 * entry can drive the same row without a Computer.
 */
import { useCallback, useState } from "react";
import { ActivityIndicator, Image, View } from "react-native";

import { Icon, Row } from "../components";
import type { SetupOutcome } from "../../../packages/protocol/src/coding-agent-setup-outcome";
import { agentIcon } from "./agent-icons";
import type { AgentUpdateRow } from "./agent-updates";
import { Text } from "./text";
import { useTheme } from "./theme";

export function AgentUpdateAllRow({
  run,
}: {
  run: (onProgress: (rows: AgentUpdateRow[]) => void) => Promise<SetupOutcome>;
}) {
  const { colors, type } = useTheme();
  /**
   * The run lives on the Computer. While it runs, each agent shows its step
   * and a bar. When it ends, each agent shows its result, so "done" is never
   * a guess.
   */
  const [updateState, setUpdateState] = useState<
    | { phase: "idle" }
    | { phase: "running"; rows: AgentUpdateRow[] }
    | { phase: "done"; outcome: SetupOutcome; rows: AgentUpdateRow[] }
    | { phase: "error"; error: string }
  >({ phase: "idle" });
  const runUpdateAll = useCallback(async () => {
    if (updateState.phase === "running") return;
    setUpdateState({ phase: "running", rows: [] });
    let rows: AgentUpdateRow[] = [];
    try {
      const outcome = await run((next) => {
        rows = next;
        setUpdateState({ phase: "running", rows: next });
      });
      setUpdateState({ phase: "done", outcome, rows });
    } catch (e) {
      setUpdateState({ phase: "error", error: e instanceof Error ? e.message : "Could not update agents" });
    }
  }, [updateState, run]);
  const updating = updateState.phase === "running";

  return (
    <>
      <Row onPress={updating ? undefined : () => void runUpdateAll()}>
        <Icon ios="arrow.down.circle" android="download" size={17} color={colors.text} />
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ ...type.callout, color: colors.text }}>Update all agents</Text>
          <Text
            testID="update-all-status"
            style={{
              ...type.footnote,
              color:
                updateState.phase === "error" || (updateState.phase === "done" && !updateState.outcome.ok)
                  ? colors.danger
                  : updateState.phase === "done"
                    ? colors.success
                    : colors.textMuted,
            }}
            numberOfLines={2}
          >
            {updateState.phase === "running"
              ? updateState.rows.length
                ? `Updating ${updateState.rows.length === 1 ? "1 agent" : `${updateState.rows.length} agents`}…`
                : "Starting updates…"
              : updateState.phase === "done"
                ? updateState.outcome.title
                : updateState.phase === "error"
                  ? updateState.error
                  : "Install the latest version of every agent, then refresh models"}
          </Text>
        </View>
        {updating ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
      </Row>
      {updateState.phase === "running" || updateState.phase === "done" ? (
        <UpdateRows state={updateState} />
      ) : null}
    </>
  );
}

/** Each agent in the run: its step and bar while it runs, its result after. */
function UpdateRows({
  state,
}: {
  state: { phase: "running"; rows: AgentUpdateRow[] } | { phase: "done"; outcome: SetupOutcome; rows: AgentUpdateRow[] };
}) {
  const { colors, type, space } = useTheme();
  const keys = state.phase === "done" && state.outcome.rows.length
    ? state.outcome.rows.map((row) => row.key)
    : state.rows.map((row) => row.key);
  if (!keys.length) return null;
  return (
    <View style={{ paddingLeft: space.lg + 17 + space.md, paddingRight: space.lg, paddingBottom: space.md, gap: space.sm }}>
      {keys.map((key) => {
        const live = state.rows.find((row) => row.key === key);
        const result = state.phase === "done" ? state.outcome.rows.find((row) => row.key === key) : undefined;
        const running = state.phase === "running" && live?.running !== false;
        const text = result?.line ?? (running ? live?.step ?? "Waiting…" : "Finishing…");
        const color = result ? (result.ok ? colors.success : colors.danger) : colors.textMuted;
        return (
          <View key={key} testID={`update-row:${key}`} style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Image source={agentIcon(key)} style={{ width: 16, height: 16 }} resizeMode="contain" />
              {result ? (
                <Icon
                  ios={result.ok ? "checkmark.circle.fill" : "xmark.circle.fill"}
                  android={result.ok ? "check_circle" : "cancel"}
                  size={13}
                  color={color}
                />
              ) : null}
              <Text style={{ ...type.footnote, color, flex: 1 }} numberOfLines={1}>
                {result ? text : `${live?.label ?? key} · ${text}`}
              </Text>
            </View>
            {result?.error ? (
              <Text style={{ ...type.caption, color: colors.danger }} numberOfLines={3}>
                {result.error}
              </Text>
            ) : null}
            {running ? (
              <View
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: 100, now: Math.round(live?.percent ?? 5) }}
                style={{ height: 3, borderRadius: 2, backgroundColor: colors.borderSoft, overflow: "hidden" }}
              >
                <View
                  style={{
                    height: 3,
                    borderRadius: 2,
                    width: `${Math.max(4, Math.min(100, live?.percent ?? 5))}%`,
                    backgroundColor: colors.text,
                  }}
                />
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

