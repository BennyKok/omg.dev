/**
 * A session: the transcript, and the composer.
 *
 * All the hard live-stream work belongs to @omg-dev/client, not to this file.
 * `live.subscribeTranscript` owns the socket, the reconnect backoff, the resume
 * cursor and the multiplexing, and hands back a small event union. The
 * prototype hand-rolled its own WebSocket with a fixed 1500ms retry and no
 * resume; using the SDK instead means this screen gets the same semantics the
 * web surface has, and keeps getting them when the protocol moves.
 *
 * Streaming detail worth knowing: an in-flight assistant turn arrives as
 * `ai_part` deltas, NOT as messages. They accumulate into a synthetic trailing
 * element which is replaced the moment the real `message` lands — otherwise
 * the finished turn renders twice.
 *
 * Layout mirrors the web Computer session view: only the USER's message is a
 * card (with a copy affordance underneath); the assistant's reply is plain
 * text on the page background.
 *
 * How a message becomes a row is NOT this file's problem — src/omg/transcript
 * owns that, one renderer per message kind, and `buildTranscriptItems` is what
 * turns the flat message array into what the list draws. This screen is the
 * live stream and the composer.
 *
 * Every glyph on this screen is an SF Symbol via `Icon`/`IconButton`. It used
 * to draw its own chevrons, paperclip, mic and pause out of rotated Views —
 * ~190 lines of geometry that could never match the system's optical weights,
 * and looked hand-made next to any real iOS app. The overflow menu is a real
 * UIAlertController (`ActionSheetIOS`) rather than an in-app popover.
 *
 * The bar is the system's, not ours. It used to be drawn in-screen because
 * KeyboardAvoidingView measures against its PARENT, so a native header would
 * have needed its height fed back as `keyboardVerticalOffset`, and
 * `useHeaderHeight` lives in @react-navigation/elements, which this app does
 * not depend on. Moving the keyboard to `useAnimatedKeyboard` removed that
 * constraint — the lift is driven by the real keyboard frame and does not
 * care what sits above it — so this screen now gets a real UINavigationBar:
 * the system back chevron and edge-swipe come free, the title truncates the
 * way UIKit truncates, and the bar grows its own hairline once the transcript
 * scrolls under it. The avatar stays in the title (small, beside the text)
 * because it is the only place the agent's identity appears on this screen,
 * and Messages puts the participant's face in exactly that spot. No large
 * title: a session title is a long prompt, not a section name, and the
 * transcript is what should dominate the screen.
 */

import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import Reanimated, { useAnimatedKeyboard, useAnimatedStyle } from "react-native-reanimated";
import { Text, TextInput } from "../../src/omg/text";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { OmgSession, OmgSessionPrompt } from "@omg-dev/protocol";

import { AgentAvatar, Icon, IconButton } from "../../src/components";
import { agentLabel as agentDisplayName } from "../../src/omg/agent-icons";
import { showActionMenu, type MenuAction } from "../../src/omg/native-menu";
import { useOmg } from "../../src/omg/provider";
import { GlassSurface, LIQUID_GLASS } from "../../src/omg/glass";
import { useTheme } from "../../src/omg/theme";
import { useToast } from "../../src/omg/toast";
import {
  buildTranscriptItems,
  TranscriptRow,
  type Entry,
  type TranscriptItem,
} from "../../src/omg/transcript";

