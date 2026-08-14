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
 * and looked hand-made next to any real iOS app. The overflow and the prompt
 * history are system menus anchored to their buttons (see src/omg/menu.tsx),
 * not sheets thrown up from the bottom of the screen.
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
  Keyboard,
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

import { AgentAvatar, AttachmentStrip, Icon, IconButton } from "../../src/components";
import { agentLabel as agentDisplayName } from "../../src/omg/agent-icons";
import { useAttachments } from "../../src/omg/attachments";
import { useDictation } from "../../src/omg/dictation";
import { GlassSurface, LIQUID_GLASS } from "../../src/omg/glass";
import { DropdownMenu, type MenuOption } from "../../src/omg/menu";
import { useOmg } from "../../src/omg/provider";
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

  const attachments = useAttachments(id ?? null);
  const dictation = useDictation(
    client ? (path, init) => client.transport.fetch(path, init) : null,
    // Dictation APPENDS. Someone who typed half a thought and then spoke the
    // rest should end up with both, in that order.
    (text) => setDraft((current) => (current ? `${current} ${text}` : text)),
  );

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
    const text = attachments.compose(draft.trim());
    if (!text || sending) return;
    setDraft("");
    attachments.clear();
    void submit(text);
  }, [attachments, draft, sending, submit]);

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

  const menuOptions = useMemo<MenuOption[]>(() => {
    const options: MenuOption[] = [];
    if (busy) {
      options.push({ label: "Stop the agent", icon: "stop.fill", onPress: () => void stop() });
    }
    if (messages.some((m) => m.text)) {
      options.push({ label: "Copy transcript", icon: "doc.on.doc", onPress: copyTranscript });
    }
    if (!busy) {
      options.push({
        label: "Archive session",
        icon: "archivebox",
        destructive: true,
        onPress: archive,
      });
    }
    return options;
  }, [busy, messages, stop, copyTranscript, archive]);

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
  /** The chevron on its own glass disc — one bar item. */
  const BackDisc = useCallback(
    () => (
      <GlassSurface
        variant="clear"
        fallbackColor={colors.card}
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={({ pressed }) => ({
            width: 36,
            height: 36,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <Icon ios="chevron.backward" android="arrow_back" size={17} color={colors.text} />
        </Pressable>
      </GlassSurface>
    ),
    [colors, navigation],
  );

  /** The agent and the session's name, on their own glass capsule. */
  const TitleCapsule = useCallback(
    () => (
      <GlassSurface
        variant="clear"
        fallbackColor={colors.card}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          borderRadius: radius.pill,
          // The mark is a circle inside a capsule, so it needs more of a lead
          // than a square would: at 4pt it sat against the glass.
          paddingLeft: space.sm,
          paddingRight: space.md,
          paddingVertical: space.xs,
          overflow: "hidden",
        }}
      >
        <AgentAvatar agent={agentLabel} size={26} />
        <View style={{ maxWidth: 190 }}>
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
      </GlassSurface>
    ),
    [agentLabel, busy, colors, radius.pill, space, title, type],
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      // Empty, not the session's name: `headerTitle: () => null` leaves the
      // native bar free to fall back to the STRING title, which it did — the
      // name appeared twice, once in the capsule and once floating centred.
      title: "",
      /**
       * The title is a CAPSULE IN THE SAME MATERIAL as the buttons flanking
       * it, sitting directly against the back button rather than centred.
       *
       * iOS 26 gives every bar BUTTON its own glass disc. A bare avatar and
       * two lines of text floating between them were the one thing on the bar
       * with no shape, and painting them onto a flat `card` fill made a second
       * kind of surface up there — a slab next to two pieces of glass. Same
       * GlassSurface as everything else, so the bar is one material.
       *
       * Left-aligned (`headerTitleAlign`) so it hugs the back button and grows
       * rightwards with the session's name, which is what a title that can be
       * any length wants: a centred capsule moves its own left edge every time
       * the name changes.
       */
      /**
       * IN THE LEFT SLOT, WITH THE BACK CHEVRON — not centred.
       *
       * `headerTitleAlign: "left"` is an Android-only option on native-stack;
       * on iOS the bar centres its title view no matter what, which left the
       * capsule floating in the middle with a gap either side. The left slot
       * is the only place UIKit will put content next to the back button, so
       * the back chevron is drawn here too and the system back item is turned
       * off (the swipe-back gesture is independent and still works).
       *
       * No material of our own: iOS 26 wraps the whole slot in one glass
       * container — the same one it gives the ⋯ button — so back and title
       * come out as a single capsule that hugs its content and grows with the
       * session's name. Painting a second surface inside that container was a
       * capsule inside a capsule.
       */
      headerBackVisible: false,
      /**
       * TWO ITEMS, TWO BACKGROUNDS — a disc for the chevron and a capsule for
       * the name, not one long pill holding both.
       *
       * iOS 26 gives ADJACENT bar items a SHARED background, which is why
       * putting the chevron and the title in one `headerLeft` fused them into
       * a single capsule. `unstable_headerLeftItems` addresses them as
       * separate items, and `hidesSharedBackground` opts each out of the
       * shared one so the glass below is the only material either of them
       * has. Two shapes, the way the reference draws it.
       *
       * `headerLeft` stays as the fallback: these items are an iOS-only path
       * (and iOS 26 at that), and on anything older the same two elements are
       * still what should appear.
       */
      unstable_headerLeftItems: () => [
        {
          type: "custom",
          hidesSharedBackground: true,
          /**
           * ONE ITEM HOLDING BOTH SHAPES, not two items side by side.
           *
           * As two items the bar owned the space between them, and it is
           * generous — the capsule floated a finger's width off the chevron
           * instead of reading as the pair they are, and a negative spacing
           * item does not claw it back. Inside one item the gap is a `gap`
           * property and it is exactly what it says. Each shape still draws
           * its own glass, so this is two backgrounds, not one long pill.
           */
          element: (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <BackDisc />
              <TitleCapsule />
            </View>
          ),
        },
      ],
      headerLeft: () => (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          <BackDisc />
          <TitleCapsule />
        </View>
      ),
      headerTitle: () => null,
      headerRight: () =>
        menuOptions.length ? (
          <DropdownMenu options={menuOptions}>
            <View accessibilityRole="button" accessibilityLabel="Session actions">
              {/* Three dots, not `ellipsis.circle`: the circle is drawn by
                  the bar's own glass disc, and the symbol's own ring inside it
                  made two concentric circles. */}
              <Icon ios="ellipsis" android="more_horiz" size={20} color={colors.text} />
            </View>
          </DropdownMenu>
        ) : null,
    });
  }, [navigation, title, agentLabel, busy, menuOptions, colors, type, space, radius]);

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
  // An attachment with no words is still a message — "look at this" is the
  // most common thing a screenshot is sent for.
  const canSend =
    (draft.trim().length > 0 || attachments.items.some((item) => item.path)) &&
    !sending &&
    !attachments.uploading;

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

  /**
   * THE LIFT ALONE IS NOT ENOUGH — the list has to follow it.
   *
   * Raising the composer shrinks the list above it, and a FlatList keeps its
   * scroll OFFSET when that happens, so the bottom of the transcript slides
   * out of sight behind the keyboard. You tap the field to reply and the
   * message you are replying to disappears: the screen looks like it did not
   * move at all.
   *
   * Only when the transcript was already pinned to the bottom. Someone who
   * scrolled up to read history is holding their place on purpose, and
   * yanking them to the end because a keyboard opened would be worse than the
   * bug.
   */
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => {
      if (atBottomRef.current) listRef.current?.scrollToEnd({ animated: true });
    });
    return () => show.remove();
  }, []);

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
          // 24pt between EVERY item read as a transcript of isolated objects
          // rather than a conversation: a tool run and the sentence explaining
          // it were pushed as far apart as two separate turns. 16pt keeps the
          // turns legible while letting related things sit together, now that
          // a run of tool calls is one grouped surface instead of N tiles.
          gap: space.lg,
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

      {/* The bar itself draws NOTHING.
 *
 * It used to be a surface in its own right: a fill plus a hairline rule
 * across the top, with the rounded field sitting on it. Against a black
 * transcript that reads as a grey slab pasted along the bottom of the
 * screen — a band whose edges have no meaning, since the thing you
 * interact with is the pill inside it, not the panel behind it.
 *
 * The fill and the rule were there to separate the composer from the
 * scrolling transcript. The field's own shape already does that, and
 * `keyboardDismissMode="interactive"` means content is meant to pass
 * behind it. So the bar is now pure layout, and the field is the only
 * surface — the same rule the home composer follows. */}
      <View
        style={{
          paddingHorizontal: space.md,
          paddingTop: space.sm,
          paddingBottom: insets.bottom + space.sm,
          gap: space.sm,
        }}
      >
        <AttachmentStrip items={attachments.items} onRemove={attachments.remove} />

        {/**
         * THE FIELD GETS THE WHOLE WIDTH, and the buttons get their own row.
         *
         * They used to share one line: stop, paperclip, mic and history all
         * squeezed to the left of a field that ended up about half the bar.
         * On a phone that is a row of unlabelled glyphs crowding the one
         * control you actually came to use, and the field was too narrow to
         * read back what you had typed. The web composer does not do this —
         * it gives the input its own line and puts the actions under it — and
         * that is the shape this now follows.
         *
         * Glass, like the home composer. A flat `card` fill next to the
         * transcript reads as a slab; the glass is what makes it chrome
         * floating over content rather than a panel pasted on.
         */}
        {/* ATTACH IS ITS OWN BUTTON, beside the field rather than inside it.
            Everything in the box acts on the text you are writing; attaching a
            file adds a different KIND of thing to the message, and it earns a
            control of its own — the plus button's place in Messages. Its own
            glass circle, bottom-aligned so it stays level with the last line
            as the field grows. */}
        <View style={{ flexDirection: "row", alignItems: "flex-end", gap: space.sm }}>
        <DropdownMenu title="Attach" options={attachments.options} style={{ width: 44, height: 44 }}>
          <GlassSurface
            variant="regular"
            fallbackColor={colors.secondary}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              overflow: "hidden",
            }}
          >
            <View accessibilityRole="button" accessibilityLabel="Attach a file">
              <Icon ios="paperclip" android="attach_file" size={18} color={colors.textSecondary} />
            </View>
          </GlassSurface>
        </DropdownMenu>

        <GlassSurface
          variant="regular"
          fallbackColor={colors.card}
          style={{
            flex: 1,
            flexDirection: "row",
            // CENTRED, not bottom-aligned. One line of text in a 52pt box sat
            // on the floor of it with all the slack above — the placeholder
            // read as if it had slipped. The field grows with the text, so
            // centring stays right at every height.
            alignItems: "center",
            gap: space.xs,
            // Not `pill`: this field grows to 120pt for a long prompt, and a
            // full pill radius on a tall box bulges. `xl` keeps the same
            // family at every height.
            borderRadius: radius.xl,
            minHeight: 52,
            paddingLeft: space.md,
            paddingRight: space.sm,
            paddingVertical: 6,
            overflow: "hidden",
            // Only when the OS cannot draw glass: the fallback is a flat fill,
            // and a flat fill with no edge disappears into the page.
            ...(LIQUID_GLASS
              ? {}
              : { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }),
          }}
        >
          {/* Attach sits at the HEAD of the field, where the thing it adds
              will appear. It used to be a disc on a row underneath, which put
              two of the composer's three controls outside the box they act
              on. */}

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
              // No vertical padding of its own: the box centres it, and
              // padding here would fight that and push the text low again.
              minHeight: 24,
              paddingTop: 0,
              paddingBottom: 0,
              color: colors.text,
              ...type.callout,
              fontSize: 16,
              lineHeight: 21,
            }}
          />
          {/**
           * ONE BUTTON, TWO JOBS, decided by whether there is anything to
           * send. An empty composer can only be filled — so it offers the
           * mic. The moment there are words, the only thing you want is to
           * send them, so the same spot becomes the arrow. Showing both at
           * once means one of them is always the wrong answer, and on a phone
           * that is a 44pt target spent on nothing.
           */}
          {canSend || sending ? (
            <Pressable
              onPress={send}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityLabel={busy ? "Queue the message" : "Send the message"}
              accessibilityState={{ disabled: !canSend }}
              style={({ pressed }) => ({
                width: 32,
                height: 32,
                borderRadius: 16,
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
          ) : (
            <IconButton
              ios={dictation.state === "recording" ? "stop.circle.fill" : "mic"}
              android={dictation.state === "recording" ? "stop_circle" : "mic"}
              accessibilityLabel={
                dictation.state === "recording" ? "Stop dictating" : "Dictate a message"
              }
              onPress={dictation.toggle}
              busy={dictation.state === "transcribing"}
              size={18}
              color={dictation.state === "recording" ? colors.danger : colors.textMuted}
            />
          )}
        </GlassSurface>
        </View>

        {/* No stop button down here. Stopping a run is not a composer
            control — the composer is for what you are about to say — and a red
            square parked under the field was the loudest thing on the screen
            for something you rarely do. It lives in the ⋯ menu, which is where
            the session's other verbs already are. */}
      </View>
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

