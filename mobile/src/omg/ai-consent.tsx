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

import { Icon } from "../components";
import { PrimaryAction, SecondaryAction, StepHeader, StepHeading } from "./onboarding-chrome";
import { Text } from "./text";
import { useTheme } from "./theme";

/** Bump whenever DISCLOSURES changes. See the header. */
export const CONSENT_VERSION = 2;

/**
 * Consent is PER ACCOUNT, not per install.
 *
 * The first version of this stored one flag for the whole device. Sign out,
 * sign in as someone else, and their messages went to the model providers
 * having never been asked — the previous person's tap answered for them. That
 * is not consent in any sense Apple or a user would recognise, so the account
 * id is part of the key.
 */
const storageKeyFor = (userId: string) => `omg:mobile:ai-data-consent:${userId}`;

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
    what: "Voice recordings",
    who: "ElevenLabs, for speech to text",
    when: "Only while dictation is on.",
  },
  {
    icon: { ios: "text.bubble.fill", android: "chat_bubble" },
    what: "Messages you type",
    who: "Your agent's AI provider: Anthropic, OpenAI or xAI",
    when: "When you send a message.",
  },
  {
    icon: { ios: "paperclip", android: "attach_file" },
    what: "Files and photos you attach",
    who: "The same AI provider as your messages",
    when: "When you send them.",
  },
  {
    icon: { ios: "chevron.left.forwardslash.chevron.right", android: "code" },
    what: "Code and files from the repository you are working in",
    who: "The same AI provider as your messages",
    when: "When an agent reads or edits files to carry out your request.",
  },
];

type ConsentState = "loading" | "needed" | "granted";

/**
 * Only a plain run of digits counts.
 *
 * `Number()` was the original test and it is far too permissive: `Number("0x10")`
 * is 16 and `Number("Infinity")` is Infinity, so a corrupted value read as a
 * GRANT. The file header claimed a read failure falls back to asking again;
 * that claim was false for every non-decimal string AsyncStorage could hold.
 */
function grantedVersion(raw: string | null): number {
  if (!raw || !/^\d+$/.test(raw)) return 0;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : 0;
}

export function useAiDataConsent(userId: string | null): {
  state: ConsentState;
  accept: () => void;
} {
  const [state, setState] = useState<ConsentState>("loading");

  useEffect(() => {
    let cancelled = false;
    // No account yet means nothing to consent FOR. The gate is only consulted
    // once signed in, so this simply parks in "loading" rather than inventing
    // an answer for an unknown person.
    if (!userId) {
      setState("loading");
      return;
    }
    setState("loading");
    AsyncStorage.getItem(storageKeyFor(userId))
      .then((raw) => {
        if (cancelled) return;
        setState(grantedVersion(raw) >= CONSENT_VERSION ? "granted" : "needed");
      })
      .catch(() => {
        // A read failure must not silently imply consent. Ask again; the cost
        // of one extra screen is far lower than transmitting without approval.
        if (!cancelled) setState("needed");
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const accept = useCallback(() => {
    if (!userId) return;
    // Flip the UI first. Persisting is best-effort: a storage failure should
    // re-ask on next launch, not block someone who just tapped Agree.
    setState("granted");
    void AsyncStorage.setItem(storageKeyFor(userId), String(CONSENT_VERSION)).catch(() => {});
  }, [userId]);

  return { state, accept };
}

/** Test/support hook: forget one account's grant so the screen shows again. */
export async function resetAiDataConsent(userId: string): Promise<void> {
  await AsyncStorage.removeItem(storageKeyFor(userId));
}

/**
 * Drawn as an onboarding step (Benny, 2026-09-24): the same header slot,
 * heading, hairline list and foot buttons as the questions around it, so it
 * reads as part of the flow rather than a system form dropped into it. The
 * WORDS are unchanged on purpose. They are what App Review approved.
 */
export function AiConsentScreen({
  onAccept,
  onDecline,
}: {
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { colors, space, type } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <StepHeader />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.lg + 4, paddingBottom: space.lg, gap: space.xl }}
      >
        <StepHeading
          title="Your data and AI providers"
          body="To run coding agents, omg.dev sends some of your data to AI companies outside omg.dev."
        />

        <View>
          {DISCLOSURES.map((item, index) => (
            <View
              key={item.what}
              style={{
                flexDirection: "row",
                gap: space.md,
                paddingVertical: 16,
                // Hairlines between rows, like the lane list: listed, not carded.
                borderTopWidth: index === 0 ? 0 : 1,
                borderTopColor: colors.border,
              }}
            >
              <View style={{ width: 28, alignItems: "center", flexShrink: 0, paddingTop: 2 }}>
                <Icon ios={item.icon.ios} android={item.icon.android} size={20} color={colors.text} />
              </View>
              <View style={{ flex: 1, gap: space.xs }}>
                <Text style={{ ...type.headline, color: colors.text }}>{item.what}</Text>
                <Text style={{ ...type.footnote, color: colors.textMuted }}>Sent to: {item.who}</Text>
                <Text style={{ ...type.footnote, color: colors.textMuted }}>{item.when}</Text>
              </View>
            </View>
          ))}
        </View>

        <Text style={{ ...type.footnote, color: colors.textMuted }}>
          Never sent: contacts, location, health data, device identifiers. Full
          detail at omg.dev/privacy.
        </Text>
      </ScrollView>

      <View style={{ paddingHorizontal: space.lg + 4, paddingTop: space.md, paddingBottom: insets.bottom + space.lg, gap: space.md }}>
        <PrimaryAction label="Agree and continue" onPress={onAccept} />
        <SecondaryAction label="Not now" onPress={onDecline} />
      </View>
    </View>
  );
}
