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

import { Icon } from "../src/components";
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

/**
 * Geometry for the field-embedded submit button (email step and code step
 * both use it). Named so the button's position is DERIVED from the same
 * numbers the field itself uses, instead of two places agreeing by
 * coincidence.
 *
 * `top: 0, bottom: 0, margin: "auto"` used to be how this button was
 * centered, and it does not actually center here: with an explicit `height`
 * on an absolutely positioned view, Yoga resolves the auto margins to 0
 * rather than splitting the leftover space, so the button sat flush against
 * the field's top edge with all the slack dumped below it — nearly touching
 * the top of the rounded corner while floating well clear of the bottom.
 * That is the "crowding the corner" look, on every field regardless of
 * content, keyboard state, or color scheme, because it's a layout bug, not a
 * spacing-in-this-one-screenshot bug. An explicit computed `top` sidesteps
 * the auto-margin behavior entirely instead of depending on it.
 */
const FIELD_HEIGHT = 54;
const FIELD_ACTION_SIZE = 36;
const FIELD_ACTION_INSET = 8;

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

  /**
   * `submitted` lets the auto-submit hand over the digits it just read, rather
   * than racing `code` state that has not re-rendered yet — the six characters
   * are in hand at the call site and waiting for React to agree is how an
   * auto-submit verifies five of them.
   */
  const signIn = useCallback(async (submitted?: string) => {
    const entered = (submitted ?? code).replace(/\D/g, "").slice(0, 6);
    if (entered.length !== 6 || verifying) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setVerifying(true);
    setError(null);
    try {
      await verifySignInCode(normalizedEmail, entered);
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

          {/*
           * "omg.dev", not "omg" — the brand name wherever it's spelled out.
           * The web app's hosted brand chip (App.tsx's ProductBrand) renders
           * "omg.dev" as one uniformly-styled string: no distinct weight,
           * colour, or opacity split for ".dev". So this is wording only —
           * keep the existing largeTitle/colors.text treatment rather than
           * inventing a two-tone style nothing else here uses.
           */}
          <Text style={[type.largeTitle, styles.title, { color: colors.text }]}>Welcome to omg.dev</Text>
          <Text style={[type.footnote, styles.helper, { color: colors.textMuted }]}>
            {step === "email"
              ? "Sign in to reach your Computer from anywhere."
              : `Enter the 6-digit code sent to ${normalizedEmail}.`}
          </Text>

          {step === "email" ? (
            /**
             * THE SUBMIT LIVES IN THE FIELD, copied from the dashboard's own
             * sign-in (apps/web/src/components/auth/email-otp-form.tsx).
             *
             * The phone had a full-width Continue button 32pt below the input,
             * which is a second object to look at for an action the field
             * already implies — and on a tall screen it was the thing that
             * left the form scattered down the page. One rounded field with an
             * arrow inside it says the same thing in one shape, and it is the
             * shape this app already uses everywhere else to send something.
             *
             * The arrow only exists once there is an address, exactly as the
             * web fades it in: an enabled-looking button that does nothing is
             * worse than no button.
             */
            <View style={styles.fieldWrap}>
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
                placeholder="you@example.com"
                placeholderTextColor={colors.textMuted}
                returnKeyType="go"
                style={[
                  type.body,
                  styles.field,
                  {
                    backgroundColor: colors.fieldFill,
                    borderColor: error ? colors.danger : colors.borderStrong,
                    borderRadius: radius.xl,
                    color: colors.text,
                  },
                ]}
                textContentType="emailAddress"
                value={email}
              />
              {canSubmit ? (
                <Pressable
                  accessibilityLabel="Send sign-in code"
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => void requestCode()}
                  style={({ pressed }) => [
                    styles.fieldAction,
                    { backgroundColor: colors.primary, opacity: pressed ? 0.82 : 1 },
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator color={colors.primaryForeground} size="small" />
                  ) : (
                    <Icon android="arrow_upward" color={colors.primaryForeground} ios="arrow.up" size={16} />
                  )}
                </Pressable>
              ) : null}
            </View>
          ) : (
            <>
              <View style={styles.fieldWrap}>
                <TextInput
                  ref={codeInput}
                  autoComplete="one-time-code"
                  editable={!busy}
                  keyboardType="number-pad"
                  maxLength={6}
                  onChangeText={(value) => {
                    const digits = value.replace(/\D/g, "").slice(0, 6);
                    setCode(digits);
                    setError(null);
                    // SIX DIGITS IS THE WHOLE ANSWER, so it submits itself —
                    // the dashboard does the same. Making someone press a
                    // button after typing the last digit of a code they just
                    // read off a screen is asking them to confirm a thing they
                    // cannot have meant differently.
                    if (digits.length === 6 && !busy) void signIn(digits);
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
                      borderRadius: radius.xl,
                      color: colors.text,
                    },
                  ]}
                  textContentType="oneTimeCode"
                  value={code}
                />
                {code.length === 6 ? (
                  <Pressable
                    accessibilityLabel="Sign in"
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => void signIn()}
                    style={({ pressed }) => [
                      styles.fieldAction,
                      { backgroundColor: colors.primary, opacity: pressed ? 0.82 : 1 },
                    ]}
                  >
                    {busy ? (
                      <ActivityIndicator color={colors.primaryForeground} size="small" />
                    ) : (
                      <Icon android="arrow_upward" color={colors.primaryForeground} ios="arrow.up" size={16} />
                    )}
                  </Pressable>
                ) : null}
              </View>

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

        {step === "email" ? (
          <>
            <View style={styles.spacer} />
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
    /**
     * NO `space-between` HERE.
     *
     * The container has three children — the form, the primary button, and
     * the "or / iMessage" alternative — and space-between hands each GAP an
     * equal share of whatever is left over. On a tall phone with a short form
     * that is three arbitrary voids: the field floating a hundred points above
     * its own Continue button, and the divider stranded in the middle of
     * nothing. It only ever looked right on a screen whose content happened to
     * fill it.
     *
     * The form stays together at the top and the alternative is pushed to the
     * bottom by ONE deliberate spacer, so there is exactly one flexible gap
     * and it is where a gap belongs.
     */
    flexGrow: 1,
  },
  /** The field and the button that lives inside its trailing edge. */
  fieldWrap: {
    justifyContent: "center",
    marginTop: 24,
    width: "100%",
  },
  fieldAction: {
    alignItems: "center",
    borderRadius: FIELD_ACTION_SIZE / 2,
    height: FIELD_ACTION_SIZE,
    justifyContent: "center",
    position: "absolute",
    right: FIELD_ACTION_INSET,
    // Explicit, not `top: 0, bottom: 0, margin: "auto"` — see FIELD_HEIGHT's
    // comment. This is the number that actually centers it.
    top: (FIELD_HEIGHT - FIELD_ACTION_SIZE) / 2,
    width: FIELD_ACTION_SIZE,
  },
  /** The single flexible gap: everything above it groups, everything below sits at the foot. */
  spacer: {
    flex: 1,
    minHeight: 28,
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
    height: FIELD_HEIGHT,
    // The margin belongs to the wrapper now, or the absolutely positioned
    // button inside it would be offset by it too.
    paddingHorizontal: 16,
    // Room for the arrow that sits at the trailing edge: FIELD_ACTION_SIZE
    // for the button, FIELD_ACTION_INSET on either side of it.
    paddingRight: FIELD_ACTION_SIZE + FIELD_ACTION_INSET * 2,
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
    // Close to the field it submits. 32 was the gap that made sense when
    // space-between was also pushing them apart; without that it is just far.
    marginTop: 20,
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
