import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Icon } from "../../src/components";
import { DropdownMenu, type MenuOption } from "../../src/omg/menu";
import { useOmg } from "../../src/omg/provider";
import { TaskCard } from "../../src/omg/task-card";
import { Text } from "../../src/omg/text";
import { useTheme } from "../../src/omg/theme";
import { cardMessageIds, latestTaskEvent, sameSession, taskCardState } from "../../src/omg/thread-tasks";
import {
  getThread,
  sendThreadMessage,
  updateThread,
  type ThreadDetail,
  type ThreadMessage,
} from "../../src/omg/threads";
import { QuestionCard, type AskQuestion } from "../session/[id]";

/**
 * A THREAD IS A CHAT BETWEEN PEOPLE. No agent runs behind it, so this is not
 * the session screen: no agent face, no model line, no tool rows. People's
 * messages are bubbles with names. omg speaks only when someone writes
 * `@omg`, and its messages sit on the page without a bubble. A task omg
 * started is a card at the message that started it, with its live state.
 */

const POLL_MS = 3_000;
/** omg's name colour in a thread: the mark's orange, so it reads as a member, not a system line. */
const OMG_ORANGE = "#FF5530";
const ASK_POLL_MS = 5_000;

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { client, repos } = useOmg();
  const { colors, type, space, radius, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [pending, setPending] = useState<ThreadMessage[]>([]);
  const [asks, setAsks] = useState<AskQuestion[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<ThreadMessage>>(null);

  const load = useCallback(async () => {
    if (!client || !id) return;
    try {
      const next = await getThread(client, id);
      setDetail(next);
      setPending((rows) => rows.filter((row) => !next.messages.some((m) => m.author.kind !== "omg" && m.text === row.text)));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [client, id]);

  useFocusEffect(
    useCallback(() => {
      void load();
      const timer = setInterval(() => {
        if (AppState.currentState === "active") void load();
      }, POLL_MS);
      return () => clearInterval(timer);
    }, [load]),
  );

  const taskIds = useMemo(() => (detail?.tasks ?? []).map((task) => task.sessionId), [detail?.tasks]);
  const refreshAsks = useCallback(async () => {
    if (!client || !taskIds.length) {
      setAsks([]);
      return;
    }
    try {
      const res = await client.transport.request<{ questions?: AskQuestion[] }>("/api/ask?status=open");
      setAsks((res.questions ?? []).filter((q) => taskIds.some((task) => sameSession(task, q.sessionId))));
    } catch {
      /* keep what we have */
    }
  }, [client, taskIds]);
  useEffect(() => {
    void refreshAsks();
    const timer = setInterval(() => void refreshAsks(), ASK_POLL_MS);
    return () => clearInterval(timer);
  }, [refreshAsks]);

  const answer = useCallback(
    async (q: AskQuestion, label: string) => {
      if (!client) return;
      void Haptics.selectionAsync();
      setAsks((rows) => rows.filter((row) => row.id !== q.id));
      try {
        await client.transport.request(`/api/ask/${encodeURIComponent(q.id)}/answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answer: label, via: "web", deliver: true }),
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [client],
  );

  const send = useCallback(async () => {
    const body = text.trim();
    if (!client || !id || !body) return;
    setText("");
    const local: ThreadMessage = {
      id: `local-${Date.now()}`,
      threadId: id,
      ts: Date.now(),
      author: { kind: "human", participantId: detail?.me ?? "", name: "You" },
      text: body,
      pending: true,
    };
    setPending((rows) => [...rows, local]);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await sendThreadMessage(client, id, body);
      void load();
    } catch (e) {
      setPending((rows) => rows.filter((row) => row.id !== local.id));
      setText(body);
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [client, id, text, detail?.me, load]);

  const messages = useMemo(() => [...(detail?.messages ?? []), ...pending], [detail?.messages, pending]);
  const cards = useMemo(() => cardMessageIds(messages), [messages]);
  const project = detail?.thread.project ?? null;
  const people = (detail?.participants ?? [])
    .filter((row) => row.kind === "human")
    .map((row) => row.display.name?.trim() || row.display.fallback);

  const projectOptions: MenuOption[] = [
    ...repos.map((repo) => ({
      id: repo.cwd,
      label: repo.name,
      selected: project?.cwd === repo.cwd,
      onPress: () => {
        if (client && id) void updateThread(client, id, { projectCwd: repo.cwd }).then(load);
      },
    })),
    {
      id: "none",
      label: "No project",
      selected: !project,
      onPress: () => {
        if (client && id) void updateThread(client, id, { projectCwd: null }).then(load);
      },
    },
  ];

  // Newest first, for an inverted list: a chat opens at its newest message and
  // stays there as messages arrive, with no scroll-to-end race.
  const newestFirst = useMemo(() => [...messages].reverse(), [messages]);
  const previousById = useMemo(() => {
    const map = new Map<string, ThreadMessage | undefined>();
    messages.forEach((message, index) => map.set(message.id, messages[index - 1]));
    return map;
  }, [messages]);

  const renderMessage = ({ item }: { item: ThreadMessage }) => {
    const previous = previousById.get(item.id);
    const mine = item.author.kind === "human" && item.author.participantId === detail?.me;
    const sameAuthor =
      !!previous &&
      previous.author.kind === item.author.kind &&
      (item.author.kind === "omg" || (previous.author.kind === "human" && previous.author.participantId === item.author.participantId));

    if (item.author.kind === "omg") {
      const task = item.task && cards.has(item.id) ? item.task : null;
      const row = task ? detail?.tasks.find((t) => sameSession(t.sessionId, task.sessionId)) : null;
      return (
        <View style={{ gap: space.sm, paddingTop: sameAuthor ? 0 : space.sm }}>
          {sameAuthor ? null : (
            <Text style={{ ...type.caption, fontWeight: "600", color: OMG_ORANGE }}>omg</Text>
          )}
          <Text style={{ ...type.body, color: colors.text }}>{item.text}</Text>
          {task ? (
            <TaskCard
              sessionId={task.sessionId}
              title={row?.title || task.title || "Task"}
              project={row?.project || task.project || null}
              state={taskCardState({
                event: latestTaskEvent(messages, task.sessionId),
                row,
                openAsk: asks.some((q) => sameSession(task.sessionId, q.sessionId)),
              })}
              onOpen={() => router.push(`/session/${task.sessionId}`)}
            />
          ) : null}
        </View>
      );
    }

    const name = item.author.name;
    if (mine) {
      return (
        <View style={{ alignSelf: "flex-end", maxWidth: "80%", paddingTop: sameAuthor ? 0 : space.sm }}>
          <View style={{ backgroundColor: colors.card, borderRadius: radius.xl, paddingHorizontal: 16, paddingVertical: 10, opacity: item.pending ? 0.6 : 1 }}>
            <Text style={{ ...type.body, color: colors.text }}>{item.text}</Text>
          </View>
        </View>
      );
    }
    return (
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8, maxWidth: "86%", paddingTop: sameAuthor ? 0 : space.sm }}>
        <View style={{ width: 28, alignItems: "center" }}>
          {sameAuthor ? null : (
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.secondary, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ ...type.footnote, fontWeight: "600", color: colors.text }}>{name.slice(0, 1).toUpperCase()}</Text>
            </View>
          )}
        </View>
        <View style={{ flexShrink: 1, gap: 3 }}>
          {sameAuthor ? null : (
            <Text style={{ ...type.caption, color: colors.textMuted, paddingLeft: 12 }}>{name}</Text>
          )}
          <View style={{ backgroundColor: colors.secondary, borderRadius: radius.xl, paddingHorizontal: 16, paddingVertical: 10 }}>
            <Text style={{ ...type.body, color: colors.text }}>{item.text}</Text>
          </View>
        </View>
      </View>
    );
  };

  const canSend = text.trim().length > 0 && !!client;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ paddingTop: insets.top + space.sm, paddingHorizontal: space.md, paddingBottom: space.sm, flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <Pressable
            testID="thread-back"
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={() => router.back()}
            hitSlop={8}
            style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" }}
          >
            <Icon ios="chevron.left" android="arrow_back" size={18} color={colors.text} />
          </Pressable>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ ...type.headline, color: colors.text }}>{detail?.thread.title ?? "Thread"}</Text>
            <Text numberOfLines={1} style={{ ...type.caption, color: colors.textMuted }}>
              {people.length ? people.join(", ") : "Just you"}
            </Text>
          </View>
          <DropdownMenu title="Tasks run in" options={projectOptions}>
            <View
              testID="thread-project"
              accessibilityRole="button"
              accessibilityLabel={`Project: ${project?.name ?? "No project"}. Change`}
              style={{ height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: colors.secondary, justifyContent: "center" }}
            >
              <Text numberOfLines={1} style={{ ...type.footnote, color: colors.text }}>{project?.name ?? "No project"}</Text>
            </View>
          </DropdownMenu>
        </View>

        {detail && !messages.length ? (
          <Text style={{ ...type.callout, color: colors.textMuted, padding: space.lg }}>
            Say something. Write @omg when you want omg to answer or start a task.
          </Text>
        ) : null}
        <FlatList
          ref={listRef}
          inverted
          style={{ flex: 1 }}
          data={newestFirst}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingVertical: space.md, gap: 6 }}
          keyboardDismissMode="interactive"
          // Inverted: the header is drawn at the bottom, after the newest
          // message, which is where a question waiting on you belongs.
          ListHeaderComponent={
            asks.length || error ? (
              <View style={{ gap: space.sm, paddingTop: space.md }}>
                {asks.map((q) => (
                  <QuestionCard
                    key={q.id}
                    question={q.question}
                    options={(q.options ?? []).map((label, index) => ({ index, label }))}
                    onAnswer={(label) => void answer(q, label)}
                  />
                ))}
                {error ? <Text style={{ ...type.footnote, color: colors.danger }}>{error}</Text> : null}
              </View>
            ) : undefined
          }
        />

        <View style={{ paddingHorizontal: space.md, paddingBottom: Math.max(insets.bottom, space.md), paddingTop: space.sm }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-end",
              gap: space.sm,
              borderRadius: radius.xl + 6,
              borderWidth: isDark ? 1 : 0,
              borderColor: colors.borderStrong,
              backgroundColor: colors.card,
              paddingLeft: 18,
              paddingRight: 6,
              paddingVertical: 6,
            }}
          >
            <TextInput
              testID="thread-input"
              multiline
              value={text}
              onChangeText={setText}
              placeholder="Message, or @omg to ask omg"
              placeholderTextColor={colors.textMuted}
              style={{ flex: 1, minHeight: 36, maxHeight: 140, paddingVertical: 8, fontSize: 17, color: colors.text }}
            />
            <Pressable
              testID="thread-send"
              accessibilityRole="button"
              accessibilityLabel="Send"
              disabled={!canSend}
              onPress={() => void send()}
              style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: canSend ? colors.text : colors.secondary }}
            >
              <Icon ios="arrow.up" android="arrow_upward" size={16} weight="semibold" color={canSend ? colors.background : colors.textMuted} />
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
