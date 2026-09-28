import { useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import Reanimated, { FadeIn, FadeOut } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { Icon, InlineVoiceRecorder } from "../components";
import {
  applyThreadMention,
  matchThreadMentions,
  threadMentionAt,
} from "../../../packages/protocol/src/threads";
import { useDictation } from "./dictation";
import { GlassSurface, LIQUID_GLASS } from "./glass";
import { PressableScale } from "./motion";
import { useOmg } from "./provider";
import { Text } from "./text";
import { useTheme } from "./theme";

/**
 * THE CHAT BAR'S GLASS SHELL: one owner for how the app's message field looks.
 *
 * The session screen's composer used to draw this inline. A thread needs the
 * same bar, so the shell lives here and both screens fill its slots with
 * their own controls. At rest it is a one-line pill with a leading and a
 * trailing control; expanded (focus, text, a dictation take) the field takes
 * the whole width and the actions move to a row under it.
 */
export function ChatBarShell({
  expanded,
  collapsedStart,
  collapsedEnd,
  expandedActions,
  children,
}: {
  expanded: boolean;
  /** At rest, before the field (the session's "+" menu). */
  collapsedStart?: ReactNode;
  /** At rest, after the field (the mic). */
  collapsedEnd?: ReactNode;
  /** Expanded, the row under the field. */
  expandedActions?: ReactNode;
  /** The field itself, usually a TextInput styled with chatBarInputStyle. */
  children: ReactNode;
}) {
  const { colors, space } = useTheme();
  return (
    <GlassSurface
      variant="regular"
      fallbackColor={colors.card}
      style={{
        flexDirection: expanded ? "column" : "row",
        // Centred at rest: one line of text should not sit on the floor of the box.
        alignItems: expanded ? "stretch" : "center",
        gap: expanded ? 14 : space.xs,
        borderRadius: expanded ? 32 : 24,
        borderCurve: "continuous",
        minHeight: 44,
        paddingHorizontal: expanded ? 14 : space.sm,
        paddingTop: expanded ? 14 : 8,
        paddingBottom: expanded ? 12 : 8,
        overflow: "hidden",
        // A flat fallback fill needs an edge, or it disappears into the page.
        ...(LIQUID_GLASS ? {} : { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border }),
      }}
    >
      {!expanded ? collapsedStart : null}
      <View
        style={{
          flex: expanded ? undefined : 1,
          width: expanded ? "100%" : undefined,
          flexDirection: "row",
          alignItems: "center",
        }}
      >
        {children}
      </View>
      {expanded ? (
        <View style={{ minHeight: 40, flexDirection: "row", alignItems: "center", gap: 8 }}>{expandedActions}</View>
      ) : (
        collapsedEnd
      )}
    </GlassSurface>
  );
}

/** The field's text: three lines, then it scrolls. Shared so every bar reads the same. */
export function useChatBarInputStyle(filled: boolean) {
  const { colors, type } = useTheme();
  return {
    flex: 1,
    maxHeight: 63,
    minHeight: 24,
    // Empty is one line now; a cleared multiline field otherwise keeps its old height for a beat.
    ...(filled ? {} : { height: 24 }),
    paddingTop: 0,
    paddingBottom: 0,
    color: colors.text,
    ...type.callout,
    fontSize: 16,
    lineHeight: 21,
  } as const;
}

/**
 * `@` in a thread: the members omg can be asked as, above the field, in the
 * same glass list as the session screen's `#` picker. Tapping one replaces
 * the `@word` with `@name `.
 */
export function AtMentionSuggest({ value, onChangeText }: { value: string; onChangeText: (next: string) => void }) {
  const { colors, type, space, radius } = useTheme();
  const at = threadMentionAt(value);
  const matches = at ? matchThreadMentions(at.query) : [];
  if (!at || !matches.length) return null;
  return (
    <Reanimated.View entering={FadeIn.duration(120)} exiting={FadeOut.duration(100)}>
      <GlassSurface
        variant="regular"
        fallbackColor={colors.popover}
        style={{
          borderRadius: radius.xl,
          overflow: "hidden",
          marginBottom: space.sm,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.borderSoft,
        }}
      >
        <ScrollView keyboardShouldPersistTaps="always" style={{ maxHeight: 220 }} contentContainerStyle={{ padding: 4 }}>
          {matches.map((mention, index) => (
            <PressableScale
              key={mention.name}
              testID={`at-mention-${mention.name}`}
              onPress={() => {
                void Haptics.selectionAsync();
                onChangeText(applyThreadMention(value, at, mention.name));
              }}
              dim={0.6}
              accessibilityRole="button"
              accessibilityLabel={`Mention ${mention.name}. ${mention.hint}`}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                paddingHorizontal: space.md,
                paddingVertical: 8,
                borderRadius: radius.md,
                backgroundColor: index === 0 ? colors.card : "transparent",
              }}
            >
              <View style={{ width: 24, height: 24, borderRadius: 6, backgroundColor: "#FF5530", alignItems: "center", justifyContent: "center" }}>
                <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{mention.name.slice(0, 1)}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ ...type.subhead, fontWeight: "600", color: colors.text }}>
                  <Text style={{ ...type.subhead, fontWeight: "600", color: colors.brand }}>@</Text>
                  {mention.name}
                </Text>
                <Text numberOfLines={1} style={{ ...type.caption, color: colors.textMuted }}>{mention.hint}</Text>
              </View>
            </PressableScale>
          ))}
        </ScrollView>
      </GlassSurface>
    </Reanimated.View>
  );
}

