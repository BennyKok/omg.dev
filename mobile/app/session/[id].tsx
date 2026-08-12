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
 * bubble which is replaced the moment the real `message` lands — otherwise the
 * finished turn renders twice.
 */

import { useLocalSearchParams, useNavigation } from "expo-router";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { OmgMessage, OmgSessionPrompt } from "@omg-dev/protocol";

import { useOmg } from "../../src/omg/provider";
import { useTheme } from "../../src/omg/theme";

/** Local id for the optimistic bubble, so it can be rolled back precisely. */
let localSeq = 0;

type Bubble = OmgMessage & { pending?: boolean; streaming?: boolean };

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { colors, type, space, radius } = useTheme();
  const { client } = useOmg();

  const [messages, setMessages] = useState<Bubble[]>([]);
  const [streamText, setStreamText] = useState("");
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState<OmgSessionPrompt | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const listRef = useRef<FlatList<Bubble>>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ title: "Session" });
  }, [navigation]);

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

  const data = useMemo<Bubble[]>(() => {
    if (!streamText) return messages;
    return [
      ...messages,
      { id: "__streaming__", role: "assistant", text: streamText, streaming: true },
    ];
  }, [messages, streamText]);

  useEffect(() => {
    if (data.length) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    }
  }, [data.length, streamText]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !client || !id || sending) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const optimistic: Bubble = {
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
      // Roll the bubble back AND give the person their words back — losing
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

  if (!client) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ ...type.callout, color: colors.textMuted }}>No computer selected.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.top + 44}
    >
      {loading ? (
        <View style={{ paddingVertical: space.xl }}>
          <ActivityIndicator color={colors.textMuted} />
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        data={data}
        keyExtractor={(m, i) => m.id ?? String(i)}
        contentContainerStyle={{ padding: space.lg, gap: space.md }}
        keyboardDismissMode="interactive"
        renderItem={({ item }) => <MessageBubble message={item} />}
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

      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: space.sm,
          paddingHorizontal: space.lg,
          paddingTop: space.sm,
          paddingBottom: insets.bottom + space.sm,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.bg,
        }}
      >
        <TextInput
          value={draft}
          onChangeText={setDraft}
          // Steering a running agent and queueing a follow-up are different
          // intents; say which one this will be.
          placeholder={busy ? "Queue a follow-up…" : "Message the agent…"}
          placeholderTextColor={colors.textMuted}
          multiline
          style={{
            flex: 1,
            maxHeight: 120,
            minHeight: 38,
            backgroundColor: colors.card,
            borderRadius: radius.lg,
            paddingHorizontal: space.md,
            paddingTop: 9,
            paddingBottom: 9,
            color: colors.text,
            ...type.callout,
          }}
        />
        {busy ? (
          <Pressable
            onPress={() => void stop()}
            style={({ pressed }) => ({
              height: 38,
              paddingHorizontal: space.md,
              borderRadius: radius.lg,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: pressed ? colors.cardPressed : colors.secondary,
            })}
          >
            <Text style={{ ...type.footnote, color: colors.danger, fontWeight: "600" }}>Stop</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => void send()}
          disabled={!draft.trim() || sending}
          style={({ pressed }) => ({
            width: 38,
            height: 38,
            borderRadius: 19,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.primary,
            opacity: !draft.trim() || sending ? 0.35 : pressed ? 0.8 : 1,
          })}
        >
          {sending ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <Text style={{ color: colors.primaryForeground, fontSize: 18, fontWeight: "700" }}>
              {busy ? "+" : "↑"}
            </Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageBubble({ message }: { message: Bubble }) {
  const { colors, type, space, radius } = useTheme();
  const isUser = message.role === "user";
  const isSystem = message.role !== "user" && message.role !== "assistant";

  if (isSystem && !message.text) return null;

  return (
    <View
      style={{
        alignSelf: isUser ? "flex-end" : "flex-start",
        maxWidth: "88%",
        backgroundColor: isUser ? colors.primary : colors.card,
        borderRadius: radius.xl,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        opacity: message.pending ? 0.6 : 1,
      }}
    >
      {isSystem ? (
        <Text style={{ ...type.caption, color: colors.textMuted, marginBottom: 2 }}>
          {message.kind ?? "system"}
        </Text>
      ) : null}
      <Text
        selectable
        style={{
          ...type.callout,
          color: isUser ? colors.primaryForeground : colors.text,
          lineHeight: 21,
        }}
      >
        {message.text ?? (message.kind ? `[${message.kind}]` : "")}
        {message.streaming ? "▍" : ""}
      </Text>
    </View>
  );
}
