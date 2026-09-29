import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Alert, AppState, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View, type ScrollViewInstance } from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import Reanimated, { useAnimatedKeyboard, useAnimatedStyle } from "react-native-reanimated";
import { Icon } from "../../src/components";
import type { MenuOption } from "../../src/omg/menu";
import { useOmg } from "../../src/omg/provider";
import { TaskCard } from "../../src/omg/task-card";
import { ChatHeaderBar, chatHeaderHeight } from "../../src/omg/chat-header";
import { COMPOSER_FADE_HEIGHT, EdgeFade } from "../../src/omg/edge-fade";
import { GroupAvatar, ThreadAvatar, ThreadDetailsSheet, ThreadPeopleContext, useAuthorName } from "../../src/omg/thread-details";
import { ThreadChatBar, TypingIndicator } from "../../src/omg/chat-bar";
import { Markdown, MarkdownMentionContext } from "../../src/omg/markdown";
import { ThreadMediaList } from "../../src/omg/thread-media";
import { Text } from "../../src/omg/text";
import { useTheme } from "../../src/omg/theme";
import {
  cardMessageIds,
  mentionsOmg,
  replySummary,
  repliesTo,
  sameSession,
  startsMessageGroup,
  TASK_STATE_LABEL,
  taskCardFor,
  topLevelMessages,
  linkMentions,
  mentionAgents,
  threadMentionOptions,
  typingIn,
  typingLabel,
  typingPinger,
} from "../../src/omg/thread-tasks";
import {
  getThread,
  sendThreadMessage,
  sendThreadTyping,
  updateThread,
  type ThreadAuthor,
  type ThreadDetail,
  type ThreadAttachment,
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

const Avatar = ThreadAvatar;

function AuthorName({ author, color }: { author: ThreadAuthor; color: string }) {
  const { type } = useTheme();
  return <Text style={{ ...type.headline, fontWeight: "700", color }}>{useAuthorName(author)}</Text>;
}

/**
 * THE REPLIES BAR FLOATS OVER THE REPLIES, as the session chat's does: the
 * replies run the sheet's full height and scroll under the glass, dissolving
 * into the page through a fade, instead of stopping at a hard edge above a
 * bar in the flow (2026-09-29).
 *
 * It rides the keyboard's real frame, not KeyboardAvoidingView: that measures
 * against its parent, and a page sheet starts below the top of the screen,
 * so it lifted the bar short and the keyboard covered the bar's action row.
 * The keyboard frame is in screen terms and the sheet ends at the screen's
 * bottom, so a lift by the keyboard's height is exact. The list pads its end
 * by the bar and the keyboard (`useFloatingBarInset`) so the last reply can
 * scroll clear of both.
 */
function FloatingChatBar({
  rest,
  gap,
  onHeight,
  children,
}: {
  rest: number;
  gap: number;
  onHeight: (height: number) => void;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const keyboard = useAnimatedKeyboard();
  const lift = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, keyboard.height.value + gap - rest) }],
  }));
  const [height, setHeight] = useState(0);
  return (
    <>
      <Reanimated.View
        pointerEvents="none"
        style={[{ position: "absolute", left: 0, right: 0, bottom: 0, height: height + COMPOSER_FADE_HEIGHT }, lift]}
      >
        <EdgeFade edge="bottom" color={colors.background} style={{ flex: 1 }} />
      </Reanimated.View>
      <Reanimated.View
        onLayout={(event) => {
          setHeight(event.nativeEvent.layout.height);
          onHeight(event.nativeEvent.layout.height);
        }}
        style={[{ position: "absolute", left: 0, right: 0, bottom: 0, paddingBottom: rest }, lift]}
      >
        {children}
      </Reanimated.View>
    </>
  );
}

/** How far the list must pad its end to clear a floating bar and the keyboard. */
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardWillShow", (event) => setHeight(event.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener("keyboardWillHide", () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

function MessageRow({ message, first, children }: { message: ThreadMessage; first: boolean; children?: ReactNode }) {
  const { colors, type } = useTheme();
  const people = useContext(ThreadPeopleContext);
  const { agents } = useOmg();
  const handles = useMemo(() => mentionAgents(agents).map((row) => row.handle), [agents]);
  return (
    <View style={{ flexDirection: "row", gap: 10, paddingTop: first ? 12 : 2 }}>
      <View style={{ width: 36 }}>{first ? <Avatar author={message.author} /> : null}</View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        {first ? (
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
            <AuthorName author={message.author} color={message.author.kind === "omg" ? OMG_ORANGE : colors.text} />
            <Text style={{ ...type.caption, color: colors.textMuted }}>{TIME.format(message.ts)}</Text>
          </View>
        ) : null}
        {/* Formatted as the session chat formats a message: the same renderer. */}
        {message.text ? (
          <View style={{ opacity: message.pending ? 0.6 : 1 }}>
            <Markdown text={linkMentions(message.text, people, handles)} />
          </View>
        ) : null}
        <ThreadMediaList media={message.media} />
        {children}
      </View>
    </View>
  );
}

