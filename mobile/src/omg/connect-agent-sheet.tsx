/**
 * Connect Claude Code or Codex, one step at a time, in a tray over whatever
 * screen asked for it. Onboarding and Settings › Coding agents both use it.
 *
 * Claude has no device flow. The box runs `claude auth login --claudeai` and
 * prints a page URL; the person signs in there, Anthropic shows a code, and
 * the code has to come back here. So: open the page, then paste. The paste is
 * done for them when the clipboard holds something code-shaped the moment the
 * page closes.
 *
 * Codex is a device code. The box runs `codex login --device-auth`, the code is
 * copied here before the page opens, and the tray polls the box until the
 * approval lands. The in-app page is dismissed by the tray at that moment.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, Image, Pressable, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";

import { Icon } from "../components";
import {
  AUTH_POLL_MS,
  cancelAgentAuth,
  looksLikeClaudeCode,
  pollAgentAuth,
  PROVIDER_LABEL,
  startAgentAuth,
  submitAgentAuthCode,
  type AgentAuthSession,
  type AgentAuthTransport,
  type ConnectProvider,
} from "./agent-auth";
import { agentIcon } from "./agent-icons";
import { dismissSignInPage, hasInAppBrowser, openSignInPage } from "./in-app-browser";
import { PressableScale } from "./motion";
import { Sheet } from "./sheet";
import { Text, TextInput } from "./text";
import { useTheme } from "./theme";

type Phase =
  /** Nothing asked of the box yet (Claude), or the box is being asked (Codex). */
  | "idle"
  | "starting"
  /** The sign-in page is open, or was opened, and the box is waiting. */
  | "open"
  /** Claude only: the page closed, the code field is showing. */
  | "paste"
  | "submitting"
  | "complete"
  | "error";

