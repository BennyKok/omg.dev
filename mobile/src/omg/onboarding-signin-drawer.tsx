/**
 * The sign-in drawer, over the Welcome screen. IT SIGNS IN HERE.
 *
 * "Get started" opens it (Benny, 2026-09-24). It used to sit after the
 * questionnaire, so a returning customer had to walk three screens to reach
 * it. Now it is the second thing anybody sees, and it serves both cases: an
 * existing account signs in and goes straight to the app, a new one is
 * created and continues into the questions while its Computer starts.
 *
 * ── No promise here ───────────────────────────────────────────────────────
 *
 * The design had "Sign in to start. Your task is on us." and Benny removed the
 * second sentence. This is the last screen before an account exists and the
 * likeliest place for a claim to be read as a commitment, so it stays out.
 *
 * ── Apple and Google finish in this sheet ─────────────────────────────────
 *
 * They used to hand the choice up and land on the full sign-in screen, so
 * tapping "Continue with Apple" produced a different screen with another
 * "Continue with Apple" on it. Bouncing to a second screen to repeat the same
 * tap is pointless.
 *
 * Email still hands up, and that is not an inconsistency: email is a code sent
 * and typed back, which needs a field, a keyboard and a second step. There is
 * nothing to do in place.
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Pressable, View } from "react-native";
import * as Haptics from "expo-haptics";

import { Icon } from "../components";
import { useOmg } from "./provider";
import { Sheet } from "./sheet";
import {
  appleSignInAvailable,
  googleSignInConfigured,
  signInWithApple,
  signInWithGoogle,
} from "./social-sign-in";
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
  /** Only ever called with "email": the one method that needs another screen. */
  onChoose: (method: SignInMethod) => void;

  onTerms: () => void;
  onPrivacy: () => void;
}) {
  const { colors, space, type } = useTheme();
  const { refreshSession } = useOmg();
  const [busy, setBusy] = useState<"apple" | "google" | null>(null);
  const [error, setError] = useState<string | null>(null);
  /*
   * Apple is not offered where it cannot work -- a simulator without an Apple
   * account, or any non-iOS host. Google is hidden when the build has no
   * client id, which is the state every OTA used to ship in.
   */
  const [appleAvailable, setAppleAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void appleSignInAvailable().then((ok) => {
      if (!cancelled) setAppleAvailable(ok);
    });
    return () => { cancelled = true; };
  }, []);

  const authenticate = async (provider: "apple" | "google") => {
    if (busy) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setBusy(provider);
    setError(null);
    try {
      const user = provider === "apple" ? await signInWithApple() : await signInWithGoogle();
      // A dismissed sheet resolves to null. That is a decision, not a failure,
      // and it leaves the drawer exactly as it was.
      if (!user) return;
      await refreshSession();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // Nothing closes the drawer here. `refreshSession` flips authStatus and
      // the whole signed-out tree, this sheet included, is replaced.
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not sign in. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={{ paddingHorizontal: space.lg + 4, paddingBottom: space.xl, gap: space.lg }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
          <View style={{ flex: 1, gap: space.xs }}>
            <Text style={{ ...type.title, color: colors.text }}>Get started.</Text>
            <Text style={{ ...type.body, color: colors.textMuted }}>Sign in, or create your account.</Text>
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
          {appleAvailable ? (
            <Method
              filled
              label="Continue with Apple"
              glyph="apple"
              busy={busy === "apple"}
              disabled={busy !== null}
              onPress={() => void authenticate("apple")}
            />
          ) : null}
          {googleSignInConfigured ? (
            <Method
              label="Continue with Google"
              glyph="google"
              busy={busy === "google"}
              disabled={busy !== null}
              onPress={() => void authenticate("google")}
            />
          ) : null}
        </View>

        {error ? (
          <Text style={{ ...type.footnote, color: colors.danger, textAlign: "center" }}>{error}</Text>
        ) : null}

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
  busy = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  filled?: boolean;
  glyph?: "apple" | "google";
  busy?: boolean;
  disabled?: boolean;
}) {
  const { colors, radius, type } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
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
      {busy ? (
        <ActivityIndicator color={filled ? colors.bg : colors.text} />
      ) : (
        <>
          {glyph === "apple" ? <Icon ios="apple.logo" android="phone_iphone" size={17} color={colors.bg} /> : null}
          {/* Google's own asset, not a redraw and not recoloured. Their
              branding guidelines require the G keep its standard colour
              gradient and its aspect ratio, so this is their PNG padded into
              a square and drawn with `contain`. Tinting it or rebuilding it
              from paths would break the one rule they state plainly. */}
          {glyph === "google" ? (
            <Image
              source={require("../../assets/brand/google-g.png")}
              style={{ width: 18, height: 18 }}
              resizeMode="contain"
            />
          ) : null}
          <Text style={{ ...type.headline, color: filled ? colors.bg : colors.text }}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}
