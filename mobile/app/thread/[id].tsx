import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { Icon } from "../../src/components";
import { DropdownMenu, type MenuOption } from "../../src/omg/menu";
import { useOmg } from "../../src/omg/provider";
import { TaskCard } from "../../src/omg/task-card";
import { Text } from "../../src/omg/text";
import { useTheme } from "../../src/omg/theme";
import {
  authorHue,
  authorName,
  cardMessageIds,
  mentionsOmg,
  replySummary,
  repliesTo,
  sameSession,
  startsMessageGroup,
  TASK_STATE_LABEL,
  taskCardFor,
  topLevelMessages,
} from "../../src/omg/thread-tasks";
import {
  getThread,
  sendThreadMessage,
  updateThread,
  type ThreadAuthor,
  type ThreadDetail,
  type ThreadMessage,
} from "../../src/omg/threads";
import { QuestionCard, type AskQuestion } from "../session/[id]";

/**
 * A THREAD, LAID OUT LIKE SLACK. No agent runs behind it, so this is not the
 * session screen: no agent face, no model line, no tool rows. Every message
 * sits on the left under its author's avatar, name and time. omg speaks only
 * when someone writes `@omg`, and always in the REPLIES of that message; the
 * main list shows "N replies" with the task's state, and the replies open as
 * a sheet with the task card, its question, and a reply box.
 */

const POLL_MS = 3_000;
const ASK_POLL_MS = 5_000;
const OMG_ORANGE = "#FF5530";
const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function Avatar({ author, size = 36 }: { author: ThreadAuthor; size?: number }) {
  const omg = author.kind === "omg";
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 4.5,
        backgroundColor: omg ? OMG_ORANGE : `hsl(${authorHue(author)}, 45%, 45%)`,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: omg ? size / 3.2 : size / 2.4 }}>
        {omg ? (size < 28 ? "o" : "omg") : authorName(author).slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

function MessageRow({ message, first, children }: { message: ThreadMessage; first: boolean; children?: ReactNode }) {
  const { colors, type } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 10, paddingTop: first ? 12 : 2 }}>
      <View style={{ width: 36 }}>{first ? <Avatar author={message.author} /> : null}</View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        {first ? (
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
            <Text style={{ ...type.headline, fontWeight: "700", color: message.author.kind === "omg" ? OMG_ORANGE : colors.text }}>
              {authorName(message.author)}
            </Text>
            <Text style={{ ...type.caption, color: colors.textMuted }}>{TIME.format(message.ts)}</Text>
          </View>
        ) : null}
        <Text style={{ ...type.body, lineHeight: 22, color: colors.text, opacity: message.pending ? 0.6 : 1 }}>{message.text}</Text>
        {children}
      </View>
    </View>
  );
}

function Composer({
  placeholder,
  onSend,
  testID,
  autoFocus,
}: {
  placeholder: string;
  onSend: (text: string) => Promise<void>;
  testID: string;
  autoFocus?: boolean;
}) {
  const { colors, space, radius, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState("");
  const canSend = text.trim().length > 0;
  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText("");
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await onSend(body);
    } catch {
      setText(body);
    }
  };
  return (
    <View style={{ paddingHorizontal: space.md, paddingBottom: Math.max(insets.bottom, space.md), paddingTop: space.sm }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: space.sm,
          borderRadius: radius.lg,
          borderWidth: isDark ? 1 : 0,
          borderColor: colors.borderStrong,
          backgroundColor: colors.card,
          paddingLeft: 14,
          paddingRight: 6,
          paddingVertical: 6,
        }}
      >
        <TextInput
          testID={testID}
          multiline
          autoFocus={autoFocus}
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          style={{ flex: 1, minHeight: 36, maxHeight: 140, paddingVertical: 8, fontSize: 17, color: colors.text }}
        />
        <Pressable
          testID={`${testID}-send`}
          accessibilityRole="button"
          accessibilityLabel="Send"
          disabled={!canSend}
          onPress={() => void send()}
          style={{ width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: canSend ? colors.text : colors.secondary }}
        >
          <Icon ios="arrow.up" android="arrow_upward" size={16} weight="semibold" color={canSend ? colors.background : colors.textMuted} />
        </Pressable>
      </View>
    </View>
  );
}

