/**
 * The Settings row that names the computer's software version and changes it.
 *
 * Its own file, not a block inside app/settings.tsx, so it can be mounted and
 * rendered in a check. The states worth being sure about — up to date, an
 * update waiting, bits already on disk needing a restart, a box that says it
 * cannot restart itself — are four branches that a screenshot of one of them
 * does not cover.
 *
 * `/api/install` on the box owns the version and the update; see
 * computer-update.ts for why this is a reader and not a second mechanism.
 */
import { ActivityIndicator, View } from "react-native";
import { Icon, Row, Separator, SettingsIcon } from "../components";
import { PressableScale } from "./motion";
import { Text } from "./text";
import { useTheme } from "./theme";
import { canApply, describeInstall, type ComputerInstall } from "./computer-update";

export function ComputerSoftwareRow({
  install,
  loading,
  busy,
  restarting,
  error,
  onCheck,
  onApply,
}: {
  install: ComputerInstall | null;
  loading?: boolean;
  busy?: boolean;
  restarting?: boolean;
  error?: string | null;
  onCheck?: () => void;
  onApply?: () => void;
}) {
  const { colors, type, radius } = useTheme();
  // A box that never answered has no version to name. The reconnect state
  // elsewhere already says the computer is unreachable, so this row leaves
  // rather than repeating it.
  if (!install) return null;

  const line = describeInstall(install);
  const updatable = canApply(install);
  const staged = install.update?.state === "staged";
  const blockedReason =
    !updatable && install.update?.state !== "up-to-date"
      ? install.update?.restartBlockedReason
      : undefined;

  return (
    <>
      <Separator inset="icon" />
      <Row
        icon={
          <SettingsIcon tint="#8e8e93">
            <Icon ios="arrow.down.circle.fill" android="system_update" size={17} color="#ffffff" />
          </SettingsIcon>
        }
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ fontSize: 17, color: colors.text }}>Software</Text>
          {restarting ? (
            <Text style={{ ...type.footnote, color: colors.textMuted }}>
              Restarting the computer…
            </Text>
          ) : line ? (
            <Text style={{ ...type.footnote, color: colors.textMuted }}>{line}</Text>
          ) : null}
          {error ? (
            <Text style={{ ...type.footnote, color: colors.danger }}>{error}</Text>
          ) : null}
          {/* The box diagnoses its own inability to restart. Say what it said
              rather than a guess, and only when there is an update the reason
              is actually standing in the way of. */}
          {blockedReason ? (
            <Text style={{ ...type.footnote, color: colors.textMuted }}>{blockedReason}</Text>
          ) : null}
        </View>
        {/* The action is its own target, never the whole row: tapping a
            settings row by accident must not restart the computer, and a row
            that is pressable only sometimes is worse than one that never is. */}
        {updatable ? (
          <PressableScale
            onPress={onApply}
            disabled={busy}
            scale={0.96}
            accessibilityRole="button"
            accessibilityLabel={staged ? "Restart the computer" : "Update the computer"}
            style={{
              minHeight: 34,
              minWidth: 78,
              alignItems: "center",
              justifyContent: "center",
              paddingHorizontal: 14,
              borderRadius: radius.pill,
              backgroundColor: colors.secondary,
              opacity: busy ? 0.5 : 1,
            }}
          >
            {busy ? (
              <ActivityIndicator color={colors.text} />
            ) : (
              <Text style={{ ...type.footnote, fontWeight: "600", color: colors.text }}>
                {staged ? "Restart" : "Update"}
              </Text>
            )}
          </PressableScale>
        ) : (
          <PressableScale
            onPress={onCheck}
            disabled={loading}
            scale={0.96}
            accessibilityRole="button"
            accessibilityLabel="Check for a computer update"
            style={{
              minHeight: 34,
              minWidth: 44,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {loading ? (
              <ActivityIndicator color={colors.textMuted} />
            ) : (
              <Text style={{ ...type.footnote, fontWeight: "600", color: colors.textSecondary }}>
                Check
              </Text>
            )}
          </PressableScale>
        )}
      </Row>
    </>
  );
}
