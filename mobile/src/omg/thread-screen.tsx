import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Alert, AppState, Keyboard, Modal, Pressable, View } from "react-native";
import { useFocusEffect, useRouter, type Href } from "expo-router";
import * as Haptics from "expo-haptics";
import Reanimated, { useAnimatedKeyboard, useAnimatedStyle } from "react-native-reanimated";
import type { MenuOption } from "./menu";
import { useOmg } from "./provider";
import { TaskCard } from "./task-card";
import { ChatHeaderBar } from "./chat-header";
import { COMPOSER_FADE_HEIGHT, EdgeFade } from "./edge-fade";
import { GroupAvatar, ThreadAvatar, ThreadDetailsSheet, ThreadPeopleContext, ThreadTasksContext, useAuthorName } from "./thread-details";
import { Markdown, MarkdownMentionContext } from "./markdown";
import { ThreadMediaList } from "./thread-media";
import { Text } from "./text";
import { useTheme } from "./theme";
import {
  cardMessageIds,
  linkMentions,
  mentionAgents,
  sameSession,
  taskCardFor,
  threadMentionOptions,
  typingPinger,
} from "./thread-tasks";
import {
  getThread,
  sendThreadMessage,
  sendThreadTyping,
  updateThread,
  type ThreadAttachment,
  type ThreadAuthor,
  type ThreadDetail,
  type ThreadMessage,
} from "./threads";
import type { AskQuestion } from "../../app/session/[id]";

/**
 * THE THREAD'S TWO PAGES SHARE ONE OWNER. The thread (app/thread/[id]) and a
 * message's replies (app/thread/[id]/replies/[root]) are separate pages on
 * the stack, as a reply thread is in Slack's app: pushed, with the back swipe,
 * not a sheet over the thread (2026-09-29). Everything they have in common
 * lives here: loading and polling, sending, the task questions, what `@`
 * offers, the thread's menu and details, the header, and how a message and a
 * task are drawn.
 */

/** The replies page of one message. */
export function repliesHref(threadId: string, rootId: string): Href {
  return `/thread/${threadId}/replies/${rootId}` as Href;
}

const POLL_MS = 3_000;
const ASK_POLL_MS = 5_000;
const OMG_ORANGE = "#FF5530";
const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

export type ThreadState = ReturnType<typeof useThreadState>;

/** One thread, loaded and kept current while its page is in front. */
export function useThreadState(id: string | undefined) {
  const router = useRouter();
  const { client, repos, agents } = useOmg();
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [pending, setPending] = useState<ThreadMessage[]>([]);
  const [asks, setAsks] = useState<AskQuestion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

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

  // Only the page in front polls: the thread behind a replies page rests.
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

  /** Post a message; with `replyTo`, into that message's replies. Returns the stored message. */
  const post = useCallback(
    async (body: string, replyTo: string | null, attachments: ThreadAttachment[] = []): Promise<ThreadMessage | null> => {
      if (!client || !id) return null;
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
        // The stored copy replaces the local one once it is loaded.
        await load();
        setPending((rows) => rows.filter((row) => row.id !== local.id));
        return message;
      } catch (e) {
        setPending((rows) => rows.filter((row) => row.id !== local.id));
        setError(e instanceof Error ? e.message : String(e));
        throw e;
      }
    },
    [client, id, detail?.me, load],
  );

  const messages = useMemo(() => [...(detail?.messages ?? []), ...pending], [detail?.messages, pending]);
  const cards = useMemo(() => cardMessageIds(messages), [messages]);
  const openAskIds = asks.map((q) => q.sessionId);

  /** Typing, said where it happens: the main list (null) or one message's replies. */
  const typingFor = useCallback(
    (rootId: string | null) => typingPinger((on) => void (client && id && sendThreadTyping(client, id, on, rootId))),
    [client, id],
  );

  // What `@` offers: omg, this machine's coding agents, and the people.
  const mentionOptions = useMemo(
    () => threadMentionOptions(agents, detail?.participants, detail?.me, detail?.people),
    [agents, detail?.participants, detail?.me, detail?.people],
  );

  const project = detail?.thread.project ?? null;
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
          void updateThread(client, id, { archived: true }).then(() => router.dismissTo("/"));
        },
      },
    ]);
  };
  // The thread's verbs, in the same overflow menu a session has.
  const menuOptions: MenuOption[] = [
    { label: "Thread details", icon: "info.circle", onPress: () => setDetailsOpen(true) },
    { label: `Project: ${project?.name ?? "None"}`, icon: "folder", submenu: projectOptions },
    { label: "Rename", icon: "pencil", onPress: rename },
    { label: "Archive thread", icon: "archivebox", destructive: true, onPress: archive },
  ];

  return {
    id,
    detail,
    messages,
    cards,
    asks,
    openAskIds,
    error,
    answer,
    post,
    typingFor,
    mentionOptions,
    menuOptions,
    projectOptions,
    rename,
    archive,
    detailsOpen,
    setDetailsOpen,
  };
}