export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { client, repos } = useOmg();
  const { colors, type, space } = useTheme();
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [pending, setPending] = useState<ThreadMessage[]>([]);
  const [asks, setAsks] = useState<AskQuestion[]>([]);
  const [openRoot, setOpenRoot] = useState<string | null>(null);
  const [rootHint, setRootHint] = useState<ThreadMessage | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const post = useCallback(
    async (body: string, replyTo: string | null) => {
      if (!client || !id) return;
      const local: ThreadMessage = {
        id: `local-${Date.now()}`,
        threadId: id,
        ts: Date.now(),
        author: { kind: "human", participantId: detail?.me ?? "", name: "You" },
        text: body,
        pending: true,
        replyTo,
      };
      setPending((rows) => [...rows, local]);
      try {
        const message = await sendThreadMessage(client, id, body, replyTo);
        // Asking omg at the top level opens the replies it will answer in.
        if (!replyTo && mentionsOmg(body)) {
          setRootHint(message);
          setOpenRoot(message.id);
        }
        void load();
      } catch (e) {
        setPending((rows) => rows.filter((row) => row.id !== local.id));
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      }
    },
    [client, id, detail?.me, load],
  );

  const messages = useMemo(() => [...(detail?.messages ?? []), ...pending], [detail?.messages, pending]);
  const top = useMemo(() => topLevelMessages(messages), [messages]);
  const cards = useMemo(() => cardMessageIds(messages), [messages]);
  const openAskIds = asks.map((q) => q.sessionId);
  const project = detail?.thread.project ?? null;
  const people = (detail?.participants ?? [])
    .filter((row) => row.kind === "human")
    .map((row) => row.display.name?.trim() || row.display.fallback);
  const root = openRoot ? messages.find((m) => m.id === openRoot) ?? (rootHint?.id === openRoot ? rootHint : null) : null;
  const replies = useMemo(() => (openRoot ? repliesTo(messages, openRoot) : []), [messages, openRoot]);

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

  const card = (message: ThreadMessage) => {
    const c = cards.has(message.id) && detail ? taskCardFor(message, detail, messages, openAskIds) : null;
    return c ? (
      <View style={{ paddingTop: space.sm }}>
        <TaskCard {...c} onOpen={() => { setOpenRoot(null); router.push(`/session/${c.sessionId}`); }} />
      </View>
    ) : null;
  };

  const repliesLine = (message: ThreadMessage) => {
    const summary = replySummary(messages, message.id);
    if (!summary) return null;
    const started = summary.taskSessionId ? messages.find((m) => m.task?.sessionId === summary.taskSessionId && cards.has(m.id)) : null;
    const task = started && detail ? taskCardFor(started, detail, messages, openAskIds) : null;
    return (
      <Pressable
        testID="thread-replies-link"
        accessibilityRole="button"
        accessibilityLabel={`${summary.count} ${summary.count === 1 ? "reply" : "replies"}${task ? `, task ${TASK_STATE_LABEL[task.state]}` : ""}`}
        onPress={() => setOpenRoot(message.id)}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 6, opacity: pressed ? 0.6 : 1 })}
      >
        <View style={{ flexDirection: "row", gap: 2 }}>
          {summary.authors.slice(0, 3).map((author, index) => (
            <Avatar key={index} author={author} size={20} />
          ))}
        </View>
        <Text style={{ ...type.subhead, fontWeight: "600", color: colors.primary }}>
          {summary.count} {summary.count === 1 ? "reply" : "replies"}
        </Text>
        {task ? (
          <Text style={{ ...type.footnote, fontWeight: "600", color: task.state === "needs-you" ? colors.warning : task.state === "done" ? colors.success : task.state === "working" ? colors.primary : colors.textMuted }}>
            · {TASK_STATE_LABEL[task.state]}
          </Text>
        ) : null}
      </Pressable>
    );
  };

  const newestFirst = useMemo(() => [...top].reverse(), [top]);
  const previousById = useMemo(() => {
    const map = new Map<string, ThreadMessage | undefined>();
    top.forEach((message, index) => map.set(message.id, top[index - 1]));
    return map;
  }, [top]);

  const replyAsks = asks.filter((q) => replies.some((reply) => reply.task && sameSession(reply.task.sessionId, q.sessionId)));

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ paddingTop: insets.top + space.sm, paddingHorizontal: space.md, paddingBottom: space.sm, flexDirection: "row", alignItems: "center", gap: space.sm, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
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

        {detail && !top.length ? (
          <Text style={{ ...type.callout, color: colors.textMuted, padding: space.lg }}>
            Say something. Write @omg when you want omg to answer or start a task.
          </Text>
        ) : null}
        <FlatList
          inverted
          style={{ flex: 1 }}
          data={newestFirst}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MessageRow message={item} first={startsMessageGroup(previousById.get(item.id), item)}>
              {card(item)}
              {repliesLine(item)}
            </MessageRow>
          )}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingVertical: space.md }}
          keyboardDismissMode="interactive"
          ListHeaderComponent={error ? <Text style={{ ...type.footnote, color: colors.danger, paddingTop: space.sm }}>{error}</Text> : undefined}
        />

        <Composer testID="thread-input" placeholder={`Message ${detail?.thread.title ?? "the thread"}`} onSend={(body) => post(body, null)} />
      </KeyboardAvoidingView>

      <Modal visible={!!root} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpenRoot(null)}>
        {root ? (
          <View testID="thread-replies" style={{ flex: 1, backgroundColor: colors.background }}>
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
              <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
                <Text style={{ ...type.headline, flex: 1, color: colors.text }}>Replies</Text>
                <Pressable testID="thread-replies-close" accessibilityRole="button" accessibilityLabel="Close replies" onPress={() => setOpenRoot(null)} hitSlop={10}>
                  <Icon ios="xmark" android="close" size={16} color={colors.text} />
                </Pressable>
              </View>
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.lg }}>
                <MessageRow message={root} first>
                  {card(root)}
                </MessageRow>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: space.md }}>
                  <Text style={{ ...type.caption, color: colors.textMuted }}>
                    {replies.length} {replies.length === 1 ? "reply" : "replies"}
                  </Text>
                  <View style={{ flex: 1, height: 0.5, backgroundColor: colors.border }} />
                </View>
                {replies.map((reply, index) => (
                  <MessageRow key={reply.id} message={reply} first={startsMessageGroup(replies[index - 1], reply)}>
                    {card(reply)}
                  </MessageRow>
                ))}
                {replyAsks.length ? (
                  <View style={{ gap: space.sm, paddingTop: space.md }}>
                    {replyAsks.map((q) => (
                      <QuestionCard
                        key={q.id}
                        question={q.question}
                        options={(q.options ?? []).map((label, index) => ({ index, label }))}
                        onAnswer={(label) => void answer(q, label)}
                      />
                    ))}
                  </View>
                ) : null}
              </ScrollView>
              <Composer testID="thread-reply-input" placeholder="Reply…" onSend={(body) => post(body, root.id)} />
            </KeyboardAvoidingView>
          </View>
        ) : null}
      </Modal>
    </View>
  );
}