export default function ThreadScreen() {
  // `replies` comes from a push: open that message's replies on arrival.
  const { id, replies: repliesParam } = useLocalSearchParams<{ id: string; replies?: string }>();
  const router = useRouter();
  const { client, repos } = useOmg();
  const { colors, type, space } = useTheme();
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [pending, setPending] = useState<ThreadMessage[]>([]);
  const [asks, setAsks] = useState<AskQuestion[]>([]);
  const [openRoot, setOpenRoot] = useState<string | null>(repliesParam || null);
  // A tapped @mention shows who is in the thread, omg included.
  const openMembers = useCallback(() => setDetailsOpen(true), []);
  // The replies sheet reads bottom-up, like the chat: newest reply in view.
  const repliesScroll = useRef<ScrollViewInstance>(null);
  const repliesPinned = useRef(true);
  const repliesShown = useRef(false);
  const [replyBarHeight, setReplyBarHeight] = useState(0);
  const keyboardHeight = useKeyboardHeight();
  useEffect(() => {
    repliesPinned.current = true;
    repliesShown.current = false;
  }, [openRoot]);
  const [detailsOpen, setDetailsOpen] = useState(false);
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
    async (body: string, replyTo: string | null, attachments: ThreadAttachment[] = []) => {
      if (!client || !id) return;
      const local: ThreadMessage = {
        id: `local-${Date.now()}`,
        threadId: id,
        ts: Date.now(),
        author: { kind: "human", participantId: detail?.me ?? "", name: "You" },
        // Media shows once stored: until then its path is on the phone, not the machine.
        text: body || `Sending ${attachments.length === 1 ? "a file" : `${attachments.length} files`}…`,
        pending: true,
        replyTo,
      };
      setPending((rows) => [...rows, local]);
      try {
        const message = await sendThreadMessage(client, id, body, replyTo, attachments);
        // Asking omg at the top level opens the replies it will answer in.
        if (!replyTo && mentionsOmg(body)) {
          setRootHint(message);
          setOpenRoot(message.id);
        }
        // The stored copy replaces the local one once it is loaded.
        await load();
        setPending((rows) => rows.filter((row) => row.id !== local.id));
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
  // Typing: one pinger per field, so the main list and the replies each say where you write.
  const mainTyping = useMemo(
    () => typingPinger((on) => void (client && sendThreadTyping(client, id, on, null))),
    [client, id],
  );
  const replyTyping = useMemo(
    () => typingPinger((on) => void (client && openRoot && sendThreadTyping(client, id, on, openRoot))),
    [client, id, openRoot],
  );
  // What `@` offers here: omg, this machine's coding agents, and the other people.
  const { agents: codingAgents } = useOmg();
  const mentionOptions = useMemo(
    () => threadMentionOptions(codingAgents, detail?.participants, detail?.me, detail?.people),
    [codingAgents, detail?.participants, detail?.me, detail?.people],
  );
  const mainTypingLabel = typingLabel(typingIn(detail?.typing, null), detail?.participants);
  const people = (detail?.participants ?? [])
    .filter((row) => row.kind === "human")
    .map((row) => row.display.name?.trim() || row.display.fallback);
  const root = openRoot ? messages.find((m) => m.id === openRoot) ?? (rootHint?.id === openRoot ? rootHint : null) : null;
  // The sheet keeps drawing its thread while it slides away. Emptied on close,
  // it would slide down as a blank white page.
  const [shownRoot, setShownRoot] = useState<ThreadMessage | null>(root);
  if (root && root !== shownRoot) setShownRoot(root);
  const sheetRoot = root ?? shownRoot;
  const replies = useMemo(() => (sheetRoot ? repliesTo(messages, sheetRoot.id) : []), [messages, sheetRoot]);

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

  const humans = (detail?.participants ?? []).filter((row) => row.kind === "human");
  const rename = () => {
    if (!client || !id) return;
    Alert.prompt("Rename thread", undefined, (title) => {
      if (title?.trim()) void updateThread(client, id, { title: title.trim() }).then(load);
    }, "plain-text", detail?.thread.title ?? "");
  };
  const archive = () => {
    if (!client || !id) return;
    Alert.alert("Archive this thread?", "It leaves your list. Its tasks keep running.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Archive",
        style: "destructive",
        onPress: () => {
          setDetailsOpen(false);
          void updateThread(client, id, { archived: true }).then(() => router.back());
        },
      },
    ]);
  };
  // The thread's verbs, in the same overflow menu a session has. The project
  // lives here now, not as a chip in the bar.
  const menuOptions: MenuOption[] = [
    { label: "Thread details", icon: "info.circle", onPress: () => setDetailsOpen(true) },
    { label: `Project: ${project?.name ?? "None"}`, icon: "folder", submenu: projectOptions },
    { label: "Rename", icon: "pencil", onPress: rename },
    { label: "Archive thread", icon: "archivebox", destructive: true, onPress: archive },
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

  const detailsModal = (
    <Modal visible={detailsOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDetailsOpen(false)}>
      <ThreadDetailsSheet
        detail={detail}
        projectOptions={projectOptions}
        onClose={() => setDetailsOpen(false)}
        onOpenTask={(sessionId) => {
          setDetailsOpen(false);
          setOpenRoot(null);
          router.push(`/session/${sessionId}`);
        }}
        onRename={rename}
        onArchive={archive}
      />
    </Modal>
  );

  return (
    <MarkdownMentionContext.Provider value={openMembers}>
    <ThreadPeopleContext.Provider value={detail?.participants}>
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={{ flex: 1, paddingTop: chatHeaderHeight(insets.top) }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >


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

        <View style={{ paddingBottom: Math.max(insets.bottom, space.md) }}>
          <TypingIndicator testID="thread-typing" label={mainTypingLabel} />
          <ThreadChatBar testID="thread-input" placeholder={`Message ${detail?.thread.title ?? "the thread"}`} onSend={(body, files) => post(body, null, files)} onTyping={mainTyping} mentions={mentionOptions} />
        </View>
      </KeyboardAvoidingView>

      <ChatHeaderBar onBack={() => router.back()} menuOptions={menuOptions} menuLabel="Thread actions">
        <GroupAvatar authors={humans} />
        <Pressable
          testID="thread-title"
          accessibilityRole="button"
          accessibilityHint="Opens the thread details"
          onPress={() => setDetailsOpen(true)}
          style={{ flex: 1, minWidth: 0 }}
        >
          <Text numberOfLines={1} style={{ ...type.subhead, fontWeight: "600", color: colors.text }}>
            {detail?.thread.title ?? "Thread"}
          </Text>
          <Text numberOfLines={1} style={{ ...type.caption, color: colors.textSecondary }}>
            {people.length ? people.join(", ") : "Just you"}
          </Text>
        </Pressable>
      </ChatHeaderBar>

      {/* Over the replies when they are open: iOS presents a sheet only from the one on top. */}
      {root ? null : detailsModal}

      <Modal visible={!!root} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpenRoot(null)}>
        {sheetRoot ? (
          <View testID="thread-replies" style={{ flex: 1, backgroundColor: colors.background }}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: 0.5, borderBottomColor: colors.border }}>
                <Text style={{ ...type.headline, flex: 1, color: colors.text }}>Replies</Text>
                <Pressable testID="thread-replies-close" accessibilityRole="button" accessibilityLabel="Close replies" onPress={() => setOpenRoot(null)} hitSlop={10}>
                  <Icon ios="xmark" android="close" size={16} color={colors.text} />
                </Pressable>
              </View>
              <ScrollView
                ref={repliesScroll}
                style={{ flex: 1 }}
                // The bar floats over the end of the list: pad by it and the keyboard.
                contentContainerStyle={{
                  paddingHorizontal: space.lg,
                  paddingBottom:
                    replyBarHeight + Math.max(0, keyboardHeight + space.sm - Math.max(insets.bottom, space.md)) + space.lg,
                }}
                // Opens on the newest reply, and stays there as replies arrive or the
                // keyboard takes room, unless you scrolled up to read.
                onContentSizeChange={() => {
                  if (repliesPinned.current) repliesScroll.current?.scrollToEnd({ animated: repliesShown.current });
                  repliesShown.current = true;
                }}
                onLayout={() => {
                  if (repliesPinned.current) repliesScroll.current?.scrollToEnd({ animated: false });
                }}
                onScroll={(event) => {
                  const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
                  repliesPinned.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 40;
                }}
                scrollEventThrottle={64}
              >
                <MessageRow message={sheetRoot} first>
                  {card(sheetRoot)}
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
              <FloatingChatBar rest={Math.max(insets.bottom, space.md)} gap={space.sm} onHeight={setReplyBarHeight}>
                <TypingIndicator testID="thread-reply-typing" label={root ? typingLabel(typingIn(detail?.typing, root.id), detail?.participants) : null} />
                <ThreadChatBar testID="thread-reply-input" placeholder="Reply…" onSend={(body, files) => post(body, sheetRoot.id, files)} onTyping={replyTyping} mentions={mentionOptions} />
              </FloatingChatBar>
            </View>
            {detailsModal}
          </View>
        ) : null}
      </Modal>
    </View>
    </ThreadPeopleContext.Provider>
    </MarkdownMentionContext.Provider>
  );
}
