import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { useEffect } from "react";
import { AppState, Linking, Platform } from "react-native";
import { HStack, Image, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import { background, bold, cornerRadius, font, foregroundColor, frame, lineLimit, padding, resizable, widgetURL } from "@expo/ui/swift-ui/modifiers";
import { addPushToStartTokenListener, createLiveActivity, type LiveActivityEnvironment } from "expo-widgets";

import { isSharedBindingId } from "./computer-shared-binding";
import { CLOUD_BINDING_ID } from "./config";
import { controlPlane, useOmg } from "./provider";
import { bindingLabel } from "./format";
import { liveActivityRegistration } from "./live-activity-registration";

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
  // Legacy payloads include finished sessions and a total for the whole roster.
  // Show only active previews; the header carries the live fleet counts.
  const sessions = (props.sessions ?? []).filter((session) => session.state === "working" || session.state === "blocked").slice(0, 3);
  const summary = props.blockedCount > 0
    ? `${props.blockedCount} ${props.blockedCount === 1 ? "needs" : "need"} you`
    : props.runningCount > 0 ? `${props.runningCount} working` : "All finished";
  const accent = props.blockedCount > 0 ? "#F0A27D" : "#A4ADFF";
  const url = props.attentionSessionId ? `omg:///session/${encodeURIComponent(props.attentionSessionId)}` : "omg:///";
  const icon = (agent: string, size: number) => (
    <Image assetName={`agent-${keyFor(agent)}`} modifiers={[resizable(), frame({ width: size, height: size }), padding({ all: 3 }), background("#FFFFFF"), cornerRadius(7)]} />
  );
  const list = (expanded = false) => {
    // Lock Screen and Dynamic Island surfaces can stay dark in light mode.
    const ink = "#F2F0EA";
    const muted = "#BDBBB3";
    return (
      <VStack spacing={expanded ? 4 : 10} modifiers={[padding({ horizontal: expanded ? 4 : 16, vertical: expanded ? 0 : 13 }), widgetURL(url)]}>
        <HStack spacing={12}>
          <Text modifiers={[font({ size: expanded ? 15 : 18, weight: "bold" }), foregroundColor(ink), lineLimit(1)]}>{summary}</Text>
          <Spacer />
        </HStack>
        <VStack spacing={3}>
          {sessions.map((session) => (
            <HStack key={session.id} spacing={8} modifiers={[padding({ horizontal: 8 }), frame({ height: expanded ? 24 : 30 }), background(session.state === "blocked" ? "#33271F" : "#00000000"), cornerRadius(10)]}>
              {icon(session.agent, 16)}
              <Text modifiers={[font({ size: 13, weight: "semibold" }), foregroundColor(ink), lineLimit(1), frame({ maxWidth: Infinity, alignment: "leading" })]}>{session.title || labels[keyFor(session.agent)]}</Text>
              <Text modifiers={[font({ size: 12, weight: session.state === "blocked" ? "bold" : "regular" }), foregroundColor(session.state === "blocked" ? accent : muted), lineLimit(1), frame({ width: 68, alignment: "trailing" })]}>{session.state === "blocked" ? "needs you" : session.state === "working" ? "working" : "done"}</Text>
            </HStack>
          ))}
          {sessions.length === 0 ? <Text modifiers={[font({ size: 13 }), foregroundColor(muted)]}>{props.runningCount > 0 || props.blockedCount > 0 ? "Open omg.dev for sessions" : "Your agents have finished"}</Text> : null}
        </VStack>
      </VStack>
    );
  };
  const cluster = <HStack spacing={-6}>{(sessions.length ? sessions : [{ agent: "omg" }]).slice(0, 3).map((session, index) => <HStack key={`${session.agent}-${index}`}>{icon(session.agent, 14)}</HStack>)}</HStack>;
  return {
    banner: <VStack modifiers={[background("#20211E")]}>{list()}</VStack>,
    bannerSmall: <HStack spacing={8}>{cluster}<Text modifiers={[bold(), foregroundColor(accent)]}>{summary}</Text></HStack>,
    compactLeading: cluster,
    compactTrailing: <Text modifiers={[bold(), foregroundColor(accent)]}>{props.blockedCount > 0 ? `! ${props.blockedCount}` : props.runningCount}</Text>,
    minimal: icon(sessions[0]?.agent ?? "omg", 16),
    expandedBottom: list(true),
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

async function registerDevice(bindingId: string, machineName: string, pushToStartToken: string, hasActiveActivity?: boolean): Promise<void> {
  await controlPlane("registerLiveActivityDevice", {
    deviceId: await deviceId(),
    bindingId,
    machineName,
    pushToStartToken,
    ...(hasActiveActivity === undefined ? {} : { hasActiveActivity }),
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

    const currentBinding = bindings.find((binding) => binding.id === bindingId);
    const machineName = currentBinding ? bindingLabel(currentBinding) : "My Computer";
    const registration = liveActivityRegistration({
      getInstances: () => AgentLiveActivity.getInstances(),
      isForeground: () => AppState.currentState === "active",
      registerDevice: (token, hasActiveActivity) => registerDevice(bindingId, machineName, token, hasActiveActivity),
      registerActivity: (id, token) => registerActivityWithRetry(bindingId, id, token),
      onError: console.warn,
    });
    const pushToStartSubscription = addPushToStartTokenListener(({ activityPushToStartToken }) => {
      void registration.onStartToken(activityPushToStartToken);
    });
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void registration.refresh();
    });

    return () => {
      registration.dispose();
      pushToStartSubscription.remove();
      appStateSubscription.remove();
    };
  }, [authStatus, bindingId, bindings]);

  return null;
}