/**
 * A THREAD'S CHAT BAR: the session bar's shell, field, mic and send, with the
 * `@` picker above it. A finished dictation take sends, as in a session. No
 * attach menu: a thread message is text.
 */
export function ThreadChatBar({
  placeholder,
  onSend,
  testID,
  autoFocus,
  value,
  onChangeText,
}: {
  placeholder: string;
  onSend: (text: string) => Promise<void>;
  testID: string;
  autoFocus?: boolean;
  /** Controlled text, for a screen that fills the field itself (starter chips). */
  value?: string;
  onChangeText?: (text: string) => void;
}) {
  const { client } = useOmg();
  const { colors, space } = useTheme();
  const [own, setOwn] = useState("");
  const text = value ?? own;
  const setText = onChangeText ?? setOwn;
  const [focused, setFocused] = useState(false);
  const [sending, setSending] = useState(false);

  const send = async (override?: string) => {
    const body = (override ?? text).trim();
    if (!body || sending) return;
    setSending(true);
    setText("");
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await onSend(body);
    } catch {
      setText(body);
    } finally {
      setSending(false);
    }
  };
  // What is typed, for the dictation callback, which outlives a render.
  const textRef = useRef(text);
  textRef.current = text;
  // A finished take sends, with anything already typed in front of it.
  const dictation = useDictation(client?.transport ?? null, (said, meta) => {
    const next = textRef.current ? `${textRef.current} ${said}` : said;
    if (meta?.final === false) setText(next);
    else void send(next);
  });
  const tail = dictation.live && dictation.state === "recording" ? (dictation.partial ?? "").trim() : "";
  const canSend = text.trim().length > 0 && !sending;
  const expanded = focused || text.trim().length > 0 || dictation.state !== "idle";
  const inputStyle = useChatBarInputStyle(text.length > 0 || !!tail);

  const mic = (size: number, color: string) => (
    <Pressable
      key="thread-mic"
      onPress={dictation.toggle}
      accessibilityRole="button"
      accessibilityLabel="Dictate a message"
      hitSlop={8}
      style={({ pressed }) => ({ width: size, height: size, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
    >
      <Icon ios="mic" android="mic" size={18} color={color} />
    </Pressable>
  );

  return (
    <View style={{ paddingHorizontal: space.md, paddingTop: space.sm }}>
      <AtMentionSuggest value={text} onChangeText={setText} />
      <ChatBarShell
        expanded={expanded}
        collapsedEnd={mic(32, colors.textMuted)}
        expandedActions={
          dictation.state === "idle" ? (
            <>
              <View style={{ flex: 1 }} />
              {mic(34, colors.textSecondary)}
              <Pressable
                testID={`${testID}-send`}
                onPress={() => void send()}
                disabled={!canSend}
                accessibilityRole="button"
                accessibilityLabel="Send the message"
                accessibilityState={{ disabled: !canSend, busy: sending }}
                style={({ pressed }) => ({
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: canSend ? colors.foreground : colors.secondary,
                  opacity: pressed ? 0.75 : 1,
                })}
              >
                <Icon ios="arrow.up" android="arrow_upward" size={17} weight="semibold" color={canSend ? colors.bg : colors.textMuted} />
              </Pressable>
            </>
          ) : (
            <InlineVoiceRecorder state={dictation.state} level={dictation.level} onCancel={dictation.cancel} onConfirm={dictation.toggle} />
          )
        }
      >
        <TextInput
          testID={testID}
          autoFocus={autoFocus}
          value={tail ? `${text}${text ? " " : ""}${tail}` : text}
          onChangeText={setText}
          editable={!tail}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          multiline
          returnKeyType="send"
          submitBehavior="submit"
          onSubmitEditing={() => {
            if (canSend) void send();
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={inputStyle}
        />
      </ChatBarShell>
    </View>
  );
}