/** Local id for the optimistic message, so it can be rolled back precisely. */
let localSeq = 0;

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, type, space, radius } = useTheme();
  const { client } = useOmg();

  const [messages, setMessages] = useState<Entry[]>([]);
  const [streamText, setStreamText] = useState("");
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<OmgSessionPrompt | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => {
    if (error) toast.show(error, { intent: "error" });
  }, [error, toast]);
  const [loading, setLoading] = useState(true);
  const [sessionInfo, setSessionInfo] = useState<{ title: string; agent: string } | null>(null);

  const listRef = useRef<FlatList<TranscriptItem>>(null);
  /** Pinned-to-bottom is the default; reading history unpins it. */
  const atBottomRef = useRef(true);

  const firstUserText = messages.find((m) => m.role === "user" && m.text)?.text?.trim();
  const title = sessionInfo?.title ?? firstUserText ?? "Session";
  const agentLabel = sessionInfo?.agent ?? "omg";

  // Header facts (title, agent) come from the session list, not the
  // transcript. peekSessions paints a cached answer instantly; listSessions
  // refreshes it from the machine.
  useEffect(() => {
    let cancelled = false;
    if (!client || !id) return;
    const apply = (list: OmgSession[] | null) => {
      if (cancelled || !list) return;
      const found = list.find((s) => s.sessionId === id || s.nativeSessionId === id);
      if (!found) return;
      setSessionInfo({
        title: found.title?.trim() || found.lastUserText?.trim() || "Session",
        agent: found.agent?.trim() || found.agentLabel?.trim() || "omg",
      });
    };
    apply(client.peekSessions());
    client.listSessions().then(apply).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client, id]);

  // Seed from REST, then let the socket take over. The socket also sends a
  // snapshot, but the REST read paints something immediately instead of waiting
  // on a connection that may still be waking.
  useEffect(() => {
    let cancelled = false;
    if (!client || !id) return;
    setLoading(true);
    client
      .getMessages(id, 80)
      .then((res) => {
        if (cancelled) return;
        setMessages(res.messages ?? []);
        setError(null);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, id]);

  useEffect(() => {
    if (!client || !id) return;
    return client.live.subscribeTranscript(id, (event) => {
      switch (event.type) {
        case "snapshot":
          setMessages(event.messages ?? []);
          break;
        case "message":
          setMessages((prev) => {
            // Drop the optimistic copy this message confirms, and de-dupe on id.
            const withoutPending = prev.filter(
              (m) => !(m.pending && m.text === event.message.text),
            );
            if (event.message.id && withoutPending.some((m) => m.id === event.message.id)) {
              return withoutPending.map((m) => (m.id === event.message.id ? event.message : m));
            }
            return [...withoutPending, event.message];
          });
          // A completed message supersedes whatever was streaming.
          setStreamText("");
          break;
        case "ai_part":
          if (event.part.type === "text-start" || event.part.reset) {
            setStreamText(event.part.text ?? "");
          } else if (event.part.type === "text-delta") {
            setStreamText((prev) => prev + (event.part.delta ?? ""));
          } else if (event.part.type === "text-end") {
            // Leave the text on screen; the real message replaces it.
          }
          break;
        case "busy":
          setBusy(event.busy);
          break;
        case "prompt":
          setPrompt(event.prompt);
          break;
        case "error":
          setError(event.error);
          break;
      }
    });
  }, [client, id]);

  // Tool traffic is grouped into single rows here rather than in renderItem, so
  // a call and the result it produced stay one cell of the list.
  const data = useMemo<TranscriptItem[]>(() => {
    const entries: Entry[] = streamText
      ? [
          ...messages,
          { id: "__streaming__", role: "assistant", text: streamText, streaming: true },
        ]
      : messages;
    return buildTranscriptItems(entries);
  }, [messages, streamText]);

  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    atBottomRef.current =
      contentOffset.y + layoutMeasurement.height >= contentSize.height - 48;
  }, []);

  const handleContentSizeChange = useCallback(() => {
    // Follow the stream only while the reader is already at the bottom; never
    // yank someone who scrolled up to read history back down.
    if (atBottomRef.current) listRef.current?.scrollToEnd({ animated: false });
  }, []);

  /**
   * One path for everything that puts words into the session, so the optimistic
   * echo and the rollback behave identically whether the text came from the
   * composer or from tapping an answer to the agent's question.
   */
  const submit = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || !client || !id) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const optimistic: Entry = {
        id: `local-${++localSeq}`,
        role: "user",
        text: trimmed,
        ts: Date.now(),
        pending: true,
      };
      setMessages((prev) => [...prev, optimistic]);
      setSending(true);
      try {
        await client.sendMessage(id, trimmed);
        setError(null);
      } catch (e) {
        // Roll the message back AND give the person their words back — losing
        // typed text to a failed request is the rudest thing a composer can do.
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setDraft((current) => (current ? current : trimmed));
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setSending(false);
      }
    },
    [client, id],
  );

  const send = useCallback(() => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    void submit(text);
  }, [draft, sending, submit]);

  /**
   * Answering the agent's question SENDS the answer. It used to drop the label
   * into the composer and wait for a second tap on Send, which meant a one-tap
   * affordance quietly did nothing but type for you.
   */
  const answerPrompt = useCallback(
    (label: string) => {
      void Haptics.selectionAsync();
      setPrompt(null);
      void submit(label);
    },
    [submit],
  );

  const stop = useCallback(async () => {
    if (!client || !id) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    try {
      await client.interrupt(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [client, id]);

  /** This session's own sent messages, newest last — the composer's history. */
  const history = useMemo(
    () => messages.filter((m) => m.role === "user" && m.text).map((m) => m.text as string),
    [messages],
  );

  /**
   * Reuse an earlier prompt. This replaces a pair of 9pt stepper chevrons wedged
   * into the composer: they worked, but they were a terminal idiom rendered at a
   * size iOS would never ship, and you had to tap blindly to discover what was
   * behind them. A sheet shows the actual prompts and picks in one tap.
   */
  const openHistory = useCallback(() => {
    const recent = [...new Set(history)].reverse().slice(0, 6);
    if (!recent.length) return;
    showActionMenu(
      "Reuse a prompt",
      recent.map((text) => ({
        label: text.length > 64 ? `${text.slice(0, 63)}…` : text,
        onPress: () => {
          void Haptics.selectionAsync();
          setDraft(text);
        },
      })),
    );
  }, [history]);

  /** Everything the transcript can be copied into, oldest first. */
  const copyTranscript = useCallback(() => {
    const text = messages
      .filter((m) => m.text)
      .map((m) => `${m.role === "user" ? "You" : "Agent"}: ${m.text}`)
      .join("\n\n");
    if (!text) return;
    void Clipboard.setStringAsync(text);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [messages]);

  /**
   * Archive: the same request the session list's "Smart clear" sends, scoped to
   * this one session. Only offered while the agent is idle, because that is the
   * only shape of this call the server is known to accept.
   */
  const archive = useCallback(() => {
    if (!client || !id) return;
    Alert.alert("Archive this session?", "It can be resumed later.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Archive",
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              await client.transport.request("/api/sessions/close-all", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  source: "session_menu",
                  scope: "idle",
                  sessionIds: [id],
                }),
              });
              router.back();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          })();
        },
      },
    ]);
  }, [client, id, router]);

  const openMenu = useCallback(() => {
    const actions: MenuAction[] = [];
    if (busy) actions.push({ label: "Stop the agent", onPress: () => void stop() });
    if (messages.some((m) => m.text)) {
      actions.push({ label: "Copy transcript", onPress: copyTranscript });
    }
    if (!busy) actions.push({ label: "Archive session", destructive: true, onPress: archive });
    showActionMenu(sessionInfo?.title ?? "Session", actions);
  }, [busy, messages, stop, copyTranscript, archive, sessionInfo?.title]);

  /**
   * The native bar: system back on the left (this is a pushed screen, so the
   * chevron and the edge-swipe cost nothing), the session title with the
   * agent's avatar and live status in the middle, the overflow on the right.
   *
   * Set here rather than in _layout.tsx for the same reason index.tsx sets
   * its own: the title and the menu need this screen's live state, and the
   * deps below are what keep them current as the session loads and the agent
   * starts and stops.
   *
   * `headerTitle` is content-sized, not flex-sized, so an uncapped long prompt
   * would push the overflow button off the bar. The maxWidth is what makes
   * UIKit truncate the title instead of the chrome.
   */
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title,
      headerTitle: () => (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <AgentAvatar agent={agentLabel} size={26} />
          <View style={{ maxWidth: 200 }}>
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{ ...type.subhead, fontWeight: "600", color: colors.text }}
            >
              {title}
            </Text>
            <Text numberOfLines={1} style={{ ...type.caption, color: colors.textMuted }}>
              {busy ? "Working…" : agentDisplayName(agentLabel)}
            </Text>
          </View>
        </View>
      ),
      headerRight: () => (
        <IconButton
          ios="ellipsis.circle"
          android="more_horiz"
          accessibilityLabel="Session actions"
          onPress={openMenu}
          size={20}
          color={colors.text}
        />
      ),
    });
  }, [navigation, title, agentLabel, busy, openMenu, colors, type, space]);

  if (!client) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.bg,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ ...type.callout, color: colors.textMuted }}>No computer selected.</Text>
      </View>
    );
  }

  const thinking = busy && !streamText;
  const canSend = draft.trim().length > 0 && !sending;

  /**
   * Track the keyboard on the UI thread instead of using KeyboardAvoidingView.
   *
   * KAV runs on the JS thread and animates over a FIXED duration, while iOS
   * moves the keyboard on the UI thread along its own curve. The two cannot
   * agree, so the composer always trails the keyboard by a frame or several and
   * lands on a different easing — which is the "it moves but it feels janky"
   * you get on every screen that uses it. It is structural, not tunable.
   *
   * `useAnimatedKeyboard` reads the real keyboard frame in a worklet, so the
   * composer is driven by the same curve on the same thread and tracks it
   * exactly, including the interactive dismiss-by-dragging gesture, which KAV
   * cannot follow at all.
   *
   * Reanimated 4.5 has been in package.json (and in the shipped binary) since
   * the start and was never imported once; this needs no new dependency and no
   * new build.
   *
   * The composer already carries `insets.bottom` of its own padding, so lifting
   * by the full keyboard height would leave a home-indicator-sized gap above
   * the keys. Subtracting it here means the total lift is exactly the keyboard
   * height, and clamping at 0 keeps the resting state untouched.
   *
   * The native header above changes none of this: the lift is paddingBottom on
   * the screen's root, derived from the keyboard frame alone. Nothing measures
   * against a parent, so there is no `keyboardVerticalOffset` to get wrong.
   */
  const keyboard = useAnimatedKeyboard();
  const keyboardLift = useAnimatedStyle(() => ({
    paddingBottom: Math.max(0, keyboard.height.value - insets.bottom),
  }));

  return (
    <Reanimated.View style={[{ flex: 1 }, keyboardLift]}>
      <FlatList
        ref={listRef}
        data={data}
        keyExtractor={(item) => item.key}
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingTop: space.lg,
          paddingBottom: space.md,
          gap: space.xl,
        }}
        // The bar is transparent (set in _layout.tsx), so the list insets its
        // content below it instead of starting underneath it.
        contentInsetAdjustmentBehavior="automatic"
        keyboardDismissMode="interactive"
        onScroll={onScroll}
        scrollEventThrottle={16}
        onContentSizeChange={handleContentSizeChange}
        renderItem={({ item }) => <TranscriptRow item={item} />}
        ListFooterComponent={thinking ? <ThinkingPill /> : null}
        ListEmptyComponent={
          // The spinner lives INSIDE the list so it inherits the content
          // inset; a plain View above the list would start under the
          // transparent bar and paint its first row behind the title.
          loading ? (
            <ActivityIndicator color={colors.textMuted} style={{ paddingVertical: space.xl }} />
          ) : (
            <Text style={{ ...type.footnote, color: colors.textMuted, textAlign: "center" }}>
              No messages yet.
            </Text>
          )
        }
      />

      {/* The agent asked something — answering has to be one tap, and that tap
          has to actually answer. */}
      {prompt ? (
        <View
          style={{
            marginHorizontal: space.lg,
            marginBottom: space.sm,
            padding: space.md,
            backgroundColor: colors.card,
            borderRadius: radius.lg,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            gap: space.sm,
          }}
        >
          {prompt.question ? (
            <Text style={{ ...type.callout, color: colors.text }}>{prompt.question}</Text>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
            {prompt.options?.map((opt) => (
              <Pressable
                key={opt.index}
                onPress={() => answerPrompt(opt.label)}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  minHeight: 36,
                  justifyContent: "center",
                  paddingHorizontal: space.md,
                  paddingVertical: space.sm,
                  borderRadius: radius.pill,
                  backgroundColor: pressed ? colors.cardPressed : colors.secondary,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderColor: colors.border,
                })}
              >
                <Text style={{ ...type.footnote, color: colors.text }}>{opt.label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      <GlassSurface
        variant="clear"
        fallbackColor="transparent"
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: space.sm,
          paddingHorizontal: space.md,
          paddingTop: space.sm,
          paddingBottom: insets.bottom + space.sm,
          // Under Liquid Glass the bar is a blurred surface, so a hairline rule
          // and an opaque fill would both fight it. Everywhere else they are
          // what separates the composer from the transcript behind it.
          borderTopWidth: LIQUID_GLASS ? 0 : StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
          backgroundColor: LIQUID_GLASS ? "transparent" : colors.bg,
        }}
      >
        {/* One field, everything else flat. The bar used to stack three
            surfaces — the glass bar, a card-painted pill inside it, and
            card-painted discs on the buttons — which on a device reads as a
            box inside a box inside a box. iOS Messages is the reference: the
            rounded field is the ONLY surface, the send control lives inside
            it, and every other button is a bare glyph on the bar. */}

        {/* Stop only exists while there is something to stop. A permanently
            visible, permanently dimmed button reads as a broken control. */}
        {busy ? (
          <IconButton
            ios="stop.fill"
            android="stop"
            accessibilityLabel="Stop the agent"
            onPress={() => void stop()}
            size={15}
            color={colors.danger}
          />
        ) : null}

        {history.length ? (
          <IconButton
            ios="clock.arrow.circlepath"
            android="history"
            accessibilityLabel="Reuse an earlier prompt"
            onPress={openHistory}
            size={17}
            color={colors.textMuted}
          />
        ) : null}

        <View
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "flex-end",
            gap: space.xs,
            minHeight: 44,
            backgroundColor: colors.card,
            borderRadius: radius.pill,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
            paddingLeft: space.md,
            paddingRight: 5,
            paddingVertical: 4,
          }}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            // Steering a running agent and queueing a follow-up are different
            // intents; say which one this will be.
            placeholder={busy ? "Queue a follow-up…" : "Message"}
            placeholderTextColor={colors.textMuted}
            multiline
            style={{
              flex: 1,
              maxHeight: 120,
              minHeight: 28,
              paddingTop: Platform.OS === "ios" ? 6 : 2,
              paddingBottom: 6,
              color: colors.text,
              ...type.callout,
              fontSize: 16,
            }}
          />
          <Pressable
            onPress={send}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel={busy ? "Queue the message" : "Send the message"}
            accessibilityState={{ disabled: !canSend }}
            style={({ pressed }) => ({
              width: 30,
              height: 30,
              borderRadius: 15,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.foreground,
              opacity: !canSend ? 0.3 : pressed ? 0.75 : 1,
            })}
          >
            {sending ? (
              <ActivityIndicator size="small" color={colors.bg} />
            ) : (
              <Icon
                ios={busy ? "plus" : "arrow.up"}
                android={busy ? "add" : "arrow_upward"}
                size={15}
                weight="semibold"
                color={colors.bg}
              />
            )}
          </Pressable>
        </View>
      </GlassSurface>
    </Reanimated.View>
  );
}

/** The small dark pill with animated dots shown while the agent is thinking. */
function ThinkingPill() {
  const { colors } = useTheme();
  const dots = useRef([new Animated.Value(0.3), new Animated.Value(0.3), new Animated.Value(0.3)])
    .current;

  useEffect(() => {
    const loops = dots.map((value, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(value, { toValue: 1, duration: 340, useNativeDriver: true }),
          Animated.timing(value, { toValue: 0.3, duration: 340, useNativeDriver: true }),
          Animated.delay((dots.length - 1 - i) * 160),
        ]),
      ),
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [dots]);

  return (
    <View
      style={{
        alignSelf: "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        marginTop: 16,
        marginLeft: 4,
        paddingHorizontal: 13,
        paddingVertical: 9,
        borderRadius: 999,
        backgroundColor: colors.foreground,
      }}
    >
      {dots.map((value, i) => (
        <Animated.View
          key={i}
          style={{
            width: 5,
            height: 5,
            borderRadius: 2.5,
            backgroundColor: colors.bg,
            opacity: value,
          }}
        />
      ))}
    </View>
  );
}

