/**
 * Simulator-only: the first-task cards and their questions on their own, no
 * sign-in needed, so they can be seen and screenshotted. A finished pick is
 * echoed on screen, prompt and all, instead of starting anything.
 */
import { registerRootComponent } from "expo";
import { useState } from "react";
import { Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { OnboardingFlow } from "../src/omg/onboarding-flow";

function App() {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: "#111" }}>
        {picked ? (
          <Text style={{ margin: 40, marginTop: 120, color: "#fff", fontSize: 18 }}>{`Would start:\n\n${picked}`}</Text>
        ) : (
          <OnboardingFlow onDone={(choice) => setPicked(choice.prompt)} onAgents={() => setPicked("(agents card)")} />
        )}
      </View>
    </SafeAreaProvider>
  );
}

registerRootComponent(App);
