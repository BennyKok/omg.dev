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
  /** Epoch ms the run began. Drives the elapsed timer; null falls back to a word. */
  startedAt?: number | null;
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
  /**
   * INSIDE the function, not at module scope. The compiled layout string is
   * evaluated on its own in the extension, so a constant declared outside it
   * is simply not there -- the native check caught exactly that.
   *
   * A run has no known end, so the timer's upper bound is out of reach.
   */
  const YEAR_MS = 365 * 24 * 60 * 60 * 1000;
  /**
   * NO RING OF ANY KIND. Both sorts were built, shipped and removed.
   *
   * An INDETERMINATE spinner -- `progressViewStyle("circular")` with no value
   * -- draws as a static empty ring, because a Live Activity runs no animation
   * loop any more than a widget does. It read as an unticked checkbox beside
   * every row.
   *
   * A DETERMINATE ring, `ProgressView(timerInterval:)`, genuinely animates:
   * SwiftUI computes it on the device outside the timeline, like the clock. It
   * was added anyway, against a flat ten-minute horizon, and it failed for the
   * SAME reason as the first rather than a new one. A coding run lasts hours,
   * so the ring sits pinned at full essentially always -- and a full circle
   * that never moves is precisely the static disc the indeterminate one drew.
   * Benny, looking at it on a real row: "maybe remove the circle thing?"
   *
   * The lesson is not "use the other ProgressView". It is that a ring beside
   * an elapsed time has nothing left to say: the clock already moves, and it
   * is exact. Do not add a third one.
   */
  const labels: Record<string, string> = { claude: "Claude", codex: "Codex", cursor: "Cursor", copilot: "Copilot", deepseek: "DeepSeek", devin: "Devin", grok: "Grok", hermes: "Hermes", jcode: "Jcode", muse: "Muse", opencode: "OpenCode", pi: "pi", fx: "fx", omg: "omg" };
  /**
   * MATCHES THE WEB, which is the reference for what an agent looks like.
   *
   * `aisdk` is the Claude runner -- `agent-catalog.ts` maps it to the label
   * "claude", gives it the Claude thinking levels and reads ~/.claude -- and it
   * is the server's DEFAULT agent, so it is the common case rather than an
   * exotic one. This resolved it to the omg mark, and resolved every unknown
   * agent there too, while the web and the home screen widget both land on
   * Claude. The same session showed a different face depending on which
   * surface you opened it from, which agent-icons.ts explicitly warns against.
   */
  const keyFor = (agent: string) =>
    agent === "codex-aisdk" ? "codex"
      : agent === "aisdk" ? "claude"
        : agent in labels ? agent
          : "claude";
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
  /**
   * THE RIGHT-HAND COLUMN: how long it has been running, not the word
   * "working".
   *
   * `Text` with a `timerInterval` is counted by SwiftUI on the device, so the
   * number climbs every second with no push behind it. That matters here: a
   * Live Activity is updated over APNs, and a per-second push is neither
   * allowed nor affordable. The upper bound is a far-future date because the
   * run has no known end; only the lower bound is read while counting up.
   *
   * A session the box never stamped falls back to the old word rather than
   * showing a timer counting from 1970.
   */
  const trailing = (session: ActivitySession, expanded: boolean) => {
    const muted = "#BDBBB3";
    const width = expanded ? 62 : 68;
    if (session.state === "blocked") {
      return (
        <Text modifiers={[font({ size: 12, weight: "bold" }), foregroundColor(accent), lineLimit(1), frame({ width, alignment: "trailing" })]}>needs you</Text>
      );
    }
    if (session.state === "working" && typeof session.startedAt === "number" && session.startedAt > 0) {
      return (
        <Text
          timerInterval={{ lower: new Date(session.startedAt), upper: new Date(session.startedAt + YEAR_MS) }}
          countsDown={false}
          modifiers={[font({ size: 12, weight: "regular" }), foregroundColor(muted), lineLimit(1), frame({ width, alignment: "trailing" })]}
        />
      );
    }
    return (
      <Text modifiers={[font({ size: 12, weight: "regular" }), foregroundColor(muted), lineLimit(1), frame({ width, alignment: "trailing" })]}>{session.state === "working" ? "working" : "done"}</Text>
    );
  };

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
              {trailing(session, expanded)}
            </HStack>
          ))}
          {sessions.length === 0 ? <Text modifiers={[font({ size: 13 }), foregroundColor(muted)]}>{props.runningCount > 0 || props.blockedCount > 0 ? "Open omg.dev for sessions" : "Your agents have finished"}</Text> : null}
        </VStack>
      </VStack>
    );
  };
  // The count represents sessions. The compact marks represent distinct agents.
  const agents = sessions.map(session => keyFor(session.agent)).filter((agent, index, all) => all.indexOf(agent) === index);
  const cluster = <HStack spacing={-6}>{(agents.length ? agents : ["omg"]).map(agent => <HStack key={agent}>{icon(agent, 14)}</HStack>)}</HStack>;
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

  // Opt-in simulator fixture for the compact duplicate-agent regression.
  useEffect(() => {
    if (Platform.OS !== "ios" || process.env.EXPO_PUBLIC_OMG_DEMO !== "1" || process.env.EXPO_PUBLIC_OMG_ARTIFACT_FIXTURE !== "1") return;
    let cancelled = false;
    let cleanup = () => {};
    void (async () => {
      for (const activity of AgentLiveActivity.getInstances()) await activity.end("immediate");
      if (cancelled) return;
      const activity = AgentLiveActivity.start({
        machineName: "Demo Computer", runningCount: 2, blockedCount: 0,
        attentionSessionId: null, updatedAt: Date.now(),
        sessions: [
          { id: "fixture-one", title: "First task", agent: "codex", state: "working" },
          { id: "fixture-two", title: "Second task", agent: "codex-aisdk", state: "working" },
        ],
      }, "omg:///");
      cleanup = () => { void activity.end("immediate").catch(() => {}); };
    })().catch(console.warn);
    return () => { cancelled = true; cleanup(); };
  }, []);

  useEffect(() => {
    if (!__DEV__ || Platform.OS !== "ios") return;
    const subscription = Linking.addEventListener("url", ({ url }) => {
      if (!url.includes("live-activity-preview")) return;
      /*
       * A REPRESENTATIVE payload, not a bare header. Without rows this preview
       * rendered the empty state, which is the one arrangement that cannot
       * show whether the elapsed timer or the progress ring work at all.
       */
      const now = Date.now();
      /*
       * END whatever is already up first. ActivityKit keeps a running activity
       * across app restarts, so a second `start` leaves the OLD content on the
       * Lock Screen and the preview appears not to have changed at all --
       * which is exactly how an hour went into looking at a stale banner.
       */
      for (const live of AgentLiveActivity.getInstances()) {
        void live.end("immediate").catch(() => {});
      }
      AgentLiveActivity.start({
        machineName: "My Computer",
        runningCount: 2,
        blockedCount: 1,
        attentionSessionId: "preview-blocked",
        updatedAt: now,
        sessionCount: 3,
        sessions: [
          { id: "preview-blocked", title: "Fix APNs registration", agent: "codex", state: "blocked", startedAt: now - 22 * 60_000 },
          { id: "preview-working", title: "Refactor worktree cleanup", agent: "claude", state: "working", startedAt: now - 7 * 60_000 },
          { id: "preview-fresh", title: "Widget tinted mode", agent: "cursor", state: "working", startedAt: now - 35_000 },
        ],
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
