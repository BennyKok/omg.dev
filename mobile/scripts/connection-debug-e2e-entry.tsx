/** Layout proof of the same Debug section rendered by Settings. */
import { registerRootComponent } from "expo";
import { SafeAreaView, ScrollView, Text } from "react-native";
import { ConnectionDebugSection } from "../src/omg/connection-debug-section";
import { recordConnectionTiming } from "../src/omg/connection-trace";

recordConnectionTiming("bootstrap.parse", performance.now() - 2);
function App() {
  return <SafeAreaView style={{ flex: 1, backgroundColor: "#111" }}>
    <ScrollView contentContainerStyle={{ padding: 20 }}>
      <Text style={{ color: "white", fontSize: 30, margin: 20 }}>Settings</Text>
      <ConnectionDebugSection transport={null} active demo />
    </ScrollView>
  </SafeAreaView>;
}
registerRootComponent(App);
