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
 * Every glyph on this screen is an SF Symbol via `Icon`/`IconButton`. It used
 * to draw its own chevrons, paperclip, mic and pause out of rotated Views —
 * ~190 lines of geometry that could never match the system's optical weights,
 * and looked hand-made next to any real iOS app. The overflow menu is a real
 * UIAlertController (`ActionSheetIOS`) rather than an in-app popover.
 *
 * The header is drawn in-screen rather than by the native stack on purpose:
 * KeyboardAvoidingView measures its frame relative to its PARENT, so a native
 * header would need its height fed back in as `keyboardVerticalOffset`, and
 * `useHeaderHeight` lives in @react-navigation/elements which this app does not
 * depend on directly. Offset 0 is only correct while this screen owns its bar.
 */

import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { Text, TextInput } from "../../src/omg/text";
import * as Clipboard from "expo-clipboard";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { OmgMessage, OmgSession, OmgSessionPrompt } from "@omg-dev/protocol";

import { AgentAvatar, Icon, IconButton } from "../../src/components";
import { Markdown } from "../../src/omg/markdown";
import { agentLabel as agentDisplayName } from "../../src/omg/agent-icons";
import { useOmg } from "../../src/omg/provider";
import { GlassSurface, LIQUID_GLASS } from "../../src/omg/glass";
import { useTheme } from "../../src/omg/theme";
import { relativeTime } from "../../src/omg/format";

/** Local id for the optimistic message, so it can be rolled back precisely. */
let localSeq = 0;

type Entry = OmgMessage & { streaming?: boolean };

/**
 * A native action sheet. iOS gets the real UIAlertController; Android gets an
 * Alert, which is that platform's equivalent list-of-choices dialog.
 */
type MenuAction = { label: string; destructive?: boolean; onPress: () => void };

