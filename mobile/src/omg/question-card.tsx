import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { Text, TextInput } from "./text";
import { useTheme } from "./theme";

/**
 * The agent asked something — answering has to be one tap, and that tap has
 * to actually answer.
 *
 * IT IS THE LAST THING IN THE TRANSCRIPT, not a tray on the composer. It used
 * to live inside the floating composer, because laid out in the normal flow it
 * landed UNDER the absolutely positioned bar and the field covered the
 * question and most of its answers. Floating it fixed that and bought a worse
 * problem: a question is a turn in the conversation, and parked on the
 * composer it covered the message that explains why the agent is asking, then
 * stayed there while you scrolled. It now renders in the list's footer, which
 * is inside the scroller and above the space the transcript already reserves
 * at its end, so it arrives where the newest turn arrives and scrolls with it.
 * Used for a native prompt from the transcript socket and for an ask-user
 * question from /api/ask alike.
 */
export function QuestionCard({
  question,
  options,
  onAnswer,
  onDismiss,
  secretKey,
  onSaveSecret,
}: {
  question?: string | null;
  options: { index: number; label: string }[];
  onAnswer: (label: string) => void;
  /** Ask-user questions can be closed unanswered. A native prompt cannot. */
  onDismiss?: () => void;
  /** Set for a secure ask: shows a password field instead of the composer. */
  secretKey?: string | null;
  onSaveSecret?: (value: string) => Promise<boolean>;
}) {
  const { colors, type, space } = useTheme();
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!onSaveSecret || !secret.trim() || saving) return;
    setSaving(true);
    const ok = await onSaveSecret(secret);
    setSaving(false);
    if (ok) setSecret("");
  };
  return (
    <View
      style={{
        padding: space.md,
        backgroundColor: colors.card,
        // Same 16 as the website login row above it. It used to be 32, to
        // match the expanded composer it was parked on; now that both cards
        // stand in the transcript, the thing it has to agree with is the
        // other card, and two different corner radii on two stacked cards
        // read as two unrelated surfaces.
        borderRadius: 16,
        borderCurve: "continuous",
        borderWidth: StyleSheet.hairlineWidth,
        // borderStrong: this is a card the transcript can hand you at any
        // moment, asking for a tap that unblocks the agent — it needs to
        // read as a distinct surface immediately, not the .35-alpha
        // border that "reads as a rumour against black" everywhere else
        // it was tried (see SessionCard's own note on the home screen).
        borderColor: colors.borderStrong,
        gap: space.sm,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
        {question ? <Text style={{ ...type.callout, color: colors.text, flex: 1 }}>{question}</Text> : <View style={{ flex: 1 }} />}
        {onDismiss ? (
          // Always visible: a question you cannot clear owns the chat. The
          // hit area is 44pt; the glyph stays small so it reads as chrome.
          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss question"
            accessibilityHint="The agent stops waiting for an answer"
            hitSlop={10}
            style={({ pressed }) => ({
              width: 24,
              height: 24,
              marginTop: -2,
              marginRight: -4,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 12,
              backgroundColor: pressed ? colors.cardPressed : "transparent",
            })}
          >
            <SymbolView name="xmark" size={13} weight="semibold" tintColor={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {secretKey && onSaveSecret ? (
        <View style={{ gap: space.xs }}>
          <Text style={{ ...type.caption, color: colors.textMuted }}>{secretKey}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <TextInput
              value={secret}
              onChangeText={setSecret}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              textContentType="password"
              placeholder="Paste the value"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel={`Value for ${secretKey}`}
              returnKeyType="done"
              onSubmitEditing={() => void save()}
              style={{
                flex: 1,
                minHeight: 40,
                paddingHorizontal: space.md,
                borderRadius: 12,
                borderCurve: "continuous",
                backgroundColor: colors.secondary,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: colors.borderStrong,
                color: colors.text,
                ...type.callout,
              }}
            />
            <Pressable
              onPress={() => void save()}
              disabled={!secret.trim() || saving}
              accessibilityRole="button"
              accessibilityLabel={`Save ${secretKey}`}
              style={({ pressed }) => ({
                minHeight: 40,
                justifyContent: "center",
                paddingHorizontal: space.md,
                borderRadius: 32,
                borderCurve: "continuous",
                backgroundColor: pressed ? colors.cardPressed : colors.secondary,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: colors.borderStrong,
                opacity: !secret.trim() || saving ? 0.5 : 1,
              })}
            >
              {saving ? <ActivityIndicator size="small" /> : <Text style={{ ...type.footnote, color: colors.text }}>Save</Text>}
            </Pressable>
          </View>
          <Text style={{ ...type.caption, color: colors.textMuted }}>
            Saved to the project .env and the hosted app. The agent sees the name only.
          </Text>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {options.map((opt) => (
          <Pressable
            key={opt.index}
            onPress={() => onAnswer(opt.label)}
            accessibilityRole="button"
            style={({ pressed }) => ({
              minHeight: 36,
              justifyContent: "center",
              paddingHorizontal: space.md,
              paddingVertical: space.sm,
              borderRadius: 32,
              borderCurve: "continuous",
              backgroundColor: pressed ? colors.cardPressed : colors.secondary,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: colors.borderStrong,
            })}
          >
            <Text style={{ ...type.footnote, color: colors.text }}>{opt.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
