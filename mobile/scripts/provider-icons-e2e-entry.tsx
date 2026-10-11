/** Simulator-only proof of the production avatar and provider assets. */
import { registerRootComponent } from "expo";
import { useState } from "react";
import { Appearance, Image, Pressable, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { AgentAvatar } from "../src/components";
import { modelProviderIcon } from "../src/omg/model-provider-icons";
import { useTheme } from "../src/omg/theme";

Appearance.setColorScheme("dark");
const agents = ["grok", "devin", "muse", "cursor", "codex", "claude", "deepseek", "hermes", "opencode", "pi", "jcode", "copilot", "fx", "omg"];
const providers = ["callstack", "anthropic", "deepseek", "minimax", "openai", "qwen", "x-ai", "z-ai"];

function App() {
  const { colors, isDark } = useTheme();
  const [page, setPage] = useState<"agents" | "providers">("agents");
  const button = (label: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ padding: 12, borderRadius: 12, backgroundColor: colors.secondary }}>
      <Text style={{ color: colors.text, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
    <View style={{ padding: 16, gap: 12 }}>
      <Text style={{ color: colors.text, fontSize: 20, fontWeight: "600" }}>Icon audit · {page} · {isDark ? "dark" : "light"}</Text>
      <Text style={{ color: colors.textMuted }}>Production avatars and picker assets</Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        {button(page === "agents" ? "Show providers" : "Show agents", () => setPage(page === "agents" ? "providers" : "agents"))}
        {button(isDark ? "Light theme" : "Dark theme", () => Appearance.setColorScheme(isDark ? "light" : "dark"))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {(page === "agents" ? agents : providers).map(name => (
          <View key={name} style={{ width: "47%", gap: 4, paddingVertical: 4 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <AgentAvatar agent={page === "agents" ? name : "omg"} model={page === "providers" ? `omg/${name}/example` : undefined} size={44} plain />
              {page === "agents" ? <AgentAvatar agent={name} size={22} plain /> :
                <Image source={modelProviderIcon(name)!} style={{ width: 24, height: 24, tintColor: colors.text }} resizeMode="contain" />}
            </View>
            <Text style={{ color: colors.text, fontSize: 16 }}>{name}</Text>
          </View>
        ))}
      </View>
    </View>
  </SafeAreaView></SafeAreaProvider>;
}
registerRootComponent(App);
