/** Simulator fixture: production rows, periodic parent updates, and idle layout checks. */
import { registerRootComponent } from "expo";
import { useEffect, useRef, useState } from "react";
import { FlatList, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { TranscriptEntry } from "../src/omg/transcript";
import { Text } from "../src/omg/text";
import { useTheme } from "../src/omg/theme";
import { useLucideFont } from "../src/omg/lucide";

const messages = Array.from({ length: 40 }, (_, i) => ({
  id: `idle-${i}`, role: "assistant" as const, kind: "text" as const, ts: i + 1,
  text: `Reply ${i + 1}: Read this message without touching the screen.\n\n**Stable text** with a [link](https://omg.dev).\n\n- First item\n- Second item\n\n| Check | Result |\n| --- | --- |\n| Layout | Readable |\n\n\`\`\`ts\nconst value = ${i};\n\`\`\``,
}));
function App() {
  const { colors } = useTheme();
  const ready = useLucideFont();
  const [ticks, setTicks] = useState(0);
  const [changes, setChanges] = useState(0);
  const ticksRef = useRef(0);
  const heights = useRef(new Map<string, number>());
  useEffect(() => {
    if (!ready) return;
    const timer = setInterval(() => { ticksRef.current++; setTicks(ticksRef.current); }, 500);
    return () => clearInterval(timer);
  }, [ready]);
  if (!ready) return null;
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
    <Text style={{ color: colors.text, padding: 12 }}>
      {ticks < 40 ? "Idle check watching" : changes ? `Idle check failed: ${changes} height changes` : "Idle check passed: 20 seconds"}
    </Text>
    <FlatList data={messages} extraData={ticks} keyExtractor={item => item.id}
      removeClippedSubviews={false} windowSize={7} contentContainerStyle={{ padding: 20, gap: 20 }}
      renderItem={({ item }) => <View onLayout={event => {
        const height = event.nativeEvent.layout.height;
        const previous = heights.current.get(item.id);
        if (ticksRef.current >= 8 && previous !== undefined && Math.abs(previous - height) > 1) setChanges(n => n + 1);
        heights.current.set(item.id, height);
      }}><TranscriptEntry message={item} /></View>} />
  </SafeAreaView></SafeAreaProvider>;
}
registerRootComponent(App);
