/**
 * Which computer is this app talking to.
 *
 * The one thing this screen must not do is let you pick a machine that cannot
 * serve you. The account's cloud Computer can come back
 * status:"upgrade_required" / blockedReason:"plan_downgraded" — observed live —
 * and the session proxy then answers every request with a permanent 425. If
 * that row looks selectable, the app sends you to a spinner that never ends.
 * So a blocked machine is rendered as blocked, with the reason and a way out to
 * the web where billing actually lives.
 */

import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import {
  ActivityIndicator,
  Linking,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { Text } from "../src/omg/text";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card, Icon, Row, SectionLabel, Separator, StatusDot } from "../src/components";
import { useOmg } from "../src/omg/provider";
import { useTheme } from "../src/omg/theme";
import { bindingLabel, cloudStatusLabel, machineSpec, relativeTime } from "../src/omg/format";
import { CLOUD_BINDING_ID } from "../src/omg/config";

const BLOCKED_CLOUD_STATUSES = new Set(["upgrade_required", "recycled"]);

export default function ComputersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, type, space } = useTheme();
  const {
    bindings,
    cloud,
    bindingId,
    selectBinding,
    machinesError,
    machinesLoading,
    refreshMachines,
  } = useOmg();

  const choose = async (id: string) => {
    void Haptics.selectionAsync();
    await selectBinding(id);
    router.back();
  };

  const cloudBlocked = BLOCKED_CLOUD_STATUSES.has(cloud?.status ?? "");
  const cloudSpec = machineSpec(cloud?.machine);

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
      // Lets the native large title collapse into the bar on scroll instead of
      // sitting on top of the first card.
      contentInsetAdjustmentBehavior="automatic"
      // Pull-to-refresh is what someone reaches for on this screen; the Refresh
      // link below is the discoverable version of the same call.
      refreshControl={
        <RefreshControl
          refreshing={machinesLoading}
          onRefresh={() => void refreshMachines()}
          tintColor={colors.textMuted}
        />
      }
    >
      {machinesError ? (
        <Text style={{ ...type.footnote, color: colors.danger, paddingHorizontal: space.lg, paddingTop: space.sm }}>
          {machinesError}
        </Text>
      ) : null}

      {bindings.length > 0 ? (
        <>
          <SectionLabel>Your machines</SectionLabel>
          <Card>
            {bindings.map((b, i) => {
              const selected = b.id === bindingId;
              return (
                <View key={b.id}>
                  {i > 0 ? <Separator inset={space.lg} /> : null}
                  <Row onPress={() => void choose(b.id)}>
                    <StatusDot busy={b.online} />
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={{ ...type.callout, color: colors.text, fontWeight: "600" }}>
                        {bindingLabel(b)}
                      </Text>
                      <Text numberOfLines={1} style={{ ...type.footnote, color: colors.textMuted }}>
                        {b.online
                          ? b.defaultFolder ?? "Online"
                          : `Last seen ${relativeTime(b.lastSeenAt) || "a while ago"}`}
                      </Text>
                    </View>
                    {selected ? (
                      <Icon
                        ios="checkmark"
                        android="check"
                        size={16}
                        weight="semibold"
                        color={colors.primary}
                      />
                    ) : null}
                  </Row>
                </View>
              );
            })}
          </Card>
        </>
      ) : null}

      <SectionLabel>omg cloud</SectionLabel>
      <Card>
        <Row
          onPress={cloudBlocked ? undefined : () => void choose(CLOUD_BINDING_ID)}
          disabled={cloudBlocked}
        >
          <StatusDot busy={!cloudBlocked && Boolean(cloud)} blocked={cloudBlocked} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ ...type.callout, color: colors.text, fontWeight: "600" }}>
              Cloud computer
            </Text>
            <Text style={{ ...type.footnote, color: cloudBlocked ? colors.warning : colors.textMuted }}>
              {cloudStatusLabel(cloud?.status, cloud?.blockedReason)}
            </Text>
            {cloudSpec ? (
              <Text style={{ ...type.caption, color: colors.textMuted, opacity: 0.8 }}>{cloudSpec}</Text>
            ) : null}
          </View>
          {bindingId === CLOUD_BINDING_ID && !cloudBlocked ? (
            <Icon
              ios="checkmark"
              android="check"
              size={16}
              weight="semibold"
              color={colors.primary}
            />
          ) : null}
        </Row>

        {cloudBlocked ? (
          <>
            <Separator inset={space.lg} />
            <Row onPress={() => void Linking.openURL("https://app.omg.dev/")}>
              <Text style={{ ...type.callout, color: colors.primary, flex: 1 }}>
                Fix this on omg.dev
              </Text>
              <Icon
                ios="arrow.up.forward.app"
                android="open_in_new"
                size={15}
                color={colors.textMuted}
              />
            </Row>
          </>
        ) : null}
      </Card>

      <Text
        style={{
          ...type.footnote,
          color: colors.textMuted,
          paddingHorizontal: space.lg,
          paddingTop: space.lg,
          lineHeight: 18,
        }}
      >
        Pair a new machine by running{" "}
        <Text style={{ color: colors.text }}>omg connect</Text> on it. Billing and plans live on
        the web.
      </Text>

      {/* Row already carries the screen's horizontal padding; wrapping it in a
          padded View indented this one twice as far as every other row. */}
      <Row onPress={() => void refreshMachines()} disabled={machinesLoading}>
        <Text style={{ ...type.callout, color: colors.primary }}>Refresh</Text>
        {machinesLoading ? <ActivityIndicator size="small" color={colors.textMuted} /> : null}
      </Row>
    </ScrollView>
  );
}
