/**
 * Simulator-only transcript fixture. Uses the production message renderers.
 * From mobile/: OMG_E2E_ENTRY_FILE=scripts/message-selection-e2e-entry.tsx
 * bun run test:e2e --build --plan message-selection --record
 */
import { registerRootComponent } from 'expo';
import { ScrollView, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { TranscriptEntry } from '../src/omg/transcript';
import { Text } from '../src/omg/text';
import { useTheme } from '../src/omg/theme';
import { useLucideFont } from '../src/omg/lucide';

function App() {
  const { colors } = useTheme();
  // The app root loads this font before it renders; the fixture must too.
  if (!useLucideFont()) return null;
  return <SafeAreaProvider><SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
    <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}>
      <Text style={{ fontSize: 20, color: colors.text }}>Message selection test</Text>
      <View><TranscriptEntry message={{ id: 'sent', role: 'user', kind: 'text', text: 'Help me copy part of this message.\n\n第二段也可以选择。', ts: 1 }} /></View>
      <View><TranscriptEntry message={{ id: 'reply', role: 'assistant', kind: 'text', text: 'Select words across paragraphs.\n\n- First item\n- Second item\n\n| Tool | Result |\n| --- | --- |\n| Table cell | Passed |\n\n```ts\nconst greeting = "hello";\n```', ts: 2 }} /></View>
    </ScrollView>
  </SafeAreaView></SafeAreaProvider>;
}
registerRootComponent(App);
