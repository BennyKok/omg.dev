/**
 * Step 03: the first prompt, and the sign-in drawer over it.
 *
 * This screen is the point of the whole revamp. The old flow asked who you
 * were on screen two; this one asks what you want, lets you write it, and only
 * then asks for an account. "Sign in to start" is the whole bargain in four
 * words.
 *
 * ── The draft has to survive sign-in ──────────────────────────────────────
 *
 * Signing in is the one moment in this flow that can re-mount everything under
 * it, and losing a prompt somebody just wrote there would be the single worst
 * bug this screen could have. The text is therefore owned by the CALLER and
 * handed in, so it lives above the part of the tree that auth tears down.
 * Dismissing the drawer returns to exactly this text, which is what the design
 * asks for.
 *
 * ── Prefilled, not scripted ───────────────────────────────────────────────
 *
 * An example task opens already written out; "Start with my own idea" opens
 * blank with a placeholder, never prefilled text somebody has to delete first.
 * Both are editable -- hence "Edit any part of this prompt." under the box.
 *
 * Design: artboards "03 · First prompt · Before sign-in", "03 · Custom task ·
 * Fourth option", "03 · Sign-in drawer · After prompt".
 */
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AttachmentStrip, Icon } from "../components";
import { DropdownMenu, type MenuOption } from "./menu";
import { PrimaryAction, StepHeader, StepHeading } from "./onboarding-chrome";
import type { PickedFile } from "./attachments";
import { Text, TextInput } from "./text";
import { useTheme } from "./theme";

export function PromptScreen({
  value,
  onChangeText,
  attachOptions,
  files,
  onRemoveFile,
  onSignIn,
  onBack,
  custom = false,
  finalLabel = "Sign in to start",
}: {
  value: string;
  onChangeText: (next: string) => void;
  /** The plus button's menu rows. Picking only; nothing is uploaded yet. */
  attachOptions: MenuOption[];
  /** What has been picked so far, so the control is not a button into a void. */
  files: readonly PickedFile[];
  onRemoveFile: (uri: string) => void;
  onSignIn: () => void;
  onBack: () => void;
  /** The own-idea path: blank, with a different title and no editing hint. */
  custom?: boolean;
  /**
   * "Sign in to start" is the bargain on first run. A replay from Settings is
   * someone who already has an account being shown the flow, so the button
   * there says "Continue" and nothing asks them to sign in again.
   */
  finalLabel?: string;
}) {
  const { colors, radius, space, type } = useTheme();
  const insets = useSafeAreaInsets();
  const ready = value.trim().length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}>
      <StepHeader onBack={onBack} />
      <View style={{ flex: 1, paddingHorizontal: space.lg + 4, gap: space.lg }}>
        <StepHeading title={custom ? "What is your idea?" : "First prompt."} />

        <View
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.lg,
            padding: space.lg,
            gap: space.md,
            minHeight: 232,
          }}
        >
          <TextInput
            value={value}
            onChangeText={onChangeText}
            multiline
            // Return inserts a line break. This is a prompt being composed, not
            // a message being sent -- sending is the button at the bottom.
            submitBehavior="newline"
            placeholder={custom ? "Describe what you want to make or get done..." : undefined}
            placeholderTextColor={colors.textMuted}
            autoFocus={custom}
            style={{
              ...type.body,
              fontSize: 17,
              lineHeight: 24,
              color: colors.text,
              padding: 0,
              textAlignVertical: "top",
            }}
          />
          {/*
           * THE SAME STRIP THE COMPOSERS DRAW, from src/components.tsx.
           *
           * Thumbnails on 56pt tiles with a remove target, not a list of file
           * names invented for this one screen. Attaching should look like
           * attaching wherever you do it.
           *
           * The tiles are dimmed and carry no progress ring, which is honest:
           * nothing is uploading. There is no account and no Computer on this
           * side of sign-in, so the bytes do not move until
           * onboarding-launch.ts sends them.
           */}
          <AttachmentStrip
            items={files.map((file) => ({
              // The URI is the identity: both pickers copy into our cache
              // under a unique name, and there is no server id to use yet.
              id: file.uri,
              name: file.name,
              uri: file.uri,
              kind: file.kind,
              path: null,
            }))}
            onRemove={onRemoveFile}
          />
          <DropdownMenu options={attachOptions}>
            <View
              accessibilityRole="button"
              accessibilityLabel="Add a file"
              style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
            >
              <Icon ios="plus" android="add" size={15} color={colors.textMuted} />
              <Text style={{ ...type.callout, color: colors.textMuted }}>
                {custom ? "Add a file" : "Add a file or reference"}
              </Text>
            </View>
          </DropdownMenu>
        </View>

        {custom ? null : (
          <Text style={{ ...type.footnote, color: colors.textMuted }}>Edit any part of this prompt.</Text>
        )}
      </View>

      <View style={{ paddingHorizontal: space.lg + 4, paddingBottom: insets.bottom + space.lg }}>
        {/*
         * "Sign in to start", and nothing under it. The design carried "Your
         * first task is on us" here and Benny removed it: the allowance is the
         * control plane's to grant, and this side promising it would be a claim
         * the product breaks on first use.
         */}
        <PrimaryAction label={finalLabel} onPress={onSignIn} disabled={!ready} />
      </View>
    </View>
  );
}
