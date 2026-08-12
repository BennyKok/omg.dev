import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { sendSignInCode, verifySignInCode } from "../src/omg/auth";
import { useOmg } from "../src/omg/provider";
import { useTheme } from "../src/omg/theme";

const RESEND_DELAY_SECONDS = 60;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Try again.";
}

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const { refreshSession } = useOmg();
  const { colors, radius, space, type } = useTheme();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [resendSeconds, setResendSeconds] = useState(0);
  const codeInput = useRef<TextInput>(null);

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
  const canSubmit = step === "email" ? emailIsValid && !busy : codeIsValid && !busy;

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
          <View style={[styles.mark, { backgroundColor: colors.brand }]}>
            <View style={[styles.markBite, { backgroundColor: colors.bg }]} />
          </View>

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

          {error ? (
            <Text accessibilityLiveRegion="polite" style={[type.footnote, styles.error, { color: colors.danger }]}>
              {error}
            </Text>
          ) : null}
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
  mark: {
    borderRadius: 999,
    height: 54,
    overflow: "hidden",
    width: 54,
  },
  markBite: {
    borderRadius: 999,
    height: 21,
    position: "absolute",
    right: -4,
    top: -4,
    width: 21,
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
});
