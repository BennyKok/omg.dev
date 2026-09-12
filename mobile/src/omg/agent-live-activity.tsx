import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { useEffect } from "react";
import { AppState, Linking, Platform } from "react-native";
import { HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { bold, font, foregroundColor, padding, widgetURL } from "@expo/ui/swift-ui/modifiers";
import { addPushToStartTokenListener, createLiveActivity } from "expo-widgets";

import { isSharedBindingId } from "./computer-shared-binding";
import { CLOUD_BINDING_ID } from "./config";
import { controlPlane, useOmg } from "./provider";
import { bindingLabel } from "./format";

export type AgentActivityProps = {
  machineName: string;
  runningCount: number;
  blockedCount: number;
  attentionSessionId: string | null;
  updatedAt: number;
};

function AgentActivity(props: AgentActivityProps) {
  "widget";
  const summary = props.blockedCount > 0
    ? `${props.blockedCount} need attention`
    : props.runningCount > 0
      ? `${props.runningCount} working`
      : "All agents finished";
  const symbol = props.blockedCount > 0 ? "exclamationmark.circle.fill" : "sparkles";
  const color = props.blockedCount > 0 ? "#FF9F0A" : "#7C5CFC";
  const displayCount = props.blockedCount > 0 ? props.blockedCount : props.runningCount;
  const url = props.attentionSessionId ? `omg:///session/${props.attentionSessionId}` : "omg:///";
  const compact = (
    <HStack spacing={4}>
      <Image systemName={symbol} size={14} modifiers={[foregroundColor(color)]} />
      <Text modifiers={[bold(), foregroundColor(color)]}>{displayCount}</Text>
    </HStack>
  );
  const banner = (
    <HStack spacing={12} modifiers={[padding({ horizontal: 16, vertical: 12 }), widgetURL(url)]}>
      <Image systemName={symbol} size={26} modifiers={[foregroundColor(color)]} />
      <VStack alignment="leading" spacing={2}>
        <Text modifiers={[bold(), font({ size: 16 })]}>omg.dev</Text>
        <Text>{summary}</Text>
        <Text modifiers={[foregroundColor("#8E8E93"), font({ size: 12 })]}>{props.machineName}</Text>
      </VStack>
      <Spacer />
    </HStack>
  );
  return {
    banner,
    bannerSmall: compact,
    compactLeading: <Image systemName={symbol} size={14} modifiers={[foregroundColor(color)]} />,
    compactTrailing: <Text modifiers={[bold(), foregroundColor(color)]}>{displayCount}</Text>,
    minimal: <Image systemName={symbol} size={14} modifiers={[foregroundColor(color)]} />,
    expandedCenter: banner,
  };
}

export const AgentLiveActivity = createLiveActivity<AgentActivityProps>("OmgAgentsActivity", AgentActivity);

const DEVICE_ID_KEY = "omg.liveActivity.deviceId";

async function deviceId(): Promise<string> {
  const saved = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (saved) return saved;
  const created = Crypto.randomUUID();
  await AsyncStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

async function registerDevice(bindingId: string, machineName: string, pushToStartToken: string): Promise<void> {
  await controlPlane("registerLiveActivityDevice", {
    deviceId: await deviceId(),
    bindingId,
    machineName,
    pushToStartToken,
  });
}

async function registerActivity(bindingId: string, activityId: string, pushToken: string): Promise<void> {
  await controlPlane("registerLiveActivityToken", {
    deviceId: await deviceId(),
    bindingId,
    activityId,
    pushToken,
  });
}

async function registerActivityWithRetry(bindingId: string, activityId: string, pushToken: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await registerActivity(bindingId, activityId, pushToken);
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

/** Registers ActivityKit tokens. The hosted control plane owns APNs and the
 * selected Computer owns the aggregate status. */
export function AgentLiveActivityBridge() {
  const { authStatus, bindingId, bindings } = useOmg();

  useEffect(() => {
    if (!__DEV__ || Platform.OS !== "ios") return;
    const subscription = Linking.addEventListener("url", ({ url }) => {
      if (!url.includes("live-activity-preview")) return;
      AgentLiveActivity.start({
        machineName: "My Computer",
        runningCount: 3,
        blockedCount: 1,
        attentionSessionId: null,
        updatedAt: Date.now(),
      }, "omg:///");
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (
      Platform.OS !== "ios" ||
      authStatus !== "signed-in" ||
      !bindingId ||
      bindingId === CLOUD_BINDING_ID ||
      isSharedBindingId(bindingId)
    ) return;

    let disposed = false;
    const activitySubscriptions: Array<{ remove(): void }> = [];
    const attachedActivityIds = new Set<string>();
    const reportInstances = async () => {
      for (const instance of AgentLiveActivity.getInstances()) {
        if (attachedActivityIds.has(instance.getId())) continue;
        attachedActivityIds.add(instance.getId());
        const report = (event: { activityId: string; pushToken: string }) => {
          if (!disposed) void registerActivityWithRetry(bindingId, event.activityId, event.pushToken).catch(console.warn);
        };
        activitySubscriptions.push(instance.addPushTokenListener(report));
        const pushToken = await instance.getPushToken();
        if (pushToken && !disposed) await registerActivityWithRetry(bindingId, instance.getId(), pushToken);
      }
    };

    const currentBinding = bindings.find((binding) => binding.id === bindingId);
    const machineName = currentBinding ? bindingLabel(currentBinding) : "My Computer";
    const pushToStartSubscription = addPushToStartTokenListener(({ activityPushToStartToken }) => {
      if (!disposed) void registerDevice(bindingId, machineName, activityPushToStartToken).catch(console.warn);
    });
    void reportInstances().catch(console.warn);
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void reportInstances().catch(console.warn);
    });

    return () => {
      disposed = true;
      pushToStartSubscription.remove();
      appStateSubscription.remove();
      for (const subscription of activitySubscriptions) subscription.remove();
    };
  }, [authStatus, bindingId, bindings]);

  return null;
}
