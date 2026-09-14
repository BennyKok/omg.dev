import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { useEffect } from "react";
import { AppState, Linking, Platform } from "react-native";
import { Circle, HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { background, bold, cornerRadius, font, foregroundColor, frame, lineLimit, padding, resizable, widgetURL } from "@expo/ui/swift-ui/modifiers";
import { addPushToStartTokenListener, createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";

import { isSharedBindingId } from "./computer-shared-binding";
import { CLOUD_BINDING_ID } from "./config";
import { controlPlane, useOmg } from "./provider";
import { bindingLabel } from "./format";

export type ActivitySession = {
  id: string;
  title: string;
  agent: string;
  state: "blocked" | "working" | "done";
};

export type AgentActivityProps = {
  machineName: string;
  runningCount: number;
  blockedCount: number;
  attentionSessionId: string | null;
  updatedAt: number;
  sessions?: ActivitySession[];
  sessionCount?: number;
};

export function AgentActivity(props: AgentActivityProps, environment: LiveActivityEnvironment) {
  "widget";
  const labels: Record<string, string> = { claude: "Claude", codex: "Codex", cursor: "Cursor", copilot: "Copilot", deepseek: "DeepSeek", devin: "Devin", grok: "Grok", hermes: "Hermes", jcode: "Jcode", muse: "Muse", opencode: "OpenCode", pi: "pi", fx: "fx", omg: "omg" };
  const keyFor = (agent: string) => agent === "codex-aisdk" ? "codex" : agent in labels ? agent : "omg";
  const sessions = (props.sessions ?? []).slice(0, 3);
  const total = Math.max(sessions.length, props.sessionCount ?? 0);
  const overflow = total > 3 ? total - 2 : 0;
  const visible = sessions.slice(0, overflow ? 2 : 3);
  const summary = props.blockedCount > 0
    ? `${props.blockedCount} ${props.blockedCount === 1 ? "needs" : "need"} you`
    : props.runningCount > 0 ? `${props.runningCount} working` : "All finished";
  const accent = props.blockedCount > 0 ? "#C86B45" : "#5467FF";
  const url = props.attentionSessionId ? `omg:///session/${encodeURIComponent(props.attentionSessionId)}` : "omg:///";
  const icon = (agent: string, size: number) => (
    <Image assetName={`agent-${keyFor(agent)}`} modifiers={[resizable(), frame({ width: size, height: size }), padding({ all: 3 }), background("#FFFFFF"), cornerRadius(7)]} />
  );
  const list = (dark: boolean, expanded = false) => {
    const ink = dark ? "#F2F0EA" : "#2B2A26";
    const muted = dark ? "#A5A39A" : "#6B6A63";
    return (
      <VStack spacing={expanded ? 4 : 10} modifiers={[padding({ horizontal: expanded ? 4 : 16, vertical: expanded ? 0 : 13 }), widgetURL(url)]}>
        <HStack spacing={12}>
          <Text modifiers={[font({ size: expanded ? 15 : 18, weight: "bold" }), foregroundColor(ink), lineLimit(1)]}>{summary}</Text>
          <Spacer />
          <Circle modifiers={[frame({ width: 5, height: 5 }), foregroundColor(accent)]} />
          <Text modifiers={[font({ size: 11, weight: "medium" }), foregroundColor(muted), lineLimit(1), frame({ maxWidth: 110 })]}>{props.machineName}</Text>
        </HStack>
        <VStack spacing={3}>
          {visible.map((session) => (
            <HStack key={session.id} spacing={8} modifiers={[padding({ horizontal: 8 }), frame({ height: expanded ? 24 : 30 }), background(session.state === "blocked" ? dark ? "#29211C" : "#FBF8F1" : "#00000000"), cornerRadius(10)]}>
              {icon(session.agent, 16)}
              <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundColor(ink), lineLimit(1), frame({ maxWidth: Infinity, alignment: "leading" })]}>{session.title || labels[keyFor(session.agent)]}</Text>
              <Text modifiers={[font({ size: 12, weight: session.state === "blocked" ? "bold" : "regular" }), foregroundColor(session.state === "blocked" ? "#C86B45" : muted), lineLimit(1), frame({ width: 68, alignment: "trailing" })]}>{session.state === "blocked" ? "needs you" : session.state === "working" ? "working" : "done"}</Text>
            </HStack>
          ))}
          {overflow > 0 ? <HStack spacing={8} modifiers={[padding({ horizontal: 8 }), frame({ height: expanded ? 24 : 30 })]}>
            <Text modifiers={[font({ size: 11, weight: "semibold" }), foregroundColor(muted)]}>{`+${overflow}`}</Text>
            <Text modifiers={[font({ size: 13 }), foregroundColor(muted)]}>more sessions</Text>
            <Spacer />
          </HStack> : null}
          {sessions.length === 0 ? <Text modifiers={[font({ size: 13 }), foregroundColor(muted)]}>{props.runningCount > 0 || props.blockedCount > 0 ? "Open omg.dev for sessions" : "Your agents have finished"}</Text> : null}
        </VStack>
      </VStack>
    );
  };
  const cluster = <HStack spacing={-6}>{(sessions.length ? sessions : [{ agent: "omg" }]).slice(0, 3).map((session, index) => <HStack key={`${session.agent}-${index}`}>{icon(session.agent, 14)}</HStack>)}</HStack>;
  return {
    banner: <VStack modifiers={[background(environment.colorScheme === "dark" ? "#20211E" : "#F4F1E8")]}>{list(environment.colorScheme === "dark")}</VStack>,
    bannerSmall: <HStack spacing={8}>{cluster}<Text modifiers={[bold(), foregroundColor(accent)]}>{summary}</Text></HStack>,
    compactLeading: cluster,
    compactTrailing: <Text modifiers={[bold(), foregroundColor(accent)]}>{props.blockedCount > 0 ? `! ${props.blockedCount}` : props.runningCount}</Text>,
    minimal: icon(sessions[0]?.agent ?? "omg", 16),
    expandedBottom: list(true, true),
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