/**
 * The providers every thread page needs (people, tasks, what a tapped
 * @mention does), the details sheet, and the page itself.
 */
export function ThreadPage({ state, children }: { state: ThreadState; children: ReactNode }) {
  const router = useRouter();
  const { detail, detailsOpen, setDetailsOpen } = state;
  const openMembers = useCallback(() => setDetailsOpen(true), [setDetailsOpen]);
  return (
    <MarkdownMentionContext.Provider value={openMembers}>
      <ThreadPeopleContext.Provider value={detail?.participants}>
        <ThreadTasksContext.Provider value={detail?.tasks}>
          {children}
          <Modal visible={detailsOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDetailsOpen(false)}>
            <ThreadDetailsSheet
              detail={detail}
              projectOptions={state.projectOptions}
              onClose={() => setDetailsOpen(false)}
              onOpenTask={(sessionId) => {
                setDetailsOpen(false);
                router.push(`/session/${sessionId}`);
              }}
              onRename={state.rename}
              onArchive={state.archive}
            />
          </Modal>
        </ThreadTasksContext.Provider>
      </ThreadPeopleContext.Provider>
    </MarkdownMentionContext.Provider>
  );
}

/** The chat page's bar, for a thread: the group, a title, a subtitle, and the thread's menu. */
export function ThreadHeader({
  state,
  title,
  subtitle,
  onBack,
}: {
  state: ThreadState;
  title: string;
  subtitle: string;
  onBack: () => void;
}) {
  const { colors, type } = useTheme();
  const humans = (state.detail?.participants ?? []).filter((row) => row.kind === "human");
  return (
    <ChatHeaderBar onBack={onBack} menuOptions={state.menuOptions} menuLabel="Thread actions">
      <GroupAvatar authors={humans} />
      <Pressable
        testID="thread-title"
        accessibilityRole="button"
        accessibilityHint="Opens the thread details"
        onPress={() => state.setDetailsOpen(true)}
        style={{ flex: 1, minWidth: 0 }}
      >
        <Text numberOfLines={1} style={{ ...type.subhead, fontWeight: "600", color: colors.text }}>
          {title}
        </Text>
        <Text numberOfLines={1} style={{ ...type.caption, color: colors.textSecondary }}>
          {subtitle}
        </Text>
      </Pressable>
    </ChatHeaderBar>
  );
}

function AuthorName({ author, color }: { author: ThreadAuthor; color: string }) {
  const { type } = useTheme();
  return <Text style={{ ...type.headline, fontWeight: "700", color }}>{useAuthorName(author)}</Text>;
}

/** One message, as Slack lays it out: face, name and time on the first of a run. */
export function MessageRow({ message, first, children }: { message: ThreadMessage; first: boolean; children?: ReactNode }) {
  const { colors, type } = useTheme();
  const people = useContext(ThreadPeopleContext);
  const { agents } = useOmg();
  const handles = useMemo(() => mentionAgents(agents).map((row) => row.handle), [agents]);
  return (
    <View style={{ flexDirection: "row", gap: 10, paddingTop: first ? 12 : 2 }}>
      <View style={{ width: 36 }}>{first ? <ThreadAvatar author={message.author} message={message} /> : null}</View>
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

/** The task a message started, as a compact attachment under it. Tap opens the task. */
export function MessageTask({ state, message }: { state: ThreadState; message: ThreadMessage }) {
  const router = useRouter();
  const { space } = useTheme();
  const c = state.cards.has(message.id) && state.detail ? taskCardFor(message, state.detail, state.messages, state.openAskIds) : null;
  if (!c) return null;
  return (
    <View style={{ paddingTop: space.sm }}>
      <TaskCard {...c} onOpen={() => router.push(`/session/${c.sessionId}`)} />
    </View>
  );
}

/**
 * THE BAR FLOATS OVER THE LIST, as the session chat's does: the list runs the
 * page's full height and scrolls under the glass, dissolving into the page
 * through a fade, instead of stopping at a hard edge above a bar in the flow.
 * It rides the keyboard's real frame; the list pads its end by the bar and
 * the keyboard (useKeyboardHeight) so the last message can scroll clear.
 */
export function FloatingChatBar({
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

/** The keyboard's height while it is up, for a list that pads under a floating bar. */
export function useKeyboardHeight(): number {
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
