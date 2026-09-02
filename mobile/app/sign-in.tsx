import * as AppleAuthentication from "expo-apple-authentication";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { Text, TextInput, type TextInputHandle } from "../src/omg/text";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon, PrimaryButton } from "../src/components";
import { BrandMark } from "../src/omg/brand-mark";
import { sendSignInCode, verifySignInCode } from "../src/omg/auth";
import {
  appleSignInAvailable,
  googleSignInConfigured,
  signInWithApple,
  signInWithGoogle,
} from "../src/omg/social-sign-in";
import { useOmg } from "../src/omg/provider";
import { useTheme } from "../src/omg/theme";
import { useToast } from "../src/omg/toast";

const RESEND_DELAY_SECONDS = 60;

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


export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const { refreshSession } = useOmg();
  const { colors, radius, space, type, isDark } = useTheme();
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
  const [socialBusy, setSocialBusy] = useState<"apple" | "google" | null>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void appleSignInAvailable().then((available) => {
      if (!cancelled) setAppleAvailable(available);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const codeInput = useRef<TextInputHandle>(null);
  const busy = sending || verifying;

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

  /**
   * Apple and Google end where the code does: a cookie in the jar, then
   * refreshSession() flips authStatus and _layout routes away. A dismissed
   * sheet resolves to null and is not an error.
   */
  const signInWith = useCallback(
    async (provider: "apple" | "google") => {
      if (busy || socialBusy) return;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setSocialBusy(provider);
      setError(null);
      try {
        const user = provider === "apple" ? await signInWithApple() : await signInWithGoogle();
        if (!user) return;
        await refreshSession();
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (socialError) {
        setError(errorMessage(socialError));
      } finally {
        setSocialBusy(null);
      }
    },
    [busy, refreshSession, socialBusy],
  );

  const useDifferentEmail = useCallback(() => {
    setStep("email");
    setCode("");
    setError(null);
    setResendSeconds(0);
  }, []);

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
            paddingTop: Math.max(insets.top, space.xl),
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.spacer} />

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
            <>
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
            {appleAvailable || googleSignInConfigured ? (
              <View style={styles.social}>
                <View style={styles.divider}>
                  <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
                  <Text style={[type.footnote, { color: colors.textMuted }]}>or</Text>
                  <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
                </View>
                {appleAvailable ? (
                  socialBusy === "apple" ? (
                    <View style={[styles.socialButton, { alignItems: "center", justifyContent: "center" }]}>
                      <ActivityIndicator color={colors.text} />
                    </View>
                  ) : (
                    <AppleAuthentication.AppleAuthenticationButton
                      buttonStyle={
                        isDark
                          ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                          : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                      }
                      buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
                      cornerRadius={radius.lg}
                      onPress={() => void signInWith("apple")}
                      style={styles.socialButton}
                    />
                  )
                ) : null}
                {googleSignInConfigured ? (
                  <View style={appleAvailable ? styles.socialGap : undefined}>
                    <PrimaryButton
                      disabled={busy || socialBusy === "apple"}
                      label="Continue with Google"
                      loading={socialBusy === "google"}
                      onPress={() => void signInWith("google")}
                      tone="quiet"
                    />
                  </View>
                ) : null}
              </View>
            ) : null}
            </>
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

        <View style={styles.spacer} />
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
     * STILL NO `space-between` HERE.
     *
     * space-between hands every GAP an equal share of the leftover space. With
     * a short form on a tall phone that is several arbitrary voids: the field
     * floating a hundred points above its own button, the divider stranded in
     * the middle of nothing. It only ever looked right on a screen whose
     * content happened to fill it.
     *
     * Two EXPLICIT spacers instead, one on each side of the form group. Equal
     * flex on both means the group is centred between the top of the screen
     * and whatever sits at the foot — which is a gap we chose and can reason
     * about, not one the layout engine handed out. The second spacer is kept
     * now that the form is the only thing here: it is what centres the group
     * rather than letting it ride up under the mark.
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
  /**
   * One of the two flexible gaps that centre the form group. Used above AND
   * below `top`; equal flex on each is what does the centring. Anything after
   * the second one sits at the foot.
   */
  spacer: {
    flex: 1,
    minHeight: 28,
  },
  top: {
    alignItems: "center",
    width: "100%",
  },
  title: {
    marginTop: 32,
    textAlign: "center",
  },
  helper: {
    lineHeight: 19,
    marginTop: 10,
    maxWidth: 320,
    textAlign: "center",
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
    width: "100%",
  },
  error: {
    lineHeight: 18,
    marginTop: 14,
  },
  /** Apple and Google, below the email field, behind an "or". */
  social: {
    marginTop: 20,
    width: "100%",
  },
  divider: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  socialButton: {
    height: 50,
    width: "100%",
  },
  socialGap: {
    marginTop: 12,
  },
});
