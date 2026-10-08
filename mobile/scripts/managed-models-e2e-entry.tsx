/** Simulator proof of the production picker with the connected Computer's live catalog. */
import { registerRootComponent } from "expo";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { AgentSetupSheet } from "../src/omg/agent-setup-sheet";
import { Text } from "../src/omg/text";
import { useTheme } from "../src/omg/theme";
import { modelProviderIcon } from "../src/omg/model-provider-icons";
import { omgModelLabel, parseOmgModel } from "../../packages/protocol/src/omg-model-display";
import { modelUsageLevel, type OmgModelPrices } from "../../packages/protocol/src/model-pricing";

type Catalog = { key: string; models?: string[]; defaultModel?: string };
const SERVER = "http://localhost:18766";
function App() {
  const { colors, type } = useTheme();
  const [entry, setEntry] = useState<Catalog | null>(null);
  const [prices, setPrices] = useState<OmgModelPrices["models"]>({});
  const [model, setModel] = useState("");
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetch(`${SERVER}/api/coding-agents`).then(r => { if (!r.ok) throw new Error(`Catalog ${r.status}`); return r.json(); }),
      fetch(`${SERVER}/api/omg/model-prices`).then(r => { if (!r.ok) throw new Error(`Prices ${r.status}`); return r.json(); }),
    ]).then(([catalog, pricing]) => {
      if (cancelled) return;
      const managed = catalog.models.find((item: Catalog) => item.key === "omg");
      if (!managed) throw new Error("Managed agent unavailable");
      setEntry(managed);setPrices(pricing.models);setModel(managed.defaultModel);
    }).catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, []);
  const options = (entry?.models ?? []).map(id => ({
    id, label: omgModelLabel(id), selected: id === model,
    image: modelProviderIcon(parseOmgModel(id)?.provider) ?? undefined,
    creditUsage: modelUsageLevel(prices[id], prices[entry?.defaultModel ?? ""])?.bars ?? 0 as const,
    onPress: () => setModel(id),
  }));
  return <GestureHandlerRootView style={{ flex: 1 }}><SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
    <View style={{ padding: 24, gap: 16 }}>
      <Text style={{ ...type.title, color: colors.text }}>Native model picker test</Text>
      <Text style={{ ...type.callout, color: colors.textMuted }}>Live Computer catalog and prices</Text>
      <Text style={{ ...type.callout, color: colors.text }}>{error || `${options.length} managed models`}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Open model controls" disabled={!entry} onPress={() => setVisible(true)} style={{ minHeight: 48, justifyContent: "center", padding: 12, backgroundColor: colors.card, borderRadius: 14 }}>
        <Text style={{ ...type.callout, color: colors.text }}>Open model controls</Text>
      </Pressable>
      <Text style={{ ...type.callout, color: colors.text }}>Selected: {omgModelLabel(model)}</Text>
    </View>
    <AgentSetupSheet visible={visible} onClose={() => setVisible(false)} agentOptions={[{ id: "omg", label: "omg", selected: true }]} modelOptions={options} modelLabel={omgModelLabel(model)} />
  </SafeAreaView></SafeAreaProvider></GestureHandlerRootView>;
}
registerRootComponent(App);
