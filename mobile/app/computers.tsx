/**
 * Which computer is this app talking to.
 *
 * The one thing this screen must not do is let you pick a machine that cannot
 * serve you. The account's cloud Computer can come back
 * status:"upgrade_required" / blockedReason:"plan_downgraded" — observed live —
 * and the session proxy then answers every request with a permanent 425. If
 * that row looks selectable, the app sends you to a spinner that never ends.
 * So a blocked machine is rendered as blocked, with the reason stated plainly.
 * A way out to the web is offered only for blocks that are not about money —
 * see WEB_FIXABLE_CLOUD_STATUSES below.
 */

import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { useEffect } from "react";
import { Linking, RefreshControl, ScrollView, View } from "react-native";
import { Text } from "../src/omg/text";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Card, Icon, Row, SectionLabel, Separator, StatusDot } from "../src/components";
import { useOmg } from "../src/omg/provider";
import { useTheme } from "../src/omg/theme";
import { useToast } from "../src/omg/toast";
import { bindingLabel, cloudStatusLabel, machineSpec, relativeTime } from "../src/omg/format";
import { CLOUD_BINDING_ID } from "../src/omg/config";

const BLOCKED_CLOUD_STATUSES = new Set(["upgrade_required", "recycled"]);

/**
 * Blocked, but NOT for a reason you would fix by paying.
 *
 * "Fix this on omg.dev" is only offered for these. `upgrade_required` is
 * deliberately absent: that state means "Included computer time is used up" or
 * "Your plan no longer covers this computer", so a button next to it saying
 * fix this on the web is, in substance, a call to action pointing at a
 * purchasing mechanism that is not in-app purchase — which App Review
 * Guideline 3.1.1(a) prohibits everywhere except the United States storefront.
 * It reads more like a paywall exit than the settings row did, because it
 * appears at exactly the moment someone is being asked for money.
 *
 * `recycled` stays: a removed machine is not a billing state, and getting it
 * back is account management.
 *
 * The status text still tells the truth about why the machine will not serve.
 * Stating a fact is not a call to action. See app/settings.tsx for the whole
 * reasoning.
 *
 * `upgrade_required` STILL does not belong here, and now it does not need to:
 * it has its own way out, in-app, below.
 */
const WEB_FIXABLE_CLOUD_STATUSES = new Set(["recycled"]);

/**
 * Blocked over money, which in-app purchase can now actually fix.
 *
 * This is the state the whole StoreKit feature exists for. It used to be a
 * deliberate dead end — the machine said "Included computer time is used up"
 * and offered nothing, because the only available exit was web checkout and
 * 3.1.1(a) forbids pointing at it. An in-app purchase is not an external
 * purchasing mechanism, so this row is allowed where "Fix this on omg.dev"
 * was not, and it turns the honest statement of the problem into an honest
 * offer to solve it.
 */
const PURCHASABLE_CLOUD_STATUSES = new Set(["upgrade_required"]);

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
  const toast = useToast();
  useEffect(() => {
    if (machinesError) toast.show(machinesError, { intent: "error" });
  }, [machinesError, toast]);

  const choose = async (id: string) => {
    void Haptics.selectionAsync();
    await selectBinding(id);
    router.back();
  };

  const cloudBlocked = BLOCKED_CLOUD_STATUSES.has(cloud?.status ?? "");
  // See WEB_FIXABLE_CLOUD_STATUSES: blocked is not the same question as
  // "should we offer a way out to the web".
  const cloudFixableOnWeb = WEB_FIXABLE_CLOUD_STATUSES.has(cloud?.status ?? "");
  const cloudFixableByPurchase = PURCHASABLE_CLOUD_STATUSES.has(cloud?.status ?? "");
  const cloudSpec = machineSpec(cloud?.machine);

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}
      // Lets the native large title collapse into the bar on scroll instead of
      // sitting on top of the first card.
      contentInsetAdjustmentBehavior="automatic"
      // The system gesture is the whole affordance — no separate "Refresh" row.
      // A blue tap-to-reload link is a web pattern; iOS relies on the pull
      // itself, and this already surfaces machinesLoading via `refreshing`.
      refreshControl={
        <RefreshControl
          refreshing={machinesLoading}
          onRefresh={() => void refreshMachines()}
          tintColor={colors.textMuted}
        />
      }
    >
      {bindings.length > 0 ? (
        <>
          <SectionLabel>Your machines</SectionLabel>
          <Card>
            {bindings.map((b, i) => {
              const selected = b.id === bindingId;
              return (
                <View key={b.id}>
                  {i > 0 ? <Separator inset="text" /> : null}
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

        {cloudFixableByPurchase ? (
          <>
            <Separator inset="text" />
            <Row onPress={() => router.push("/plan")}>
              <Text style={{ ...type.callout, color: colors.primary, flex: 1 }}>
                See plans
              </Text>
              <Icon ios="chevron.right" android="chevron_right" size={15} color={colors.textMuted} />
            </Row>
          </>
        ) : null}

        {cloudFixableOnWeb ? (
          <>
            <Separator inset="text" />
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
        <Text style={{ color: colors.text }}>omg connect</Text> on it.
      </Text>
    </ScrollView>
  );
}