export function ConnectAgentSheet({
  visible,
  provider,
  agentKey,
  claudeAccountId,
  transport,
  onClose,
  onConnected,
  doneLabel = "Done",
}: {
  visible: boolean;
  provider: ConnectProvider;
  /** The roster key the box knows this agent by; the auth route takes it. */
  agentKey: string;
  /** Reconnect one specific Claude account rather than adding a new one. */
  claudeAccountId?: string;
  transport: AgentAuthTransport | null;
  onClose: () => void;
  onConnected: () => void | Promise<void>;
  doneLabel?: string;
}) {
  const { colors, radius, space, type } = useTheme();
  const label = PROVIDER_LABEL[provider];
  const [phase, setPhase] = useState<Phase>("idle");
  const [session, setSession] = useState<AgentAuthSession | null>(null);
  const [code, setCode] = useState("");
  const [autoFilled, setAutoFilled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browser, setBrowser] = useState<"closed" | "external" | null>(null);
  const alive = useRef(true);
  const sessionRef = useRef<AgentAuthSession | null>(null);
  sessionRef.current = session;

  const fail = useCallback((e: unknown, fallback: string) => {
    if (!alive.current) return;
    setError(e instanceof Error ? e.message : fallback);
    setPhase("error");
  }, []);

  /** Ask the box to start the CLI login. */
  const start = useCallback(async (): Promise<AgentAuthSession | null> => {
    if (!transport) {
      fail(null, "Your Computer is not ready yet.");
      return null;
    }
    setError(null);
    setPhase("starting");
    try {
      const next = await startAgentAuth(transport, agentKey, { claudeAccountId });
      if (!alive.current) return null;
      setSession(next);
      if (next.status === "error") {
        fail(new Error(next.error ?? `Could not start ${label} sign-in.`), "");
        return null;
      }
      return next;
    } catch (e) {
      fail(e, `Could not start ${label} sign-in.`);
      return null;
    }
  }, [agentKey, claudeAccountId, fail, label, transport]);

  const open = useCallback(
    async (target: AgentAuthSession) => {
      if (!target.authorizationUrl) {
        fail(null, "The sign-in page did not arrive. Try again.");
        return;
      }
      setPhase("open");
      const how = await openSignInPage(target.authorizationUrl);
      if (!alive.current) return;
      setBrowser(how);
      if (provider === "claude" && how === "closed") {
        // The sheet came down. The code, if they copied it, is on the clipboard.
        await prefillFromClipboard();
        setPhase((p) => (p === "open" ? "paste" : p));
      }
    },
    [fail, provider],
  );

  const prefillFromClipboard = useCallback(async () => {
    const text = await Clipboard.getStringAsync().catch(() => "");
    if (!alive.current) return;
    if (looksLikeClaudeCode(text)) {
      setCode(text.trim());
      setAutoFilled(true);
    }
  }, []);

  /** Claude: the whole first step in one tap. */
  const openClaude = useCallback(async () => {
    const next = sessionRef.current?.status === "waiting" ? sessionRef.current : await start();
    if (next) await open(next);
  }, [open, start]);

  /** Codex: the code is needed before the page, so start on open. */
  useEffect(() => {
    if (!visible || provider !== "codex" || phase !== "idle") return;
    void (async () => {
      const next = await start();
      if (!next) return;
      if (next.userCode) await Clipboard.setStringAsync(next.userCode).catch(() => {});
      setPhase("open");
    })();
  }, [phase, provider, start, visible]);

  /** Safari fallback for Claude: coming back to the app is the "page closed" signal. */
  useEffect(() => {
    if (provider !== "claude" || phase !== "open" || browser !== "external") return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void prefillFromClipboard().then(() => {
        if (alive.current) setPhase((p) => (p === "open" ? "paste" : p));
      });
    });
    return () => sub.remove();
  }, [browser, phase, prefillFromClipboard, provider]);

  const submit = useCallback(async () => {
    const target = sessionRef.current;
    if (!transport || !target || !code.trim()) return;
    setPhase("submitting");
    setError(null);
    try {
      const next = await submitAgentAuthCode(transport, target.id, code);
      if (!alive.current) return;
      setSession(next);
      if (next.status === "error") fail(new Error(next.error ?? "Claude did not accept that code."), "");
    } catch (e) {
      fail(e, "Claude did not accept that code.");
    }
  }, [code, fail, transport]);

  /** Poll the box while a login is in flight. */
  const polling = !!session && (phase === "open" || phase === "paste" || phase === "submitting");
  useEffect(() => {
    if (!polling || !transport || !session) return;
    let stopped = false;
    const tick = async () => {
      try {
        const next = await pollAgentAuth(transport, session.id);
        if (stopped || !alive.current) return;
        setSession(next);
        if (next.status === "complete") {
          stopped = true;
          dismissSignInPage();
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          setPhase("complete");
          void onConnected();
        } else if (next.status === "error") {
          stopped = true;
          fail(new Error(next.error ?? `${label} sign-in failed.`), "");
        }
      } catch (e) {
        if (stopped || !alive.current) return;
        stopped = true;
        fail(e, "Lost contact with your Computer.");
      }
    };
    const timer = setInterval(() => void tick(), AUTH_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [fail, label, onConnected, polling, session?.id, transport]);

  /** Reset every time the tray opens. */
  useEffect(() => {
    if (!visible) return;
    setPhase("idle");
    setSession(null);
    setCode("");
    setAutoFilled(false);
    setError(null);
    setBrowser(null);
  }, [visible]);

  /**
   * Cancel an unfinished login when the tray closes or unmounts, so backing
   * out does not leave a CLI login waiting on the box until its TTL.
   */
  useEffect(() => {
    if (!visible) return;
    alive.current = true;
    return () => {
      alive.current = false;
      const target = sessionRef.current;
      if (target && target.status !== "complete" && transport) void cancelAgentAuth(transport, target.id);
    };
  }, [transport, visible]);

  const retry = useCallback(() => {
    setError(null);
    setSession(null);
    setCode("");
    setAutoFilled(false);
    setPhase("idle");
  }, []);

  const inApp = hasInAppBrowser();
  const pageWord = inApp ? "opens inside omg" : "opens in Safari";

  /* ── Copy per phase ─────────────────────────────────────────────────── */
  let eyebrow = "";
  let title = "";
  let body = "";
  if (phase === "complete") {
    title = `${label} is ready.`;
    body = "Connected to your Computer. Every session uses your subscription from now on.";
  } else if (phase === "error") {
    title = "That did not work.";
    body = error ?? `${label} sign-in failed.`;
  } else if (provider === "claude") {
    if (phase === "paste" || phase === "submitting") {
      eyebrow = "Step 2 of 2";
      title = "Paste the code.";
      body = autoFilled
        ? "We found a code on your clipboard and filled it in. Check it matches what Claude showed you."
        : "Copy the code Claude showed you and paste it here.";
    } else {
      eyebrow = "Step 1 of 2";
      title = "Sign in to Claude.";
      body = `claude.ai ${pageWord}. After you sign in, Anthropic shows a short code. Copy it${inApp ? ", then tap Done" : " and come back here"}.`;
    }
  } else {
    eyebrow = "One step";
    title = "Enter this code in ChatGPT.";
    body = `It is already copied. ChatGPT ${pageWord}. Paste, approve, and come back.`;
  }

  const security =
    provider === "claude"
      ? phase === "paste" || phase === "submitting"
        ? "The code goes to your Computer, which finishes the sign-in with Claude. The token is written there, not on this phone."
        : "You sign in on claude.ai, not in omg. omg never sees your password. Your Computer finishes the sign-in."
      : "Your Computer is waiting for the approval. This screen connects on its own the moment it lands.";

  const busy = phase === "starting" || phase === "submitting";

  return (
    <Sheet visible={visible} onClose={onClose} maxWidth={430} resizable={false}>
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.md, gap: space.lg }}>
        {/* Header: which agent, and a way out. */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              backgroundColor: colors.secondary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Image source={agentIcon(agentKey)} style={{ width: 18, height: 18 }} resizeMode="contain" />
          </View>
          <Text style={{ ...type.callout, fontWeight: "600", color: colors.text, flex: 1 }}>{label}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            hitSlop={8}
            style={{
              width: 30,
              height: 30,
              borderRadius: 15,
              backgroundColor: colors.secondary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon ios="xmark" android="close" size={12} weight="semibold" color={colors.text} />
          </Pressable>
        </View>

        {/* Title block. */}
        <View style={{ gap: space.sm }}>
          {eyebrow ? (
            <Text style={{ ...type.overline, color: colors.brand, textTransform: "uppercase" }}>{eyebrow}</Text>
          ) : null}
          {phase === "complete" ? (
            <View
              style={{
                width: 64,
                height: 64,
                borderRadius: 32,
                backgroundColor: colors.text,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: space.xs,
              }}
            >
              <Icon ios="checkmark" android="check" size={28} weight="bold" color={colors.bg} />
            </View>
          ) : null}
          <Text style={{ ...type.title, fontSize: 28, lineHeight: 32, color: colors.text }} testID="connect-title">
            {title}
          </Text>
          <Text style={{ ...type.callout, lineHeight: 22, color: colors.text2 }}>{body}</Text>
        </View>

        {/* Per-provider middle. */}
        {provider === "claude" && (phase === "idle" || phase === "starting" || phase === "open") ? (
          <StepRail
            steps={[
              { title: "Open Claude and sign in", detail: "Use the account with your subscription" },
              {
                title: "Paste the code here",
                detail: inApp ? "Filled in for you when the page closes" : "Filled in for you when you come back",
              },
            ]}
            active={0}
          />
        ) : null}

        {provider === "claude" && (phase === "paste" || phase === "submitting") ? (
          <View style={{ gap: space.sm }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
                height: 56,
                paddingHorizontal: 14,
                borderRadius: 14,
                borderWidth: 2,
                borderColor: error ? colors.danger : colors.text,
                backgroundColor: colors.fieldFill,
              }}
            >
              <TextInput
                testID="connect-code"
                accessibilityLabel="Code from Claude"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy}
                onChangeText={(v) => {
                  setCode(v);
                  setAutoFilled(false);
                  setError(null);
                }}
                placeholder="Paste the code"
                placeholderTextColor={colors.textMuted}
                style={{ ...type.body, flex: 1, color: colors.text, fontFamily: "Menlo" }}
                value={code}
              />
              {code ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Clear code" onPress={() => setCode("")} hitSlop={8}>
                  <Icon ios="xmark.circle.fill" android="cancel" size={18} color={colors.textMuted} />
                </Pressable>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void Clipboard.getStringAsync().then((t) => t && setCode(t.trim()))}
                  hitSlop={8}
                >
                  <Text style={{ ...type.subhead, fontWeight: "600", color: colors.text }}>Paste</Text>
                </Pressable>
              )}
            </View>
            <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 4 }}>
              {autoFilled ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <Icon ios="checkmark" android="check" size={11} weight="semibold" color={colors.success} />
                  <Text style={{ ...type.footnote, fontWeight: "600", color: colors.success }}>From your clipboard</Text>
                </View>
              ) : (
                <Text style={{ ...type.footnote, color: colors.textMuted }}>Not the right code?</Text>
              )}
              <Pressable accessibilityRole="button" onPress={() => void openClaude()} disabled={busy}>
                <Text style={{ ...type.footnote, fontWeight: "600", color: colors.text }}>Open Claude again</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {provider === "codex" && phase !== "complete" && phase !== "error" ? (
          <View style={{ alignItems: "center", gap: space.md }}>
            <View
              style={{
                width: "100%",
                height: 88,
                borderRadius: radius.xl,
                backgroundColor: colors.secondary,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {session?.userCode ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Device code ${session.userCode}. Copy`}
                  onPress={() => void Clipboard.setStringAsync(session.userCode ?? "")}
                >
                  <Text
                    testID="connect-device-code"
                    style={{ fontSize: 36, fontWeight: "500", letterSpacing: 4, fontFamily: "Menlo", color: colors.text }}
                  >
                    {session.userCode}
                  </Text>
                </Pressable>
              ) : (
                <ActivityIndicator color={colors.textMuted} />
              )}
            </View>
            {session?.userCode ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Icon ios="checkmark" android="check" size={11} weight="semibold" color={colors.success} />
                <Text style={{ ...type.footnote, fontWeight: "600", color: colors.success }}>Copied to clipboard</Text>
              </View>
            ) : null}
            {phase === "open" ? (
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingTop: space.sm }}>
                <ActivityIndicator size="small" color={colors.textMuted} />
                <Text style={{ ...type.callout, color: colors.text2 }}>Waiting for you to approve in ChatGPT…</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* The plain-words promise, then the one action. */}
        {phase !== "complete" && phase !== "error" ? (
          <View style={{ flexDirection: "row", gap: space.md, alignItems: "flex-start" }}>
            <Icon ios="lock" android="lock" size={15} color={colors.text} />
            <Text style={{ ...type.footnote, lineHeight: 18, color: colors.text2, flex: 1 }}>{security}</Text>
          </View>
        ) : null}

        {phase === "complete" ? (
          <Primary label={doneLabel} onPress={onClose} />
        ) : phase === "error" ? (
          <Primary label="Try again" onPress={retry} />
        ) : provider === "claude" ? (
          phase === "paste" || phase === "submitting" ? (
            <Primary label="Connect Claude Code" onPress={() => void submit()} disabled={!code.trim()} loading={phase === "submitting"} />
          ) : (
            <Primary label="Open Claude" onPress={() => void openClaude()} loading={phase === "starting"} />
          )
        ) : (
          <Primary
            label="Open ChatGPT"
            onPress={() => session && void open(session)}
            disabled={!session?.authorizationUrl}
            loading={phase === "starting"}
          />
        )}
      </View>
    </Sheet>
  );
}

function StepRail({ steps, active }: { steps: { title: string; detail: string }[]; active: number }) {
  const { colors, type } = useTheme();
  return (
    <View>
      {steps.map((step, i) => {
        const on = i === active;
        const last = i === steps.length - 1;
        return (
          <View key={step.title} style={{ flexDirection: "row", gap: 16, alignItems: "flex-start" }}>
            <View style={{ width: 28, alignItems: "center" }}>
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: on ? colors.text : "transparent",
                  borderWidth: on ? 0 : 2,
                  borderColor: colors.border,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text style={{ ...type.footnote, fontWeight: "700", color: on ? colors.bg : colors.textMuted }}>{i + 1}</Text>
              </View>
              {!last ? <View style={{ width: 2, height: 40, backgroundColor: colors.border }} /> : null}
            </View>
            <View style={{ gap: 2, paddingTop: 4, flex: 1 }}>
              <Text style={{ ...type.headline, color: on ? colors.text : colors.textMuted }}>{step.title}</Text>
              <Text style={{ ...type.footnote, color: colors.textMuted }}>{step.detail}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function Primary({
  label,
  onPress,
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const { colors, type } = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled || loading}
      scale={0.97}
      style={{
        height: 56,
        borderRadius: 16,
        backgroundColor: colors.text,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {loading ? <ActivityIndicator color={colors.bg} /> : <Text style={{ ...type.headline, color: colors.bg }}>{label}</Text>}
    </PressableScale>
  );
}
