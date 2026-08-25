/**
 * Consent for sending personal data to third-party AI services.
 *
 * WHY THIS EXISTS. App Review rejected 1.0 (34) under guidelines 5.1.1(i) and
 * 5.1.2(i): the app shares personal data with a third-party AI service without
 * disclosing what is sent, naming who it is sent to, or asking first. Apple was
 * explicit that a privacy policy alone does not satisfy this -- the disclosure
 * has to be IN THE APP and the permission has to be an affirmative act.
 *
 * So this gate stands in front of the whole signed-in tree. Nothing that can
 * transmit a message, an attachment or audio is reachable until `accept()` has
 * run. That placement is the point: a consent screen the user can route around
 * is not consent.
 *
 * ── Why the stored value carries a version ────────────────────────────────
 *
 * The recipients ARE the disclosure. Adding a fourth provider, or sending a
 * new category of data, makes a previously granted consent describe something
 * the user never agreed to. Bumping `CONSENT_VERSION` re-asks everyone, which
 * is the honest behaviour and also the one Apple expects. Do not reuse a
 * version after changing `DISCLOSURES`.
 *
 * ── Why refusing signs out ────────────────────────────────────────────────
 *
 * omg.dev is a client for AI coding agents. There is no meaningful offline
 * mode to fall back to, so "Not now" cannot leave someone parked on an empty
 * shell wondering what is broken. It returns them to sign-in, which is a state
 * the app already handles completely.
 */

import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { AndroidSymbol, SFSymbol } from "expo-symbols";

import { Icon, PrimaryButton, Separator } from "../components";
import { Text } from "./text";
import { useTheme } from "./theme";

/** Bump whenever DISCLOSURES changes. See the header. */
export const CONSENT_VERSION = 1;

const STORAGE_KEY = "omg:mobile:ai-data-consent";

type Disclosure = {
  icon: { ios: SFSymbol; android: AndroidSymbol };
  what: string;
  who: string;
  when: string;
};

/**
 * The literal text App Review will read. Each entry answers Apple's three
 * questions in order: what data, who receives it, and what triggers the send.
 * Keep them specific. A generic line here is the 5.1.1(ii) mistake again, in a
 * different place.
 */
export const DISCLOSURES: Disclosure[] = [
  {
    icon: { ios: "mic.fill", android: "mic" },
    what: "Voice recordings, and the text they become",
    who: "ElevenLabs (Scribe speech-to-text)",
    when: "Only while dictation is on. You start and stop it with the microphone button.",
  },
  {
    icon: { ios: "text.bubble.fill", android: "chat_bubble" },
    what: "The messages you type",
    who: "The AI model provider behind the coding agent you pick, such as Anthropic, OpenAI or xAI",
    when: "When you send a message to an agent.",
  },
  {
    icon: { ios: "paperclip", android: "attach_file" },
    what: "Files and photos you attach",
    who: "The same AI model provider as your messages",
    when: "When you attach a file and send it.",
  },
];

type ConsentState = "loading" | "needed" | "granted";

export function useAiDataConsent(): {
  state: ConsentState;
  accept: () => void;
} {
  const [state, setState] = useState<ConsentState>("loading");

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (cancelled) return;
        setState(raw && Number(raw) >= CONSENT_VERSION ? "granted" : "needed");
      })
      .catch(() => {
        // A read failure must not silently imply consent. Ask again; the cost
        // of one extra screen is far lower than transmitting without approval.
        if (!cancelled) setState("needed");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const accept = useCallback(() => {
    // Flip the UI first. Persisting is best-effort: a storage failure should
    // re-ask on next launch, not block someone who just tapped Agree.
    setState("granted");
    void AsyncStorage.setItem(STORAGE_KEY, String(CONSENT_VERSION)).catch(() => {});
  }, []);

  return { state, accept };
}

/** Test/support hook: forget the grant so the screen shows again. */
export async function resetAiDataConsent(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export function AiConsentScreen({
  onAccept,
  onDecline,
}: {
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { colors, space, type, radius } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingTop: insets.top + space.xl,
          gap: space.lg,
        }}
      >
        <Text style={{ ...type.largeTitle, color: colors.text }}>
          Your data and AI providers
        </Text>
        <Text style={{ ...type.body, color: colors.textMuted }}>
          omg.dev runs coding agents for you. To do that it sends some of what you
          type, attach and say to AI companies outside omg.dev. Here is exactly
          what goes out, and to whom.
        </Text>

        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: radius.lg,
            paddingVertical: space.xs,
          }}
        >
          {DISCLOSURES.map((item, index) => (
            <View key={item.what}>
              {index > 0 ? <Separator inset="text" /> : null}
              <View style={{ flexDirection: "row", gap: space.md, padding: space.md }}>
                <Icon ios={item.icon.ios} android={item.icon.android} size={20} color={colors.textMuted} />
                <View style={{ flex: 1, gap: space.xs }}>
                  <Text style={{ ...type.headline, color: colors.text }}>{item.what}</Text>
                  <Text style={{ ...type.footnote, color: colors.textMuted }}>
                    Sent to: {item.who}
                  </Text>
                  <Text style={{ ...type.footnote, color: colors.textMuted }}>{item.when}</Text>
                </View>
              </View>
            </View>
          ))}
        </View>

        <Text style={{ ...type.footnote, color: colors.textMuted }}>
          omg.dev does not send your contacts, your location, your health data or
          your device identifiers to any AI provider. You can read the full
          detail in the privacy policy at omg.dev/privacy.
        </Text>
      </ScrollView>

      <View
        style={{
          padding: space.lg,
          paddingBottom: insets.bottom + space.lg,
          gap: space.sm,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        <PrimaryButton label="Agree and continue" onPress={onAccept} />
        <PrimaryButton label="Not now" tone="quiet" onPress={onDecline} />
      </View>
    </View>
  );
}
