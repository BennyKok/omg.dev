/**
 * The sign-in drawer, over the prompt.
 *
 * "Save your first task." is doing real work as a title: it says what signing
 * in is FOR at the only moment the person has something to lose. The prompt
 * stays visible behind it, dimmed, for the same reason.
 *
 * ── Dismissing returns to the prompt ──────────────────────────────────────
 *
 * Not to the task list, and not to a cleared editor. The close button and the
 * scrim both mean "not yet", and the text is owned above this component so
 * neither can drop it.
 *
 * ── No promise here ───────────────────────────────────────────────────────
 *
 * The design had "Sign in to start. Your task is on us." and Benny removed the
 * second sentence. This is the last screen before an account exists and the
 * likeliest place for a claim to be read as a commitment, so it stays out.
 *
 * Design: artboard "03 · Sign-in drawer · After prompt".
 */
import { Pressable, View } from "react-native";

import { Icon } from "../components";
import { Sheet } from "./sheet";
import { Text } from "./text";
import { useTheme } from "./theme";

export type SignInMethod = "apple" | "google" | "email";

export function SignInDrawer({
  visible,
  onClose,
  onChoose,
  onTerms,
  onPrivacy,
}: {
  visible: boolean;
  onClose: () => void;
  onChoose: (method: SignInMethod) => void;
  onTerms: () => void;
  onPrivacy: () => void;
}) {
  const { colors, space, type } = useTheme();

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ paddingHorizontal: space.lg + 4, paddingBottom: space.xl, gap: space.lg }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
          <View style={{ flex: 1, gap: space.xs }}>
            <Text style={{ ...type.title, color: colors.text }}>Save your first task.</Text>
            <Text style={{ ...type.body, color: colors.textMuted }}>Sign in to start.</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            hitSlop={12}
            style={({ pressed }) => ({
              width: 30,
              height: 30,
              borderRadius: 15,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.card,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Icon ios="xmark" android="close" size={13} color={colors.textMuted} />
          </Pressable>
        </View>

        <View style={{ gap: space.sm }}>
          {/* Apple first, and filled. It is the one Apple requires alongside
              any other third-party sign-in, and the one most people will use. */}
          <Method filled label="Continue with Apple" glyph="apple" onPress={() => onChoose("apple")} />
          <Method label="Continue with Google" onPress={() => onChoose("google")} />
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => onChoose("email")}
          hitSlop={8}
          style={({ pressed }) => ({ alignItems: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <Text style={{ ...type.headline, color: colors.text }}>Continue with email</Text>
        </Pressable>

        <Text style={{ ...type.footnote, color: colors.textMuted, textAlign: "center" }}>
          By continuing, you agree to our{" "}
          <Text onPress={onTerms} style={{ ...type.footnote, color: colors.text }}>
            Terms of Service
          </Text>
          {" and "}
          <Text onPress={onPrivacy} style={{ ...type.footnote, color: colors.text }}>
            Privacy Policy
          </Text>
          .
        </Text>
      </View>
    </Sheet>
  );
}

function Method({
  label,
  onPress,
  filled = false,
  glyph,
}: {
  label: string;
  onPress: () => void;
  filled?: boolean;
  glyph?: "apple";
}) {
  const { colors, radius, type } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        height: 56,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        borderRadius: radius.xl,
        backgroundColor: filled ? colors.text : "transparent",
        borderWidth: filled ? 0 : 1,
        borderColor: colors.border,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {glyph === "apple" ? <Icon ios="apple.logo" android="phone_iphone" size={17} color={colors.bg} /> : null}
      <Text style={{ ...type.headline, color: filled ? colors.bg : colors.text }}>{label}</Text>
    </Pressable>
  );
}
