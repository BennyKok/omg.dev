import { useMemo, useRef, useState } from "react";
import { ScrollView, View, type ScrollViewInstance } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { chatHeaderHeight } from "../../../../src/omg/chat-header";
import { ThreadChatBar, TypingIndicator } from "../../../../src/omg/chat-bar";
import { Text } from "../../../../src/omg/text";
import { useTheme } from "../../../../src/omg/theme";
import {
  FloatingChatBar,
  MessageRow,
  MessageTask,
  ThreadHeader,
  ThreadPage,
  useKeyboardHeight,
  useThreadState,
} from "../../../../src/omg/thread-screen";
import { repliesTo, sameSession, startsMessageGroup, typingIn, typingLabel } from "../../../../src/omg/thread-tasks";
import { QuestionCard } from "../../../session/[id]";

/**
 * ONE MESSAGE'S REPLIES, AS THEIR OWN PAGE. Pushed on top of the thread, with
 * the chat page's bar and the back swipe, as a reply thread is in Slack. It
 * used to be a sheet over the thread (2026-09-29).
 *
 * It reads bottom-up, like a chat: it opens on the newest reply and follows
 * new ones unless you scrolled up to read. The bar floats over the replies
 * as the session chat's does.
 */
export default function RepliesScreen() {
  const { id, root: rootId } = useLocalSearchParams<{ id: string; root: string }>();
  const router = useRouter();
  const { colors, type, space } = useTheme();
  const insets = useSafeAreaInsets();
  const state = useThreadState(id);
  const { detail, messages, asks } = state;

  const root = messages.find((m) => m.id === rootId) ?? null;
  const replies = useMemo(() => (rootId ? repliesTo(messages, rootId) : []), [messages, rootId]);
  const replyAsks = asks.filter((q) => replies.some((reply) => reply.task && sameSession(reply.task.sessionId, q.sessionId)));
  const typing = useMemo(() => state.typingFor(rootId ?? null), [state.typingFor, rootId]);

  const scroll = useRef<ScrollViewInstance>(null);
  const pinned = useRef(true);
  const shown = useRef(false);
  const [barHeight, setBarHeight] = useState(0);
  const keyboardHeight = useKeyboardHeight();
  const rest = Math.max(insets.bottom, space.md);

  // Opened from a notification with nothing under it: back goes to the thread.
  const back = () => {
    if (router.canGoBack()) router.back();
    else if (id) router.replace(`/thread/${id}`);
  };

  return (
    <ThreadPage state={state}>
      <View testID="thread-replies" style={{ flex: 1, backgroundColor: colors.background }}>
        <Stack.Screen options={{ headerShown: false }} />
        <ScrollView
          ref={scroll}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingTop: chatHeaderHeight(insets.top) + space.sm,
            paddingHorizontal: space.lg,
            // The bar floats over the end of the list: pad by it and the keyboard.
            paddingBottom: barHeight + Math.max(0, keyboardHeight + space.sm - rest) + space.lg,
          }}
          keyboardDismissMode="interactive"
          onContentSizeChange={() => {
            if (pinned.current) scroll.current?.scrollToEnd({ animated: shown.current });
            shown.current = true;
          }}
          onLayout={() => {
            if (pinned.current) scroll.current?.scrollToEnd({ animated: false });
          }}
          onScroll={(event) => {
            const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
            pinned.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 40;
          }}
          scrollEventThrottle={64}
        >
          {root ? (
            <MessageRow message={root} first>
              <MessageTask state={state} message={root} />
            </MessageRow>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: space.md }}>
            <Text style={{ ...type.caption, color: colors.textMuted }}>
              {replies.length} {replies.length === 1 ? "reply" : "replies"}
            </Text>
            <View style={{ flex: 1, height: 0.5, backgroundColor: colors.border }} />
          </View>
          {replies.map((reply, index) => (
            <MessageRow key={reply.id} message={reply} first={startsMessageGroup(replies[index - 1], reply)}>
              <MessageTask state={state} message={reply} />
            </MessageRow>
          ))}
          {replyAsks.length ? (
            <View style={{ gap: space.sm, paddingTop: space.md }}>
              {replyAsks.map((q) => (
                <QuestionCard
                  key={q.id}
                  question={q.question}
                  options={(q.options ?? []).map((label, index) => ({ index, label }))}
                  onAnswer={(label) => void state.answer(q, label)}
                />
              ))}
            </View>
          ) : null}
          {state.error ? <Text style={{ ...type.footnote, color: colors.danger, paddingTop: space.sm }}>{state.error}</Text> : null}
        </ScrollView>

        <FloatingChatBar rest={rest} gap={space.sm} onHeight={setBarHeight}>
          <TypingIndicator testID="thread-reply-typing" label={rootId ? typingLabel(typingIn(detail?.typing, rootId), detail?.participants) : null} />
          <ThreadChatBar
            testID="thread-reply-input"
            placeholder="Reply…"
            onSend={async (body, files) => {
              if (rootId) await state.post(body, rootId, files);
            }}
            onTyping={typing}
            mentions={state.mentionOptions}
          />
        </FloatingChatBar>

        <ThreadHeader state={state} title="Replies" subtitle={detail?.thread.title ?? "Thread"} onBack={back} />
      </View>
    </ThreadPage>
  );
}
