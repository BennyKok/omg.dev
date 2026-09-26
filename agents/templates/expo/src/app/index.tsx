import { GlassView } from "expo-glass-effect";
import { Check, Circle, Plus, RotateCw, Trash2 } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { type Task, tasksApi } from "../lib/tasks";

const INK = "#191724";
const CORAL = "#ff6542";

export default function HomeScreen() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTasks(await tasksApi.list());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load tasks.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadTasks(); }, [loadTasks]);

  const remaining = useMemo(() => tasks.filter((task) => !task.done).length, [tasks]);

  async function addTask() {
    const title = draft.trim();
    if (!title || saving) return;
    setSaving(true);
    setError(null);
    try {
      const task = await tasksApi.create(title);
      setTasks((current) => [task, ...current]);
      setDraft("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add the task.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleTask(task: Task) {
    const done = !task.done;
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, done } : item));
    try {
      await tasksApi.update(task.id, { done });
    } catch (cause) {
      setTasks((current) => current.map((item) => item.id === task.id ? task : item));
      setError(cause instanceof Error ? cause.message : "Could not update the task.");
    }
  }

  async function removeTask(task: Task) {
    setTasks((current) => current.filter((item) => item.id !== task.id));
    try {
      await tasksApi.remove(task.id);
    } catch (cause) {
      setTasks((current) => [task, ...current]);
      setError(cause instanceof Error ? cause.message : "Could not delete the task.");
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <View pointerEvents="none" style={styles.orbTop} />
        <View pointerEvents="none" style={styles.orbBottom} />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <View>
              <Text style={styles.eyebrow}>__OMG_PROJECT_NAME__</Text>
              <Text style={styles.title}>Today</Text>
              <Text style={styles.subtitle}>{remaining === 1 ? "1 task left" : `${remaining} tasks left`}</Text>
            </View>
            <Pressable accessibilityLabel="Reload tasks" hitSlop={12} onPress={() => void loadTasks()} style={styles.iconButton}>
              <RotateCw color={INK} size={19} strokeWidth={2.2} />
            </Pressable>
          </View>

          <GlassView glassEffectStyle="regular" style={styles.composer}>
            <TextInput
              accessibilityLabel="New task"
              onChangeText={setDraft}
              onSubmitEditing={() => void addTask()}
              placeholder="What needs doing?"
              placeholderTextColor="#777180"
              returnKeyType="done"
              style={styles.input}
              value={draft}
            />
            <Pressable
              accessibilityLabel="Add task"
              disabled={!draft.trim() || saving}
              onPress={() => void addTask()}
              style={({ pressed }) => [styles.addButton, (!draft.trim() || saving) && styles.addButtonDisabled, pressed && styles.pressed]}
            >
              {saving ? <ActivityIndicator color="#fff" size="small" /> : <Plus color="#fff" size={22} strokeWidth={2.8} />}
            </Pressable>
          </GlassView>

          {error ? (
            <View style={styles.errorCard}>
              <Text style={styles.errorTitle}>Could not save</Text>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.list}>
            {loading ? <ActivityIndicator color={CORAL} style={styles.loader} /> : null}
            {!loading && tasks.length === 0 && !error ? (
              <View style={styles.empty}>
                <Check color={CORAL} size={28} strokeWidth={2.4} />
                <Text style={styles.emptyTitle}>All clear</Text>
                <Text style={styles.emptyText}>Add a task to start your day.</Text>
              </View>
            ) : null}
            {tasks.map((task) => (
              <View key={task.id} style={styles.taskRow}>
                <Pressable accessibilityLabel={task.done ? "Mark task incomplete" : "Mark task complete"} hitSlop={8} onPress={() => void toggleTask(task)}>
                  {task.done
                    ? <View style={styles.checked}><Check color="#fff" size={15} strokeWidth={3} /></View>
                    : <Circle color="#a49eaa" size={24} strokeWidth={1.8} />}
                </Pressable>
                <Text numberOfLines={2} style={[styles.taskText, task.done && styles.taskTextDone]}>{task.title}</Text>
                <Pressable accessibilityLabel="Delete task" hitSlop={10} onPress={() => void removeTask(task)}>
                  <Trash2 color="#8b8492" size={18} strokeWidth={2} />
                </Pressable>
              </View>
            ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  safeArea: { flex: 1, backgroundColor: "#f7f1eb" },
  content: { alignSelf: "center", maxWidth: 620, minHeight: "100%", paddingBottom: 44, paddingHorizontal: 22, paddingTop: 38, width: "100%" },
  orbTop: { backgroundColor: "#ffab8e", borderRadius: 180, height: 260, opacity: 0.38, position: "absolute", right: -90, top: -100, width: 260 },
  orbBottom: { backgroundColor: "#cbbdff", borderRadius: 180, bottom: -120, height: 280, left: -100, opacity: 0.28, position: "absolute", width: 280 },
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  eyebrow: { color: CORAL, fontSize: 12, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  title: { color: INK, fontSize: 44, fontWeight: "800", letterSpacing: -1.4, marginTop: 4 },
  subtitle: { color: "#716a78", fontSize: 15, fontWeight: "600", marginTop: 3 },
  iconButton: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.58)", borderColor: "rgba(255,255,255,0.82)", borderRadius: 18, borderWidth: 1, height: 44, justifyContent: "center", width: 44 },
  composer: { alignItems: "center", borderColor: "rgba(255,255,255,0.78)", borderRadius: 24, borderWidth: 1, flexDirection: "row", minHeight: 70, overflow: "hidden", paddingHorizontal: 12, paddingVertical: 10 },
  input: { color: INK, flex: 1, fontSize: 17, paddingHorizontal: 8, paddingVertical: 10 },
  addButton: { alignItems: "center", backgroundColor: CORAL, borderRadius: 17, height: 48, justifyContent: "center", width: 48 },
  addButtonDisabled: { opacity: 0.42 },
  pressed: { opacity: 0.72 },
  errorCard: { backgroundColor: "rgba(255,255,255,0.66)", borderColor: "rgba(179,64,64,0.18)", borderRadius: 18, borderWidth: 1, marginTop: 16, padding: 16 },
  errorTitle: { color: "#9c3434", fontSize: 14, fontWeight: "800" },
  errorText: { color: "#765f66", fontSize: 13, lineHeight: 19, marginTop: 4 },
  list: { gap: 10, marginTop: 22 },
  loader: { marginTop: 38 },
  empty: { alignItems: "center", paddingVertical: 54 },
  emptyTitle: { color: INK, fontSize: 18, fontWeight: "800", marginTop: 12 },
  emptyText: { color: "#777180", fontSize: 14, marginTop: 5 },
  taskRow: { alignItems: "center", backgroundColor: "rgba(255,255,255,0.76)", borderColor: "rgba(255,255,255,0.9)", borderRadius: 20, borderWidth: 1, flexDirection: "row", gap: 13, minHeight: 66, paddingHorizontal: 17, paddingVertical: 13, shadowColor: INK, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.04, shadowRadius: 14 },
  checked: { alignItems: "center", backgroundColor: CORAL, borderRadius: 12, height: 24, justifyContent: "center", width: 24 },
  taskText: { color: INK, flex: 1, fontSize: 16, fontWeight: "600", lineHeight: 22 },
  taskTextDone: { color: "#99929e", textDecorationLine: "line-through" },
});
