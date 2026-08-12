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
 * text on the page background. There is no icon font in this app's dependency
 * set, so every glyph below is drawn from plain Views.
 */

import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
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

import { useOmg } from "../../src/omg/provider";
import { useTheme } from "../../src/omg/theme";

/** Local id for the optimistic message, so it can be rolled back precisely. */
let localSeq = 0;

type Entry = OmgMessage & { pending?: boolean; streaming?: boolean };

const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" });

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
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionInfo, setSessionInfo] = useState<{ title: string; agent: string } | null>(null);

  const listRef = useRef<FlatList<Entry>>(null);
  /** Pinned-to-bottom is the default; reading history unpins it. */
  const atBottomRef = useRef(true);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // This screen draws its own header (chevron-down, avatar, title, overflow),
  // so the stack header would be a duplicate.
  useLayoutEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const flashNote = useCallback((text: string) => {
    setNote(text);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), 3000);
  }, []);

  useEffect(
    () => () => {
      if (noteTimer.current) clearTimeout(noteTimer.current);
    },
    [],
  );

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
        agent: found.agentLabel?.trim() || found.agent?.trim() || "omg",
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

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !client || !id || sending) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const optimistic: Entry = {
      id: `local-${++localSeq}`,
      role: "user",
      text,
      ts: Date.now(),
      pending: true,
    };
    setMessages((prev) => [...prev, optimistic]);
    setDraft("");
    setSending(true);
    try {
      await client.sendMessage(id, text);
      setError(null);
    } catch (e) {
      // Roll the message back AND give the person their words back — losing
      // typed text to a failed request is the rudest thing a composer can do.
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(text);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }, [draft, client, id, sending]);

  const stop = useCallback(async () => {
    if (!client || !id) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    try {
      await client.interrupt(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [client, id]);

  // The composer's up/down stepper walks this session's own sent messages,
  // like the web composer's prompt history.
  const history = useMemo(
    () => messages.filter((m) => m.role === "user" && m.text).map((m) => m.text as string),
    [messages],
  );
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const savedDraft = useRef("");

  const stepHistory = useCallback(
    (dir: -1 | 1) => {
      if (!history.length) return;
      void Haptics.selectionAsync();
      if (historyIndex === null) {
        if (dir === 1) return; // Already at the newest end.
        savedDraft.current = draft;
        const next = history.length - 1;
        setHistoryIndex(next);
        setDraft(history[next]);
        return;
      }
      const next = historyIndex + dir;
      if (next >= history.length) {
        setHistoryIndex(null);
        setDraft(savedDraft.current);
      } else if (next >= 0) {
        setHistoryIndex(next);
        setDraft(history[next]);
      }
    },
    [history, historyIndex, draft],
  );

  useEffect(() => {
    // A fresh send leaves history mode.
    if (sending) setHistoryIndex(null);
  }, [sending]);

  if (!client) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ ...type.callout, color: colors.textMuted }}>No computer selected.</Text>
      </View>
    );
  }

  const firstUserText = messages.find((m) => m.role === "user" && m.text)?.text?.trim();
  const title = sessionInfo?.title ?? firstUserText ?? "Session";
  const agentLabel = sessionInfo?.agent ?? "omg";
  const thinking = busy && !streamText;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={0}
    >
      <View
        style={{
          paddingTop: insets.top + space.sm,
          paddingBottom: space.md,
          paddingHorizontal: space.sm,
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
          backgroundColor: colors.bg,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close session"
          style={({ pressed }) => ({
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <ChevronDownIcon size={18} color={colors.text} />
        </Pressable>
        <View
          style={{
            width: 30,
            height: 30,
            borderRadius: 15,
            backgroundColor: colors.foreground,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: "700", color: colors.bg }}>
            {agentLabel.charAt(0).toUpperCase()}
          </Text>
        </View>
        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={{ flex: 1, ...type.headline, color: colors.text }}
        >
          {title}
        </Text>
        <Pressable
          onPress={() => flashNote("Session actions are not available in the app yet.")}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Session actions"
          style={({ pressed }) => ({
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <EllipsisIcon size={16} color={colors.text} />
        </Pressable>
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
          gap: space.lg,
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

      {/* The agent asked something — answering has to be one tap. */}
      {prompt ? (
        <View
          style={{
            marginHorizontal: space.lg,
            marginBottom: space.sm,
            padding: space.md,
            backgroundColor: colors.card,
            borderRadius: radius.lg,
            borderWidth: 1,
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
                onPress={() => {
                  void Haptics.selectionAsync();
                  setDraft(opt.label);
                }}
                style={({ pressed }) => ({
                  paddingHorizontal: space.md,
                  paddingVertical: space.sm,
                  borderRadius: radius.pill,
                  backgroundColor: pressed ? colors.cardPressed : colors.secondary,
                  borderWidth: 1,
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

      {note ? (
        <Text
          style={{
            ...type.caption,
            color: colors.textMuted,
            paddingHorizontal: space.lg,
            paddingBottom: space.xs,
          }}
        >
          {note}
        </Text>
      ) : null}

      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: space.sm,
          paddingHorizontal: space.md,
          paddingTop: space.sm,
          paddingBottom: insets.bottom + space.sm,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
          backgroundColor: colors.bg,
        }}
      >
        <Pressable
          onPress={() => flashNote("Attachments are not available in the app yet.")}
          accessibilityRole="button"
          accessibilityLabel="Attach a file"
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? colors.cardPressed : colors.card,
            borderWidth: 1,
            borderColor: colors.border,
          })}
        >
          <PaperclipIcon size={18} color={colors.textSecondary} />
        </Pressable>

        <View
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            minHeight: 44,
            backgroundColor: colors.card,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderColor: colors.border,
            paddingLeft: space.sm,
            paddingRight: 6,
          }}
        >
          <View
            style={{
              paddingHorizontal: 7,
              paddingVertical: 2,
              borderRadius: radius.sm,
              backgroundColor: colors.secondary,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text style={{ ...type.caption, color: colors.textMuted }}>/</Text>
          </View>
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
              paddingVertical: 0,
              color: colors.text,
              ...type.callout,
            }}
          />
          <Pressable
            onPress={() => flashNote("Dictation is not available in the app yet.")}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Dictate"
            style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 4 })}
          >
            <MicIcon size={17} color={colors.textMuted} />
          </Pressable>
          <View style={{ alignItems: "center", justifyContent: "center" }}>
            <Pressable
              onPress={() => stepHistory(-1)}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel="Earlier message"
              style={({ pressed }) => ({ opacity: pressed ? 0.4 : 1, padding: 2 })}
            >
              <ChevronUpIcon size={9} color={colors.textMuted} />
            </Pressable>
            <Pressable
              onPress={() => stepHistory(1)}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel="Later message"
              style={({ pressed }) => ({ opacity: pressed ? 0.4 : 1, padding: 2 })}
            >
              <ChevronDownIcon size={9} color={colors.textMuted} />
            </Pressable>
          </View>
        </View>

        <Pressable
          onPress={() => void stop()}
          disabled={!busy}
          accessibilityRole="button"
          accessibilityLabel="Stop the agent"
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? colors.cardPressed : colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            opacity: busy ? 1 : 0.4,
          })}
        >
          <PauseIcon size={14} color={colors.textSecondary} />
        </Pressable>

        <Pressable
          onPress={() => void send()}
          disabled={!draft.trim() || sending}
          accessibilityRole="button"
          accessibilityLabel={busy ? "Queue the message" : "Send the message"}
          style={({ pressed }) => ({
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.foreground,
            opacity: !draft.trim() || sending ? 0.35 : pressed ? 0.8 : 1,
          })}
        >
          {sending ? (
            <ActivityIndicator size="small" color={colors.bg} />
          ) : (
            <Text style={{ color: colors.bg, fontSize: 19, fontWeight: "700", marginTop: -1 }}>
              {busy ? "+" : "↑"}
            </Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function TranscriptEntry({ message }: { message: Entry }) {
  const { colors, type, space } = useTheme();
  const isUser = message.role === "user";
  const isSystem = message.role !== "user" && message.role !== "assistant";

  if (isSystem && !message.text) return null;

  if (isUser) {
    return <UserMessage message={message} />;
  }

  if (isSystem) {
    return (
      <View style={{ alignSelf: "center" }}>
        <Text style={{ ...type.caption, color: colors.textMuted }}>
          {message.text ?? (message.kind ? `[${message.kind}]` : "")}
        </Text>
      </View>
    );
  }

  // The assistant's reply is plain text on the page background — no card, no
  // tint — exactly like the web transcript.
  return (
    <View style={{ alignSelf: "stretch", paddingHorizontal: space.xs }}>
      <AssistantText text={message.text ?? ""} streaming={message.streaming} />
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

  return (
    <View style={{ alignSelf: "stretch" }}>
      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: radius.xl,
          borderWidth: 1,
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
      <Pressable
        onPress={copy}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Copy message"
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          marginTop: 6,
          marginLeft: 6,
          alignSelf: "flex-start",
          opacity: pressed ? 0.5 : 1,
        })}
      >
        {copied ? (
          <Text style={{ ...type.caption, color: colors.textMuted }}>Copied</Text>
        ) : (
          <CopyIcon size={14} color={colors.textMuted} fill={colors.bg} />
        )}
      </Pressable>
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

/* ------------------------------------------------------------------------ */
/* Markdown-ish assistant text: fenced code blocks, inline code, bold.       */
/* Deliberately dependency-free — the web uses streamdown, which is far too  */
/* heavy to drag into the native bundle for a transcript.                    */
/* ------------------------------------------------------------------------ */

type MdBlock = { kind: "code"; text: string } | { kind: "para"; text: string };

function splitMdBlocks(src: string): MdBlock[] {
  const out: MdBlock[] = [];
  // The `(?:```|$)` alternative keeps an unclosed fence (mid-stream) readable.
  const fence = /```[^\n`]*\n?([\s\S]*?)(?:```|$)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(src))) {
    const before = src.slice(last, match.index).trim();
    if (before) out.push({ kind: "para", text: before });
    const code = match[1].replace(/\n$/, "");
    if (code) out.push({ kind: "code", text: code });
    last = match.index + match[0].length;
  }
  const rest = src.slice(last).trim();
  if (rest) out.push({ kind: "para", text: rest });
  return out;
}

function InlineMd({ text, codeColor }: { text: string; codeColor: string }) {
  const parts = text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
          return (
            <Text
              key={i}
              style={{ fontFamily: MONO, fontSize: 14, backgroundColor: codeColor }}
            >
              {part.slice(1, -1)}
            </Text>
          );
        }
        if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
          return (
            <Text key={i} style={{ fontWeight: "700" }}>
              {part.slice(2, -2)}
            </Text>
          );
        }
        return <Text key={i}>{part}</Text>;
      })}
    </>
  );
}

function AssistantText({ text, streaming }: { text: string; streaming?: boolean }) {
  const { colors, type, space, radius } = useTheme();
  const blocks = useMemo(() => splitMdBlocks(text), [text]);

  if (!blocks.length) {
    return (
      <Text style={{ ...type.callout, fontSize: 16, lineHeight: 23, color: colors.text }}>
        {streaming ? "▍" : ""}
      </Text>
    );
  }

  return (
    <View style={{ gap: space.md }}>
      {blocks.map((block, i) => {
        if (block.kind === "code") {
          return (
            <View
              key={i}
              style={{
                backgroundColor: colors.codeBg,
                borderRadius: radius.md,
                paddingHorizontal: space.md,
                paddingVertical: space.sm,
              }}
            >
              <Text
                selectable
                style={{ fontFamily: MONO, fontSize: 13, lineHeight: 19, color: colors.text }}
              >
                {block.text}
              </Text>
            </View>
          );
        }
        // ATX headings degrade to bold lines rather than a second type scale.
        const paras = block.text
          .replace(/^(#{1,6})\s+(.+)$/gm, "**$2**")
          .split(/\n{2,}/);
        return (
          <View key={i} style={{ gap: space.md }}>
            {paras.map((para, j) => (
              <Text
                key={j}
                selectable
                style={{ ...type.callout, fontSize: 16, lineHeight: 23, color: colors.text }}
              >
                <InlineMd text={para} codeColor={colors.codeBg} />
                {streaming && i === blocks.length - 1 && j === paras.length - 1 ? "▍" : ""}
              </Text>
            ))}
          </View>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------------ */
/* Glyphs drawn from plain Views — this app has no icon font in its          */
/* dependency set, and one screen does not justify adding one.               */
/* ------------------------------------------------------------------------ */

function ChevronDownIcon({ size, color }: { size: number; color: string }) {
  const bar = size * 0.58;
  const thick = Math.max(1.6, size * 0.11);
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View
        style={{
          position: "absolute",
          width: bar,
          height: thick,
          borderRadius: thick / 2,
          backgroundColor: color,
          transform: [{ translateX: -bar * 0.26 }, { translateY: -size * 0.08 }, { rotate: "45deg" }],
        }}
      />
      <View
        style={{
          position: "absolute",
          width: bar,
          height: thick,
          borderRadius: thick / 2,
          backgroundColor: color,
          transform: [{ translateX: bar * 0.26 }, { translateY: -size * 0.08 }, { rotate: "-45deg" }],
        }}
      />
    </View>
  );
}

function ChevronUpIcon({ size, color }: { size: number; color: string }) {
  return (
    <View style={{ transform: [{ rotate: "180deg" }] }}>
      <ChevronDownIcon size={size} color={color} />
    </View>
  );
}

function EllipsisIcon({ size, color }: { size: number; color: string }) {
  const dot = size * 0.2;
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "space-evenly",
      }}
    >
      {[0, 1, 2].map((i) => (
        <View
          key={i}
          style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color }}
        />
      ))}
    </View>
  );
}

function PaperclipIcon({ size, color }: { size: number; color: string }) {
  const width = size * 0.52;
  const height = size * 0.8;
  const stroke = Math.max(1.4, size * 0.09);
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
        transform: [{ rotate: "45deg" }],
      }}
    >
      <View
        style={{
          width,
          height,
          borderLeftWidth: stroke,
          borderRightWidth: stroke,
          borderBottomWidth: stroke,
          borderColor: color,
          borderBottomLeftRadius: width / 2,
          borderBottomRightRadius: width / 2,
          alignItems: "center",
        }}
      >
        <View
          style={{
            width: width * 0.42,
            height: height * 0.48,
            marginTop: height * 0.16,
            borderLeftWidth: stroke,
            borderRightWidth: stroke,
            borderBottomWidth: stroke,
            borderColor: color,
            borderBottomLeftRadius: width * 0.21,
            borderBottomRightRadius: width * 0.21,
          }}
        />
      </View>
    </View>
  );
}

function MicIcon({ size, color }: { size: number; color: string }) {
  const capsuleW = size * 0.4;
  const capsuleH = size * 0.52;
  const stroke = Math.max(1.3, size * 0.08);
  return (
    <View style={{ width: size, height: size, alignItems: "center" }}>
      <View
        style={{
          width: capsuleW,
          height: capsuleH,
          borderRadius: capsuleW / 2,
          backgroundColor: color,
        }}
      />
      <View
        style={{
          width: size * 0.68,
          height: size * 0.36,
          marginTop: -size * 0.18,
          borderLeftWidth: stroke,
          borderRightWidth: stroke,
          borderBottomWidth: stroke,
          borderColor: color,
          borderBottomLeftRadius: size * 0.34,
          borderBottomRightRadius: size * 0.34,
        }}
      />
      <View style={{ width: stroke, height: size * 0.14, backgroundColor: color }} />
    </View>
  );
}

function PauseIcon({ size, color }: { size: number; color: string }) {
  const barW = size * 0.22;
  return (
    <View
      style={{
        width: size,
        height: size,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: size * 0.18,
      }}
    >
      <View style={{ width: barW, height: size, borderRadius: barW / 2, backgroundColor: color }} />
      <View style={{ width: barW, height: size, borderRadius: barW / 2, backgroundColor: color }} />
    </View>
  );
}

function CopyIcon({ size, color, fill }: { size: number; color: string; fill: string }) {
  const stroke = Math.max(1.2, size * 0.1);
  const box = size * 0.64;
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          width: box,
          height: box,
          borderWidth: stroke,
          borderColor: color,
          borderRadius: size * 0.16,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          width: box,
          height: box,
          borderWidth: stroke,
          borderColor: color,
          borderRadius: size * 0.16,
          backgroundColor: fill,
        }}
      />
    </View>
  );
}
