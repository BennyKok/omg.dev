import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";

type Health = { ok: boolean; service: string };

export default function HomeScreen() {
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);

  async function checkBackend() {
    setFailed(false);
    setHealth(null);
    try {
      const response = await fetch("/health");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setHealth(await response.json() as Health);
    } catch {
      setFailed(true);
    }
  }

  useEffect(() => {
    void checkBackend();
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.card}>
        <Text style={styles.eyebrow}>OMG.DEV EXPO STARTER</Text>
        <Text style={styles.title}>__OMG_PROJECT_NAME__</Text>
        <Text style={styles.body}>Edit src/app/index.tsx to build your product.</Text>
        <View style={styles.status}>
          {!health && !failed ? <ActivityIndicator color="#6d5dfc" /> : null}
          {health ? <Text style={styles.success}>Backend connected</Text> : null}
          {failed ? <Text style={styles.error}>Backend is not available</Text> : null}
        </View>
        <Pressable accessibilityRole="button" onPress={() => void checkBackend()} style={styles.button}>
          <Text style={styles.buttonText}>Check again</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#f4f2ff" },
  card: {
    flex: 1,
    margin: 20,
    padding: 28,
    borderRadius: 28,
    backgroundColor: "#ffffff",
    justifyContent: "center",
    shadowColor: "#17122b",
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
  eyebrow: { color: "#6d5dfc", fontSize: 12, fontWeight: "800", letterSpacing: 1.4 },
  title: { color: "#17122b", fontSize: 38, fontWeight: "800", marginTop: 12 },
  body: { color: "#655f78", fontSize: 17, lineHeight: 25, marginTop: 12 },
  status: { height: 52, justifyContent: "center", marginTop: 24 },
  success: { color: "#16835f", fontSize: 15, fontWeight: "700" },
  error: { color: "#b34040", fontSize: 15, fontWeight: "700" },
  button: { alignSelf: "flex-start", borderRadius: 14, backgroundColor: "#17122b", paddingHorizontal: 18, paddingVertical: 13 },
  buttonText: { color: "#ffffff", fontSize: 15, fontWeight: "700" },
});