function showActionMenu(title: string, actions: MenuAction[]) {
  if (!actions.length) return;
  if (Platform.OS === "ios") {
    const labels = actions.map((a) => a.label);
    const destructive = actions.findIndex((a) => a.destructive);
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title,
        options: [...labels, "Cancel"],
        cancelButtonIndex: labels.length,
        // -1 is "no destructive button" to some callers and an out-of-range
        // index to others; omitting the key is unambiguous.
        ...(destructive >= 0 ? { destructiveButtonIndex: destructive } : {}),
      },
      (index) => {
        if (index < actions.length) actions[index].onPress();
      },
    );
    return;
  }
  Alert.alert(title, undefined, [
    ...actions.map((a) => ({
      text: a.label,
      style: a.destructive ? ("destructive" as const) : ("default" as const),
      onPress: a.onPress,
    })),
    { text: "Cancel", style: "cancel" as const },
  ]);
}

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
  const [loading, setLoading] = useState(true);
  const [sessionInfo, setSessionInfo] = useState<{ title: string; agent: string } | null>(null);

  const listRef = useRef<FlatList<Entry>>(null);
  /** Pinned-to-bottom is the default; reading history unpins it. */
  const atBottomRef = useRef(true);

  // This screen draws its own header (see the file comment), so the stack
  // header would be a duplicate.
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

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

  const data = useMemo<Entry[]>(() => {
    if (!streamText) return messages;
    return [
      ...messages,
      { id: "__streaming__", role: "assistant", text: streamText, streaming: true },
    ];
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

  const firstUserText = messages.find((m) => m.role === "user" && m.text)?.text?.trim();
  const title = sessionInfo?.title ?? firstUserText ?? "Session";
  const agentLabel = sessionInfo?.agent ?? "omg";
  const thinking = busy && !streamText;
  const canSend = draft.trim().length > 0 && !sending;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      <View
        style={{
          paddingTop: insets.top + space.xs,
          paddingBottom: space.sm,
          paddingHorizontal: space.sm,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
          backgroundColor: colors.bg,
        }}
      >
        <IconButton
          ios="chevron.down"
          android="keyboard_arrow_down"
          accessibilityLabel="Close session"
          onPress={() => router.back()}
          size={17}
          color={colors.text}
        />
        <AgentAvatar agent={agentLabel} size={28} />
        <View style={{ flex: 1, minWidth: 0, marginLeft: space.xs }}>
          <Text
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{ ...type.headline, color: colors.text }}
          >
            {title}
          </Text>
          <Text numberOfLines={1} style={{ ...type.caption, color: colors.textMuted }}>
            {busy ? "Working…" : agentDisplayName(agentLabel)}
          </Text>
        </View>
        <IconButton
          ios="ellipsis.circle"
          android="more_horiz"
          accessibilityLabel="Session actions"
          onPress={openMenu}
          size={20}
          color={colors.text}
        />
      </View>

      {loading ? (
        <View style={{ paddingVertical: space.xl }}>
          <ActivityIndicator color={colors.textMuted} />
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        data={data}
        keyExtractor={(m, i) => m.id ?? String(i)}
        contentContainerStyle={{
          paddingHorizontal: space.lg,
          paddingTop: space.lg,
          paddingBottom: space.md,
          gap: space.xl,
        }}
        keyboardDismissMode="interactive"
        onScroll={onScroll}
        scrollEventThrottle={16}
        onContentSizeChange={handleContentSizeChange}
        renderItem={({ item }) => <TranscriptEntry message={item} />}
        ListFooterComponent={thinking ? <ThinkingPill /> : null}
        ListEmptyComponent={
          loading ? null : (
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

      {error ? (
        <Text
          style={{
            ...type.caption,
            color: colors.danger,
            paddingHorizontal: space.lg,
            paddingBottom: space.xs,
          }}
        >
          {error}
        </Text>
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
            background={colors.card}
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
            paddingLeft: history.length ? space.xs : space.md,
            paddingRight: 5,
            paddingVertical: 4,
          }}
        >
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
    </KeyboardAvoidingView>
  );
}

function TranscriptEntry({ message }: { message: Entry }) {
  const { colors, type, space } = useTheme();
  const isUser = message.role === "user";
  const isSystem = message.role !== "user" && message.role !== "assistant";

  // A message carrying only a file or an image has no text to fall back on, and
  // used to render as an empty box — an invisible turn in the transcript. One
  // that ALSO has text still renders as text, so nothing a person wrote or read
  // can be swallowed by this branch.
  const isAttachment =
    !!message.url || !!message.artifactId || message.kind === "image" || message.kind === "file";
  if (isAttachment && !message.text) return <AttachmentEntry message={message} />;

  if (isSystem && !message.text) return null;

  if (isUser) return <UserMessage message={message} />;

  if (isSystem) {
    return (
      <View style={{ alignSelf: "center", paddingHorizontal: space.lg }}>
        <Text style={{ ...type.caption, color: colors.textMuted, textAlign: "center" }}>
          {message.text}
        </Text>
      </View>
    );
  }

  // The assistant's reply is plain text on the page background — no card, no
  // tint — exactly like the web transcript.
  return (
    <View style={{ alignSelf: "stretch", paddingHorizontal: space.xs }}>
      <Markdown text={message.text ?? ""} streaming={message.streaming} />
    </View>
  );
}

/**
 * An image or file in the transcript, as a tappable row.
 *
 * It does NOT try to inline the bitmap: every artifact URL on a Computer is
 * behind the grant the transport holds, and `<Image>` has no way to ask for it.
 * Naming the file and saying what it is beats a broken-image box, and beats the
 * empty View this used to render.
 */
function AttachmentEntry({ message }: { message: Entry }) {
  const { colors, type, space, radius } = useTheme();
  const isImage = message.kind === "image" || !!message.mimeType?.startsWith("image/");
  const label = message.name ?? message.caption ?? message.alt ?? (isImage ? "Image" : "File");
  const size =
    typeof message.size === "number" && message.size > 0
      ? `${Math.max(1, Math.round(message.size / 1024))} KB`
      : null;

  return (
    <View
      style={{
        alignSelf: message.role === "user" ? "flex-end" : "flex-start",
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        maxWidth: "90%",
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        backgroundColor: colors.card,
        borderRadius: radius.lg,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
      }}
    >
      <Icon
        ios={isImage ? "photo" : "doc"}
        android={isImage ? "image" : "description"}
        size={18}
        color={colors.textSecondary}
      />
      <View style={{ minWidth: 0, flexShrink: 1 }}>
        <Text numberOfLines={1} style={{ ...type.footnote, color: colors.text }}>
          {label}
        </Text>
        <Text style={{ ...type.caption, color: colors.textMuted }}>
          {size ? `${size} · view on the web` : "View on the web"}
        </Text>
      </View>
    </View>
  );
}

function UserMessage({ message }: { message: Entry }) {
  const { colors, type, space, radius } = useTheme();
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const copy = () => {
    if (!message.text) return;
    void Haptics.selectionAsync();
    // expo-clipboard, not RN's core Clipboard — the core one is deprecated and
    // slated for removal, and expo-clipboard is already a dependency (the
    // iMessage sign-in flow uses it to copy the code).
    void Clipboard.setStringAsync(message.text);
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1500);
  };

  const stamp = relativeTime(message.ts);

  return (
    <View style={{ alignSelf: "stretch" }}>
      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: radius.xl,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          opacity: message.pending ? 0.6 : 1,
        }}
      >
        <Text
          selectable
          style={{ ...type.callout, fontSize: 16, lineHeight: 22, color: colors.text }}
        >
          {message.text}
        </Text>
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          marginTop: 2,
          marginLeft: space.sm,
        }}
      >
        <Pressable
          onPress={copy}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Copy message"
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingVertical: 4,
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <Icon
            ios={copied ? "checkmark" : "doc.on.doc"}
            android={copied ? "check" : "content_copy"}
            size={12}
            color={colors.textMuted}
          />
          {copied ? (
            <Text style={{ ...type.caption, color: colors.textMuted }}>Copied</Text>
          ) : null}
        </Pressable>
        {message.pending ? (
          <Text style={{ ...type.caption, color: colors.textMuted }}>Sending…</Text>
        ) : stamp ? (
          <Text style={{ ...type.caption, color: colors.textMuted }}>{stamp}</Text>
        ) : null}
      </View>
    </View>
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

