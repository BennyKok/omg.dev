import { useRouter } from "expo-router";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { agentIcon } from "../src/omg/agent-icons";
import {
  createArchiveBrowser,
  resumeArchivedSession,
  type ArchiveTransport,
} from "../src/omg/archive";
import { promptStash, stashScope } from "../src/omg/prompt-stash";
import type { StashEntry } from "../src/omg/prompt-stash-store";
import { useOmg } from "../src/omg/provider";
import { Text } from "../src/omg/text";
import { useTheme } from "../src/omg/theme";

export default function ArchiveScreen() {
  const { client, user, bindingId } = useOmg();
  const router = useRouter();
  const scope = stashScope(user?.email, bindingId);
  return (
    <ArchiveContent
      key={scope}
      transport={client?.transport ?? null}
      store={promptStash(scope)}
      onOpen={(id) => router.push(`/session/${id}`)}
      onRestore={(entry) => {
        if (entry.botId) router.push(`/bots/${entry.botId}`);
        else if (entry.sessionId) router.push(`/session/${entry.sessionId}`);
        else router.dismissTo("/");
      }}
    />
  );
}

export function ArchiveContent({
  transport,
  store,
  onOpen,
  onRestore,
}: {
  transport: ArchiveTransport | null;
  store: ReturnType<typeof promptStash>;
  onOpen: (id: string) => void;
  onRestore: (entry: StashEntry) => void;
}) {
  const { colors, type, space, radius } = useTheme();
  const [tab, setTab] = useState<"sessions" | "stash">("sessions");
  const [search, setSearch] = useState("");
  const [resuming, setResuming] = useState<string | null>(null);
  const [resumeError, setResumeError] = useState<string | null>(null);
  const active = useRef(0);
  const browser = useMemo(
    () =>
      createArchiveBrowser(
        transport ?? {
          request: async () => {
            throw Error("Select a Computer to view archived sessions");
          },
        },
      ),
    [transport],
  );
  const state = useSyncExternalStore(
    browser.subscribe,
    browser.snapshot,
    browser.snapshot,
  );
  const stash = useSyncExternalStore(
    store.subscribe,
    store.snapshot,
    store.snapshot,
  );
  useEffect(() => {
    active.current++;
    setResuming(null);
    setResumeError(null);
    return () => {
      active.current++;
      browser.cancel();
    };
  }, [browser]);
  useEffect(() => {
    const timer = setTimeout(() => void browser.search(search), 180);
    return () => {
      clearTimeout(timer);
      browser.cancel();
    };
  }, [browser, search]);
  const restore = (entry: StashEntry) => {
    const apply = () => {
      store.set(entry, entry.text);
      onRestore(entry);
    };
    const existing = store.text(entry.context);
    if (existing && existing !== entry.text)
      Alert.alert(
        "Replace this draft?",
        "The current draft has different text.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Replace", onPress: apply },
        ],
      );
    else apply();
  };
  const resume = async (id: string) => {
    if (!transport || resuming) return;
    const token = active.current;
    setResuming(id);
    setResumeError(null);
    try {
      const next = await resumeArchivedSession(transport, id);
      if (token === active.current) onOpen(next);
    } catch (e) {
      if (token === active.current)
        setResumeError(e instanceof Error ? e.message : String(e));
    } finally {
      if (token === active.current) setResuming(null);
    }
  };
  const filtered = stash.filter((e) =>
    `${e.title} ${e.text}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        padding: space.lg,
        paddingBottom: 80,
        gap: space.md,
      }}
    >
      <View style={{ flexDirection: "row", gap: space.sm }}>
        {(["sessions", "stash"] as const).map((value) => (
          <Pressable
            key={value}
            onPress={() => setTab(value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === value }}
            style={{
              paddingHorizontal: 18,
              paddingVertical: 10,
              borderRadius: radius.pill,
              backgroundColor: tab === value ? colors.card : colors.bg,
            }}
          >
            <Text
              style={{
                ...type.body,
                color: tab === value ? colors.text : colors.textMuted,
              }}
            >
              {value === "sessions" ? "Sessions" : "Stash"}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        accessibilityLabel={
          tab === "sessions"
            ? "Search archived sessions"
            : "Search saved prompts"
        }
        placeholder="Search"
        placeholderTextColor={colors.textMuted}
        value={search}
        onChangeText={setSearch}
        autoCorrect={false}
        style={{
          ...type.body,
          color: colors.text,
          backgroundColor: colors.card,
          borderRadius: radius.md,
          padding: 14,
        }}
      />
      {tab === "sessions" ? (
        <>
          <Text style={{ ...type.caption, color: colors.textMuted }}>
            Open a conversation to read it, or resume the agent.
          </Text>
          {state.error || resumeError ? (
            <Text style={{ ...type.body, color: colors.textMuted }}>
              {state.error || resumeError}
            </Text>
          ) : null}
          {state.error ? (
            <Pressable onPress={() => void browser.refresh()}>
              <Text style={{ color: colors.text }}>Try again</Text>
            </Pressable>
          ) : null}
          {state.items.map((item) => (
            <View
              key={item.sessionId}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
                padding: 14,
                backgroundColor: colors.card,
                borderRadius: radius.md,
              }}
            >
              <Pressable
                onPress={() => onOpen(item.sessionId)}
                style={{
                  flex: 1,
                  flexDirection: "row",
                  gap: 12,
                  alignItems: "center",
                }}
                accessibilityLabel={`Open ${item.title || "session"}`}
              >
                <Image
                  source={agentIcon(item.agent)}
                  style={{ width: 30, height: 30 }}
                />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text
                    numberOfLines={2}
                    style={{
                      ...type.body,
                      color: colors.text,
                      fontWeight: "600",
                    }}
                  >
                    {item.title || "Session"}
                  </Text>
                  <Text
                    numberOfLines={2}
                    style={{ ...type.caption, color: colors.textMuted }}
                  >
                    {item.lastUserText || "Open conversation"}
                  </Text>
                </View>
              </Pressable>
              <Pressable
                disabled={!!resuming}
                onPress={() => void resume(item.sessionId)}
                accessibilityLabel={`Resume ${item.title || "session"}`}
                style={{ paddingVertical: 12, paddingHorizontal: 8 }}
              >
                {resuming === item.sessionId ? (
                  <ActivityIndicator />
                ) : (
                  <Text style={{ ...type.caption, color: colors.text }}>
                    Resume
                  </Text>
                )}
              </Pressable>
            </View>
          ))}
          {state.loading ? (
            <ActivityIndicator />
          ) : !state.items.length && !state.error ? (
            <Text style={{ ...type.body, color: colors.textMuted }}>
              No archived sessions found.
            </Text>
          ) : null}
          {state.items.length < state.total && !state.loading ? (
            <Pressable
              onPress={() => void browser.more()}
              style={{ padding: 14 }}
            >
              <Text
                style={{
                  ...type.body,
                  color: colors.text,
                  textAlign: "center",
                }}
              >
                Load more
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : (
        <>
          <Text style={{ ...type.caption, color: colors.textMuted }}>
            Drafts and recently sent prompts saved on this phone.
          </Text>
          {filtered.map((entry) => (
            <View
              key={entry.id}
              style={{
                padding: 16,
                gap: 8,
                backgroundColor: colors.card,
                borderRadius: radius.md,
              }}
            >
              <Text style={{ ...type.caption, color: colors.textMuted }}>
                {entry.title} ·{" "}
                {entry.status === "sending"
                  ? "Sending"
                  : entry.status === "sent"
                    ? "Sent"
                    : "Draft"}
              </Text>
              <Text
                numberOfLines={4}
                style={{ ...type.body, color: colors.text }}
              >
                {entry.text}
              </Text>
              <View style={{ flexDirection: "row", gap: 24 }}>
                <Pressable
                  onPress={() => restore(entry)}
                  style={{ paddingVertical: 10 }}
                >
                  <Text style={{ color: colors.text }}>Restore</Text>
                </Pressable>
                <Pressable
                  onPress={() => store.remove(entry.id)}
                  style={{ paddingVertical: 10 }}
                >
                  <Text style={{ color: colors.textMuted }}>Remove</Text>
                </Pressable>
              </View>
            </View>
          ))}
          {!filtered.length ? (
            <Text style={{ ...type.body, color: colors.textMuted }}>
              No saved prompts yet.
            </Text>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}
