import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Text, TextInput, type TextInputHandle } from "../src/omg/text";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BrandMark } from "../src/omg/brand-mark";
import { sendSignInCode, verifySignInCode } from "../src/omg/auth";
import {
  buildImessageSmsUrl,
  finishImessageSignIn,
  imessageSignInBody,
  startImessageSignIn,
  type ImessageChallenge,
} from "../src/omg/imessage-auth";
import { useOmg } from "../src/omg/provider";
import { useTheme } from "../src/omg/theme";
import { useToast } from "../src/omg/toast";

const RESEND_DELAY_SECONDS = 60;
const IMESSAGE_POLL_MS = 2_500;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

type ImessagePhase = "idle" | "starting" | "waiting" | "finishing";

/**
 * "Continue with iMessage" — start a challenge, deep-link into Messages with
 * the code pre-filled, then poll `finish` until the gateway approves it.
 * Mirrors the web client's state machine; the code is also shown on screen as
 * a fallback when the deep link cannot carry the body.
 */
function ImessageSignInSection({
  disabled,
  onAuthenticated,
  onBusyChange,
  onError,
}: {
  disabled: boolean;
  onAuthenticated: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
  onError: (message: string | null) => void;
}) {
  const { colors, radius, space, type } = useTheme();
  const [challenge, setChallenge] = useState<ImessageChallenge | null>(null);
  const [phase, setPhase] = useState<ImessagePhase>("idle");
  const [copied, setCopied] = useState(false);
  const finishingRef = useRef(false);
  const activeSecretRef = useRef<string | null>(null);

  const busy = phase !== "idle";
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);

  const reset = useCallback(() => {
    activeSecretRef.current = null;
    finishingRef.current = false;
    setChallenge(null);
    setPhase("idle");
    setCopied(false);
  }, []);

  const finish = useCallback(async () => {
    if (!challenge || finishingRef.current) return;
    if (new Date(challenge.expiresAt).getTime() <= Date.now()) {
      reset();
      onError("That sign-in code expired. Try again.");
      return;
    }
    finishingRef.current = true;
    setPhase("finishing");
    try {
      const status = await finishImessageSignIn(challenge);
      if (activeSecretRef.current !== challenge.secret) return;
      if (status === "pending") {
        setPhase("waiting");
        return;
      }
      reset();
      await onAuthenticated();
    } catch (finishError) {
      const message = errorMessage(finishError);
      if (activeSecretRef.current !== challenge.secret) return;
      if (/expired|invalid sign-in challenge/i.test(message)) {
        reset();
        onError(message);
      } else {
        // A cold radio does not mean the challenge failed. Keep waiting and
        // let the next poll (or the return from Messages) try again.
        setPhase("waiting");
      }
    } finally {
      finishingRef.current = false;
    }
  }, [challenge, onAuthenticated, onError, reset]);

  useEffect(() => {
    if (!challenge) return;
    void finish();
    const interval = setInterval(() => void finish(), IMESSAGE_POLL_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void finish();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [challenge, finish]);

  const start = useCallback(async () => {
    onError(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPhase("starting");
    try {
      const next = await startImessageSignIn();
      activeSecretRef.current = next.secret;
      setChallenge(next);
      setPhase("waiting");
      void Linking.openURL(buildImessageSmsUrl(imessageSignInBody(next.code))).catch(() => {});
    } catch (startError) {
      reset();
      onError(errorMessage(startError));
    }
  }, [onError, reset]);

  const openMessages = useCallback(() => {
    if (!challenge) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void Linking.openURL(buildImessageSmsUrl(imessageSignInBody(challenge.code))).catch(() => {});
  }, [challenge]);

  const copyCode = useCallback(async () => {
    if (!challenge) return;
    await Clipboard.setStringAsync(challenge.code);
    setCopied(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => setCopied(false), 2_000);
  }, [challenge]);

  if (!challenge) {
    return (
      <Pressable
        accessibilityRole="button"
        disabled={disabled || phase === "starting"}
        onPress={() => void start()}
        style={({ pressed }) => [
          styles.button,
          {
            backgroundColor: colors.secondary,
            borderColor: colors.borderStrong,
            borderRadius: radius.lg,
            borderWidth: StyleSheet.hairlineWidth,
            opacity: disabled || phase === "starting" ? 0.45 : pressed ? 0.82 : 1,
          },
        ]}
      >
        {phase === "starting" ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <Text style={[type.headline, { color: colors.text }]}>Continue with iMessage</Text>
        )}
      </Pressable>
    );
  }

  return (
    <View
      style={[
        styles.imessageCard,
        {
          backgroundColor: colors.card,
          borderColor: colors.borderStrong,
          borderRadius: radius.lg,
          padding: space.lg,
        },
      ]}
    >
      <Text style={[type.footnote, { color: colors.textMuted, textAlign: "center" }]}>
        Text this code to omg — it is already filled in for you in Messages.
      </Text>
      <Text
        allowFontScaling
        selectable
        style={[
          styles.imessageCode,
          { color: colors.text },
        ]}
      >
        {challenge.code}
      </Text>

      <View style={styles.imessageWaiting}>
        {phase === "finishing" || phase === "waiting" ? (
          <ActivityIndicator color={colors.textMuted} size="small" />
        ) : null}
        <Text style={[type.footnote, { color: colors.textMuted }]}>
          {phase === "finishing" ? "Signing in…" : "Waiting for your message…"}
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={openMessages}
        style={({ pressed }) => [
          styles.button,
          styles.imessageAction,
          {
            backgroundColor: colors.primary,
            borderRadius: radius.lg,
            opacity: pressed ? 0.82 : 1,
          },
        ]}
      >
        <Text style={[type.headline, { color: colors.primaryForeground }]}>Open Messages</Text>
      </Pressable>

      <View style={styles.imessageSecondaryRow}>
        <Pressable accessibilityRole="button" onPress={() => void copyCode()}>
          <Text style={[type.footnote, { color: colors.textSecondary }]}>
            {copied ? "Copied" : "Copy code"}
          </Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={reset}>
          <Text style={[type.footnote, { color: colors.textSecondary }]}>Cancel</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const { refreshSession } = useOmg();
  const { colors, radius, space, type } = useTheme();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => {
    if (error) toast.show(error, { intent: "error" });
  }, [error, toast]);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const [imessageBusy, setImessageBusy] = useState(false);
  const codeInput = useRef<TextInputHandle>(null);

  const normalizedEmail = email.trim().toLowerCase();
  const emailIsValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
  const codeIsValid = /^\d{6}$/.test(code);

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timer = setInterval(() => {
      setResendSeconds((remaining) => Math.max(0, remaining - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [resendSeconds > 0]);

  const requestCode = useCallback(async () => {
    if (!emailIsValid || sending) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSending(true);
    setError(null);
    try {
      await sendSignInCode(normalizedEmail);
      setStep("code");
      setCode("");
      setResendSeconds(RESEND_DELAY_SECONDS);
      requestAnimationFrame(() => codeInput.current?.focus());
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSending(false);
    }
  }, [emailIsValid, normalizedEmail, sending]);

  const resendCode = useCallback(async () => {
    if (resendSeconds > 0 || sending) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSending(true);
    setError(null);
    try {
      await sendSignInCode(normalizedEmail);
      setResendSeconds(RESEND_DELAY_SECONDS);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSending(false);
    }
  }, [normalizedEmail, resendSeconds, sending]);

  const signIn = useCallback(async () => {
    if (!codeIsValid || verifying) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setVerifying(true);
    setError(null);
    try {
      await verifySignInCode(normalizedEmail, code);
      await refreshSession();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (signInError) {
      setError(errorMessage(signInError));
    } finally {
      setVerifying(false);
    }
  }, [code, codeIsValid, normalizedEmail, refreshSession, verifying]);

  const useDifferentEmail = useCallback(() => {
    setStep("email");
    setCode("");
    setError(null);
    setResendSeconds(0);
  }, []);

  const busy = sending || verifying;
  const canSubmit = step === "email" ? emailIsValid && !busy && !imessageBusy : codeIsValid && !busy;

  const imessageAuthenticated = useCallback(async () => {
    await refreshSession();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [refreshSession]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={[styles.screen, { backgroundColor: colors.bg }]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingBottom: Math.max(insets.bottom, space.xl),
            paddingLeft: Math.max(insets.left, space.xl),
            paddingRight: Math.max(insets.right, space.xl),
            paddingTop: Math.max(insets.top, space.xxl) + space.xl,
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.top}>
          {/* The shared mark, not a local copy. The copy that used to live here
              put the bite at right/top -4, hanging it off the rim — the exact
              "chipped coin" BrandMark's geometry notes warn about. */}
          <BrandMark size={54} />

          <Text style={[type.largeTitle, styles.title, { color: colors.text }]}>Welcome to omg</Text>
          <Text style={[type.footnote, styles.helper, { color: colors.textMuted }]}>
            {step === "email"
              ? "Sign in to reach your Computer from anywhere."
              : `Enter the 6-digit code sent to ${normalizedEmail}.`}
          </Text>

          {step === "email" ? (
            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              editable={!busy}
              inputMode="email"
              keyboardType="email-address"
              onChangeText={(value) => {
                setEmail(value);
                setError(null);
              }}
              onSubmitEditing={() => void requestCode()}
              placeholder="Email address"
              placeholderTextColor={colors.textMuted}
              returnKeyType="next"
              style={[
                type.body,
                styles.field,
                {
                  backgroundColor: colors.fieldFill,
                  borderColor: error ? colors.danger : colors.borderStrong,
                  borderRadius: radius.lg,
                  color: colors.text,
                },
              ]}
              textContentType="emailAddress"
              value={email}
            />
          ) : (
            <>
              <TextInput
                ref={codeInput}
                autoComplete="one-time-code"
                editable={!busy}
                keyboardType="number-pad"
                maxLength={6}
                onChangeText={(value) => {
                  setCode(value.replace(/\D/g, "").slice(0, 6));
                  setError(null);
                }}
                onSubmitEditing={() => void signIn()}
                placeholder="000000"
                placeholderTextColor={colors.textMuted}
                returnKeyType="done"
                style={[
                  type.title,
                  styles.field,
                  styles.codeField,
                  {
                    backgroundColor: colors.fieldFill,
                    borderColor: error ? colors.danger : colors.borderStrong,
                    borderRadius: radius.lg,
                    color: colors.text,
                  },
                ]}
                textContentType="oneTimeCode"
                value={code}
              />

              <View style={styles.codeActions}>
                <Pressable disabled={busy} onPress={useDifferentEmail}>
                  <Text style={[type.footnote, { color: busy ? colors.textMuted : colors.textSecondary }]}>
                    Use a different email
                  </Text>
                </Pressable>
                <Pressable disabled={busy || resendSeconds > 0} onPress={() => void resendCode()}>
                  <Text
                    style={[
                      type.footnote,
                      { color: busy || resendSeconds > 0 ? colors.textMuted : colors.textSecondary },
                    ]}
                  >
                    {resendSeconds > 0 ? `Resend in ${resendSeconds}s` : "Resend code"}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={!canSubmit}
          onPress={() => void (step === "email" ? requestCode() : signIn())}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: colors.primary,
              borderRadius: radius.lg,
              opacity: canSubmit ? (pressed ? 0.82 : 1) : 0.45,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={[type.headline, { color: colors.primaryForeground }]}>
              {step === "email" ? "Continue" : "Sign in"}
            </Text>
          )}
        </Pressable>

        {step === "email" ? (
          <>
            <View style={styles.dividerRow}>
              <View style={[styles.dividerLine, { backgroundColor: colors.borderStrong }]} />
              <Text style={[type.footnote, { color: colors.textMuted }]}>or</Text>
              <View style={[styles.dividerLine, { backgroundColor: colors.borderStrong }]} />
            </View>
            <ImessageSignInSection
              disabled={busy}
              onAuthenticated={imessageAuthenticated}
              onBusyChange={setImessageBusy}
              onError={setError}
            />
          </>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: "space-between",
  },
  top: {
    width: "100%",
  },
  title: {
    marginTop: 32,
  },
  helper: {
    lineHeight: 19,
    marginTop: 10,
    maxWidth: 320,
  },
  field: {
    borderWidth: StyleSheet.hairlineWidth,
    height: 54,
    marginTop: 32,
    paddingHorizontal: 16,
  },
  codeField: {
    letterSpacing: 8,
    textAlign: "center",
  },
  codeActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 14,
  },
  error: {
    lineHeight: 18,
    marginTop: 14,
  },
  button: {
    alignItems: "center",
    height: 50,
    justifyContent: "center",
    marginTop: 32,
    width: "100%",
  },
  dividerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    marginTop: 24,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  imessageCard: {
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 24,
    width: "100%",
  },
  imessageCode: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    fontSize: 32,
    fontWeight: "700",
    letterSpacing: 4,
    marginTop: 12,
    textAlign: "center",
  },
  imessageWaiting: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    marginTop: 12,
  },
  imessageAction: {
    marginTop: 16,
  },
  imessageSecondaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 14,
    paddingHorizontal: 4,
  },
});
