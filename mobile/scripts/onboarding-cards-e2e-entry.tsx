/**
 * Simulator-only: the first-task cards on their own, no sign-in needed, so
 * the carousel can be seen and screenshotted. A pick is echoed on screen
 * instead of starting anything.
 */
import { registerRootComponent } from "expo";
import { useState } from "react";
import { Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { CardsScreen } from "../src/omg/onboarding-cards";

function App() {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: "#111" }}>
        <CardsScreen onPick={setPicked} />
        {picked ? (
          <Text style={{ position: "absolute", top: 60, left: 20, color: "#fff" }}>{`Picked: ${picked}`}</Text>
        ) : null}
      </View>
    </SafeAreaProvider>
  );
}

registerRootComponent(App);
