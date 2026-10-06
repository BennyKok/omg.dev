/** Simulator-only entry. Real screens and purchase hook; mock StoreKit, no charges. */
import { registerRootComponent } from "expo";
import { useState } from "react";
import { Appearance, Pressable, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import PlanRoute from "../app/plan";
import { PlanScreen } from "../src/omg/onboarding-plan";
import { setDemoMode } from "../src/omg/demo";
import { useLucideFont } from "../src/omg/lucide";
import { OmgProvider } from "../src/omg/provider";
import { ToastProvider } from "../src/omg/toast";
import { Text } from "../src/omg/text";
import { useTheme } from "../src/omg/theme";
import { setMockScenario } from "../src/omg/store";
import { setMockBillingScenario } from "../src/omg/billing";
void setDemoMode(true);
function Fixture() {
  const { colors, isDark } = useTheme();
  const [mode, setMode] = useState("settings");
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState("");
  const scenario = (value: string) => {
    setMockScenario(value);
    setMockBillingScenario(value);
    setVersion((v) => v + 1);
    setResult("");
  };
  const action = (label: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8}>
      <Text style={{ color: colors.primary, fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
  return (
    <SafeAreaView
      edges={["top"]}
      style={{ flex: 1, backgroundColor: colors.bg }}
    >
      <View style={{ paddingHorizontal: 12, paddingVertical: 8, gap: 10 }}>
        <Text style={{ color: colors.textMuted, fontSize: 11 }}>
          Plan display fixture · mock StoreKit · no real charge
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 11 }}>
          Appearance: {isDark ? "dark" : "light"}
        </Text>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          {action("Settings plan", () => {
            setMode("settings");
            setResult("");
            scenario("success");
          })}
          {action("Onboarding plan", () => {
            setMode("onboarding");
            setResult("");
            scenario("success");
          })}
          {action("Light", () => Appearance.setColorScheme("light"))}
          {action("Dark", () => Appearance.setColorScheme("dark"))}
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          {action("Empty store", () => scenario("empty"))}
          {action("Store error", () => scenario("error"))}
          {action("Web subscriber", () => scenario("stripe"))}
          {action("Reset plans", () => scenario("success"))}
        </View>
      </View>
      {result ? (
        <Text style={{ color: colors.text }}>{result}</Text>
      ) : mode === "settings" ? (
        <PlanRoute key={version} />
      ) : (
        <PlanScreen
          key={version}
          onPurchased={() => setResult("Mock purchase completed")}
          onSkip={() => setResult("Onboarding skipped; task retained")}
          onClose={() => setResult("Plan closed")}
        />
      )}
    </SafeAreaView>
  );
}
function App() {
  if (!useLucideFont()) return null;
  return (
    <SafeAreaProvider>
      <OmgProvider>
        <ToastProvider>
          <Fixture />
        </ToastProvider>
      </OmgProvider>
    </SafeAreaProvider>
  );
}
registerRootComponent(App);
