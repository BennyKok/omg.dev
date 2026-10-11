/** Simulator fixture showing the shipped assets and production avatar. */
import { registerRootComponent } from "expo";
import { Appearance, Image, Pressable, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { AgentAvatar } from "../src/components";
import { useTheme } from "../src/omg/theme";

Appearance.setColorScheme("dark");
function App() {
  const { colors, isDark } = useTheme();
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
    <View style={{ padding: 24, gap: 24 }}>
      <Text style={{ color: colors.text, fontSize: 24 }}>omg.dev app icon · {isDark ? "dark" : "light"}</Text>
      <Image accessibilityLabel="Orange omg.dev app icon on white" source={require("../assets/icon.png")} style={{ width: 200, height: 200, borderRadius: 44 }} />
      <Text style={{ color: colors.text }}>Production omg agent avatars</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 20 }}>
        {[56, 32, 20].map(size => <AgentAvatar key={size} agent="omg" size={size} plain />)}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={isDark ? "Light theme" : "Dark theme"} onPress={() => Appearance.setColorScheme(isDark ? "light" : "dark")} style={{ padding: 16, backgroundColor: colors.secondary, borderRadius: 16 }}>
        <Text style={{ color: colors.text }}>{isDark ? "Light theme" : "Dark theme"}</Text>
      </Pressable>
    </View>
  </SafeAreaView></SafeAreaProvider>;
}
registerRootComponent(App);
