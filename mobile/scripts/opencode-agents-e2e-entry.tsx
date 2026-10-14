/**
 * Simulator proof for two things on the production components, no Computer:
 *
 * 1. OpenCode's model list: lab marks, short names, router sections, through
 *    the same `modelOptionLook` the composer uses, on real OpenCode ids.
 * 2. Settings › Coding agents › Update all agents: the production row driven
 *    by the production runner against a scripted Computer, so the run shows
 *    each agent's step and ends with each agent's result. Codex fails on
 *    purpose so the failure state is on screen too.
 */
import { registerRootComponent } from "expo";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { AgentAvatar, Card } from "../src/components";
import { AgentSetupSheet } from "../src/omg/agent-setup-sheet";
import { AgentUpdateAllRow } from "../src/omg/agent-update-all-row";
import { runAgentUpdateAll, type AgentUpdateTransport } from "../src/omg/agent-updates";
import { modelOptionLook } from "../src/omg/session-options";
import { Text } from "../src/omg/text";
import { useTheme } from "../src/omg/theme";
import { modelListHasRoutes, omgModelLabel } from "../../packages/protocol/src/omg-model-display";

const OPENCODE_MODELS = [
  "opencode-go/glm-5.3",
  "opencode-go/kimi-k3",
  "opencode-go/deepseek-v4.1-flash",
  "opencode-go/claude-haiku-5-5",
  "opencode/big-pickle",
  "novita-ai/zai-org/glm-5",
  "novita-ai/qwen/qwen3.8-max",
  "openai/gpt-6.1-sol",
  "xai/grok-4.5",
];

/** A Computer that runs Codex and OpenCode updates over about thirty seconds. */
function scriptedComputer(): AgentUpdateTransport {
  let poll = 0;
  const step = (label: string, percent: number) => ({ setupRunning: true, setupProgress: { percent, label } });
  const timeline = [
    [step("Installing latest CLI…", 40), step("Waiting…", 5)],
    [step("Installing latest CLI…", 40), step("Waiting…", 5)],
    [step("Install failed", 70), step("Installing latest CLI…", 40)],
    [step("Install failed", 70), step("Installing latest CLI…", 40)],
    [step("Refreshing models…", 80), step("Refreshing models…", 80)],
  ];
  return {
    async request<T>(path: string): Promise<T> {
      if (path === "/api/coding-agents/update-all") {
        return {
          kinds: ["codex", "opencode"],
          agents: [
            { key: "codex", label: "Codex", status: { version: "0.162.1", setupRunning: true } },
            { key: "opencode", label: "OpenCode", status: { version: "1.17.6", setupRunning: true } },
          ],
        } as T;
      }
      const frame = timeline[poll];
      poll += 1;
      if (frame) {
        return { agents: [
          { key: "codex", label: "Codex", status: { version: "0.162.1", ...frame[0] } },
          { key: "opencode", label: "OpenCode", status: { version: "1.17.6", ...frame[1] } },
        ] } as T;
      }
      return { agents: [
        { key: "codex", label: "Codex", status: { version: "0.162.1", setupRunning: false, setupResult: { action: "update", ok: false, error: "npm ERR! network request to registry.npmjs.org failed", finishedAt: Date.now() } } },
        { key: "opencode", label: "OpenCode", status: { version: "1.17.7", setupRunning: false, setupResult: { action: "update", ok: true, finishedAt: Date.now() } } },
      ] } as T;
    },
  };
}

function App() {
  const { colors, type, space } = useTheme();
  const [model, setModel] = useState(OPENCODE_MODELS[0]!);
  const [visible, setVisible] = useState(false);
  const options = useMemo(() => {
    const routed = modelListHasRoutes(OPENCODE_MODELS);
    return OPENCODE_MODELS.map((id) => ({
      id,
      ...modelOptionLook(id, routed),
      selected: id === model,
      onPress: () => setModel(id),
    }));
  }, [model]);
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
    <ScrollView contentContainerStyle={{ paddingVertical: 24, gap: 16 }}>
      <View style={{ paddingHorizontal: 24, gap: 12 }}>
        <Text style={{ ...type.title, color: colors.text }}>OpenCode models and agent updates</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <AgentAvatar agent="opencode" model={model} size={40} />
          <Text style={{ ...type.callout, color: colors.text }}>Selected: {omgModelLabel(model)}</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Open OpenCode models" onPress={() => setVisible(true)} style={{ minHeight: 48, justifyContent: "center", padding: 12, backgroundColor: colors.card, borderRadius: 14 }}>
          <Text style={{ ...type.callout, color: colors.text }}>Open OpenCode models</Text>
        </Pressable>
      </View>
      <Text style={{ ...type.caption, color: colors.textMuted, paddingHorizontal: space.lg }}>CODING AGENTS</Text>
      <Card>
        <AgentUpdateAllRow run={(onProgress) => runAgentUpdateAll(scriptedComputer(), { onProgress, pollMs: 6000 })} />
      </Card>
    </ScrollView>
    <AgentSetupSheet visible={visible} onClose={() => setVisible(false)} agentOptions={[{ id: "opencode", label: "OpenCode", selected: true }]} modelOptions={options} modelLabel={omgModelLabel(model)} />
  </SafeAreaView></SafeAreaProvider></GestureHandlerRootView>;
}
registerRootComponent(App);
