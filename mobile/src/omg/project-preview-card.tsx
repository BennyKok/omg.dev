import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, Image, Linking, Modal, Platform, Pressable, SafeAreaView, UIManager, useWindowDimensions, View } from "react-native";
import { router } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Reanimated, { cancelAnimation, Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import {
  inlinePreviewUrl, PREVIEW_LEVEL_LABEL, PROJECT_PREVIEW_RESTART_MESSAGE, PROJECT_PREVIEW_SIMULATOR_PATH, previewLevels, simulatorStatusText,
  type PreviewLevel, type ProjectPreview, type ProjectPreviewSnapshot, type SimulatorStream,
} from "../../../packages/protocol/src/project-preview";
import { EXPO_SIGNUP_LABEL, expoConnectActive, expoConnectMessage, type ExpoAccountSnapshot, type ExpoConnectMode } from "../../../packages/protocol/src/expo-account";
import type { OmgTransport } from "@omg-dev/client";
import { Icon, type GlyphProps } from "../components";
import { STORAGE_KEYS } from "./config";
import { ExpoSigninSheet, type ComputerSocket } from "./expo-signin-sheet";
import { openInAppPage } from "./in-app-browser";
import { getComputerSocketAccess } from "./transport";
import { useOmg } from "./provider";
import { useTheme } from "./theme";
import { Text } from "./text";
import { getAuthToken } from "./auth";
import { AUTH_ORIGIN, AUTH_REQUEST_ORIGIN, CONTROLPLANE_ORIGIN } from "./config";
import { authenticatedPreviewUrl, mintPreviewAppToken, previewAppIdentity, previewAuthRequest, renewPreviewAuth, type PreviewAppIdentity } from "../../../packages/protocol/src/preview-auth";

// Probe before importing: an OTA must not crash a binary without this view.
const WebView: typeof import("react-native-webview").WebView | null =
  Platform.OS !== "web" && UIManager.hasViewManagerConfig("RNCWebView")
    ? require("react-native-webview").WebView : null;

/** The phone the inline frame imitates: an iPhone 15 in points. */
const PHONE_W = 390;
const PHONE_H = 844;

export function ProjectPreviewCard({ sessionId, agentBusy = false }: { sessionId: string | null; agentBusy?: boolean }) {
  const { client, user, bindingId } = useOmg();
  const computerSocket = useMemo<ComputerSocket | undefined>(() => bindingId ? () => getComputerSocketAccess(bindingId) : undefined, [bindingId]);
  return <ProjectPreviewPanel sessionId={sessionId} transport={client?.transport ?? null} email={user?.email} computerSocket={computerSocket} agentBusy={agentBusy} />;
}

/**
 * Counts the agent's finished turns: it goes up each time `busy` falls from
 * true to false. Used as a key, so the framed preview reloads after each turn.
 * Metro's hot reload does not always reach the framed page (a new tab in an
 * Expo Router layout needs a full reload), and the card kept showing 3 tabs
 * after the agent had built 4 (walkthrough 2026-09-29).
 */
export function useAgentTurnRevision(busy: boolean): number {
  const [revision, setRevision] = useState(0);
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) setRevision((value) => value + 1);
    wasBusy.current = busy;
  }, [busy]);
  return revision;
}

/** How long the green "up to date" mark stays after a turn ends. */
export const PREVIEW_SETTLE_MS = 2_500;

export type PreviewFreshness = "building" | "updated" | null;

/**
 * Whether the preview can still change. "building" while the agent runs a
 * turn: the preview is often up long before the app is done. "updated" for a
 * moment after the turn ends and the frame reloads, then null.
 */
export function usePreviewFreshness(busy: boolean, settleMs = PREVIEW_SETTLE_MS): PreviewFreshness {
  const [updated, setUpdated] = useState(false);
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (busy) { wasBusy.current = true; setUpdated(false); return; }
    if (!wasBusy.current) return;
    wasBusy.current = false;
    setUpdated(true);
    const timer = setTimeout(() => setUpdated(false), settleMs);
    return () => clearTimeout(timer);
  }, [busy, settleMs]);
  return busy ? "building" : updated ? "updated" : null;
}

export const PREVIEW_BUILDING_LABEL = "Still building, updates live";
export const PREVIEW_UPDATED_LABEL = "Up to date";

/**
 * A small dot on the card's icon, with no text. Amber and slowly breathing
 * while the agent works; a green check when the turn ends, which fades out.
 * Reduced motion keeps both marks static. The words are the accessibility label.
 */
function FreshnessDot({ state }: { state: PreviewFreshness }) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(1);
  const scale = useSharedValue(1);
  useEffect(() => {
    cancelAnimation(opacity);
    cancelAnimation(scale);
    opacity.value = 1;
    scale.value = 1;
    if (reducedMotion || !state) return;
    if (state === "building") {
      const half = { duration: 1_200, easing: Easing.inOut(Easing.ease) };
      opacity.value = withRepeat(withSequence(withTiming(0.45, half), withTiming(1, half)), -1, false);
      scale.value = withRepeat(withSequence(withTiming(0.8, half), withTiming(1, half)), -1, false);
    } else {
      scale.value = withSequence(withTiming(0.6, { duration: 0 }), withTiming(1, { duration: 300, easing: Easing.out(Easing.back(2)) }));
      opacity.value = withSequence(withTiming(1, { duration: PREVIEW_SETTLE_MS * 0.7 }), withTiming(0, { duration: PREVIEW_SETTLE_MS * 0.3 }));
    }
    return () => { cancelAnimation(opacity); cancelAnimation(scale); };
  }, [state, reducedMotion, opacity, scale]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));
  if (!state) return null;
  const building = state === "building";
  const size = building ? 10 : 14;
  return <Reanimated.View testID="project-preview-freshness" accessible accessibilityRole="image"
    accessibilityLabel={building ? PREVIEW_BUILDING_LABEL : PREVIEW_UPDATED_LABEL}
    style={[{ position: "absolute", top: -(size / 2) + 1, right: -(size / 2) + 1, width: size, height: size, borderRadius: size / 2,
      backgroundColor: building ? colors.warning : colors.success, borderWidth: 2, borderColor: colors.card,
      alignItems: "center", justifyContent: "center" }, animated]}>
    {building ? null : <Icon ios="checkmark" android="check" size={7} color="#fff" />}
  </Reanimated.View>;
}

export function ProjectPreviewPanel({ sessionId, transport, email, onOpenComputer = openComputer, initialLevel = "web", computerSocket, agentBusy = false }: {
  sessionId: string | null; transport: Pick<OmgTransport, "request"> | null; email?: string;
  /** True while the agent runs a turn. The preview reloads when a turn ends. */
  agentBusy?: boolean;
  /** The Computer screen stream the Expo sign-in sheet crops. */
  computerSocket?: ComputerSocket;
  /** The level a new preview opens on. Web for every real card; the simulator E2E harness starts on "device". */
  initialLevel?: PreviewLevel;
  /** Shows the Computer screen, where the Expo login page is open. */
  onOpenComputer?: () => void;
}) {
  const { colors } = useTheme();
  const frameRevision = useAgentTurnRevision(agentBusy);
  const freshness = usePreviewFreshness(agentBusy);
  const [preview, setPreview] = useState<ProjectPreview | null>(null);
  // Open by default: the inline web preview is the first thing a new Expo
  // app shows. A person who closed it once keeps it closed on this device.
  const [guide, setGuideState] = useState(true);
  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEYS.previewCardExpanded)
      .then((value) => { if (value === "0" && mounted.current) setGuideState(false); })
      .catch(() => {});
  }, []);
  // Web is level 1 and the default for every new preview.
  const [level, setLevelState] = useState<PreviewLevel>(initialLevel);
  const [info, setInfo] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [simulator, setSimulator] = useState<SimulatorStream | undefined>(undefined);
  // The Computer's Expo CLI account. null: an older Computer without the
  // route, or Android, so the card keeps "Open in Expo Go" as before.
  const [account, setAccount] = useState<ExpoAccountSnapshot | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectBusy, setConnectBusy] = useState(false);
  // The Expo sign-in sheet. `run` is the connect run it belongs to, once the
  // Computer answers; the sheet closes itself when that run ends.
  const [sheet, setSheet] = useState<{ mode: ExpoConnectMode; run?: number } | null>(null);
  const signedIn = account?.signedIn === true;
  const runStatus = account?.connect;
  useEffect(() => {
    if (!sheet) return;
    if (signedIn || (sheet.run !== undefined && runStatus?.startedAt === sheet.run && !expoConnectActive(runStatus))) setSheet(null);
  }, [sheet, signedIn, runStatus]);
  const setGuide = (value: boolean) => {
    setGuideState(value);
    void AsyncStorage.setItem(STORAGE_KEYS.previewCardExpanded, value ? "1" : "0").catch(() => {});
  };
  const [live, setLive] = useState<boolean | undefined>(undefined);
  const [expired, setExpired] = useState(false);
  const [restartAsked, setRestartAsked] = useState(false);
  const mounted = useRef(true);
  const suffix = `?sessionId=${encodeURIComponent(sessionId ?? "")}&user=${encodeURIComponent(email ?? "")}`;
  const refresh = useCallback(async () => {
    if (!transport || !sessionId || AppState.currentState !== "active") return;
    try {
      const data = await transport.request<ProjectPreviewSnapshot>(`/api/project-preview${suffix}`);
      if (!mounted.current) return;
      // A preview that has never answered is still starting: no card yet,
      // so a new Expo link does not read as "Stopped" while Metro boots.
      setPreview(data.starting ? null : data.preview ?? null);
      setLive(data.live);
      setExpired(data.expired === true);
      setSimulator(data.simulator);
      // Only an iPhone needs the Computer's Expo account; Android's Expo Go
      // opens the project without one. Older Computers have no check.
      if (Platform.OS === "ios" && data.preview?.expoGoUrl) {
        const next = await transport.request<ExpoAccountSnapshot>(`/api/expo-account${suffix}`).catch(() => null);
        if (mounted.current) setAccount(typeof next?.signedIn === "boolean" ? next : null);
      }
    } catch { /* Compatible with Computers from before preview cards. */ }
  }, [transport, sessionId, suffix]);
  useEffect(() => {
    mounted.current = true;
    setPreview(null);
    void refresh();
    const poll = setInterval(() => void refresh(), 3_000);
    const app = AppState.addEventListener("change", () => void refresh());
    return () => { mounted.current = false; clearInterval(poll); app.remove(); };
  }, [refresh]);
  // A new preview row means the agent restarted it; allow another restart ask
  // and start again from the web level.
  useEffect(() => { setRestartAsked(false); setLevelState(initialLevel); }, [preview?.createdAt, initialLevel]);
  if (!preview) return null;
  const expoGoUrl = preview.expoGoUrl;
  const stopped = live === false;
  const levels: PreviewLevel[] = expoGoUrl ? previewLevels({ simulator }) : ["web"];
  const current: PreviewLevel = levels.includes(level) ? level : "web";
  const simulatorAction = async (action: "start" | "stop") => {
    if (!transport) return;
    try {
      await transport.request(`${PROJECT_PREVIEW_SIMULATOR_PATH}${suffix}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
    } catch { /* The next poll shows the real state. */ }
    void refresh();
  };
  const setLevel = (next: PreviewLevel) => {
    // Leaving the simulator frees it now instead of after the idle timeout.
    const sim = simulator?.state;
    if (current === "simulator" && next !== "simulator" && (sim === "starting" || sim === "ready" || sim === "queued")) void simulatorAction("stop");
    setLevelState(next);
    if (!guide) setGuide(true);
  };
  const postAccount = async (action: "connect" | "cancel", mode?: ExpoConnectMode) => {
    if (!transport || !sessionId) return;
    // The sheet opens on the tap; the Computer takes a moment to open the page.
    if (action === "connect" && mode) setSheet({ mode });
    setConnectBusy(true);
    setConnectError(null);
    try {
      const snapshot = await transport.request<ExpoAccountSnapshot>(`/api/expo-account/${action}${suffix}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode ? { mode } : {}),
      });
      if (!mounted.current) return;
      if (snapshot && typeof snapshot.signedIn === "boolean") setAccount(snapshot);
      if (action === "connect" && mode) setSheet((open) => open ? { mode, run: snapshot?.connect?.startedAt } : open);
    } catch (error) {
      if (action === "connect") setSheet(null);
      if (mounted.current) setConnectError(error instanceof Error && error.message ? error.message : "Could not start Expo sign-in. Try again.");
    } finally {
      if (mounted.current) setConnectBusy(false);
    }
  };
  // Only an iPhone checks the account (see refresh). No account answer keeps
  // today's "Open in Expo Go".
  const expoAccount = expoGoUrl && !stopped ? account : null;
  const connecting = expoConnectActive(expoAccount?.connect);
  const needsConnect = !!expoAccount && !expoAccount.signedIn;
  const restart = async () => {
    if (!transport || !sessionId || restartAsked) return;
    setRestartAsked(true);
    try {
      await transport.request(`/api/sessions/${encodeURIComponent(sessionId)}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: PROJECT_PREVIEW_RESTART_MESSAGE }),
      });
    } catch { setRestartAsked(false); }
  };
  const openExpoGo = async () => {
    // Opening an unregistered scheme rejects, so a failure means Expo Go is
    // not installed. canOpenURL would need a native scheme allowlist.
    try { await Linking.openURL(expoGoUrl!); } catch { setGuideState(true); }
  };
  const status = expired ? "Link expired" : stopped ? "Stopped" : expoGoUrl ? null : "Live preview";
  const onPhoneLevel = !!expoGoUrl && current === "device";
  const openWebPreview = () => {
    if (expoGoUrl && WebView) setFullscreen(true);
    else void openInAppPage(preview.url);
  };
  // Expanded, the level itself holds its action; the one-line card keeps it.
  const primary = stopped || (expoGoUrl && guide) ? null
    : onPhoneLevel && needsConnect
      ? connecting ? null : { id: "project-preview-connect-expo", label: "Connect Expo", disabled: connectBusy, onPress: () => void postAccount("connect", "login") }
      : onPhoneLevel
        ? { id: "project-preview-expo-go", label: "Open in Expo Go", disabled: false, onPress: () => void openExpoGo() }
        : { id: "project-preview-open", label: expoGoUrl ? "Web preview" : "Open preview", disabled: false, onPress: openWebPreview };
  return <>
  <Modal visible={fullscreen && !stopped} animationType="slide" onRequestClose={() => setFullscreen(false)}>
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Close web preview" testID="project-preview-fullscreen-close"
        onPress={() => setFullscreen(false)} style={{ minHeight: 44, paddingHorizontal: 20, justifyContent: "center" }}>
        <Text style={{ color: colors.primary, fontWeight: "600" }}>Done</Text>
      </Pressable>
      {fullscreen && !stopped ? <PhoneFrame key={`${preview.sessionId}-${frameRevision}`} uri={inlinePreviewUrl(preview)} identity={previewAppIdentity(preview)} ownerEmail={email} testID="project-preview-fullscreen-web" fullscreen /> : null}
    </SafeAreaView>
  </Modal>
  {sheet && transport && !signedIn ? <ExpoSigninSheet mode={sheet.mode} transport={transport} socket={computerSocket}
    onClose={() => { setSheet(null); void postAccount("cancel"); }}
    // A page sheet stays above every screen, so it steps aside for the Computer.
    onOpenComputer={() => { setSheet(null); onOpenComputer(); }} /> : null}
  <View testID="project-preview-card" style={{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderRadius: 16, paddingVertical: 6, paddingLeft: 8, paddingRight: 6, gap: 8 }}>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 }}>
      <Pressable accessibilityRole="button" testID="project-preview-toggle" disabled={!expoGoUrl || stopped}
        accessibilityState={expoGoUrl && !stopped ? { expanded: guide } : undefined}
        onPress={() => setGuide(!guide)}
        style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 }}>
        <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }}>
          {expoGoUrl
            ? <Icon ios="iphone" android="smartphone" size={17} color={colors.primary} />
            : <Icon ios="globe" android="public" size={17} color={colors.primary} />}
          {stopped ? null : <FreshnessDot state={freshness} />}
        </View>
        <Text numberOfLines={1} style={{ flexShrink: 1, color: colors.foreground, fontSize: 15, fontWeight: "600" }}>{preview.title}</Text>
        {status ? <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{status}</Text> : null}
        {expoGoUrl && !stopped
          ? <Icon ios={guide ? "chevron.up" : "chevron.down"} android={guide ? "expand_less" : "expand_more"} size={13} color={colors.mutedForeground} />
          : null}
      </Pressable>
      {primary ? <Pressable accessibilityRole="button" testID={primary.id} disabled={primary.disabled} onPress={primary.onPress} style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 999, backgroundColor: primary.disabled ? colors.muted : colors.primary, justifyContent: "center" }}>
        <Text style={{ color: primary.disabled ? colors.mutedForeground : colors.primaryForeground, fontWeight: "600", fontSize: 14 }}>{primary.label}</Text>
      </Pressable> : null}
      {!stopped && !expoGoUrl
        ? <Pressable accessibilityRole="button" accessibilityLabel="Open preview in Safari" onPress={() => void Linking.openURL(preview.url)} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}>
            <Icon ios="arrow.up.forward.app" android="open_in_new" size={18} color={colors.mutedForeground} />
          </Pressable>
        : null}
    </View>
    {stopped ? <View testID="project-preview-stopped" style={{ gap: 10, paddingHorizontal: 4, paddingBottom: 6 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 14 }}>{expired
        ? "The Expo Go link expired. Restart the preview to get a new one."
        : "The development server is not running. This happens when the Computer sleeps."}</Text>
      <Pressable accessibilityRole="button" testID="project-preview-restart" disabled={restartAsked} onPress={() => void restart()} style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: restartAsked ? colors.muted : colors.primary, justifyContent: "center" }}>
        <Text style={{ color: restartAsked ? colors.mutedForeground : colors.primaryForeground, fontWeight: "600", textAlign: "center" }}>{restartAsked ? "Asked the agent to restart it" : "Restart preview"}</Text>
      </Pressable>
    </View> : expoGoUrl && guide ? <View testID="project-preview-details" style={{ gap: 8, paddingHorizontal: 4, paddingBottom: 2 }}>
      {current === "web"
        ? <PhoneFrame key={frameRevision} uri={inlinePreviewUrl(preview)} identity={previewAppIdentity(preview)} ownerEmail={email} testID="project-preview-web" onFallback={() => void openInAppPage(preview.url)} />
        : current === "simulator" && simulator
        ? <SimulatorLevel stream={simulator} webUrl={inlinePreviewUrl(preview)} identity={previewAppIdentity(preview)} ownerEmail={email} onStart={() => void simulatorAction("start")} />
        : <DeviceLevel account={expoAccount} connecting={connecting} busy={connectBusy} error={connectError}
            onOpen={() => void openExpoGo()} onConnect={(mode) => void postAccount("connect", mode)}
            onOpenComputer={() => setSheet({ mode: account?.connect?.state === "signup" ? "signup" : "login", run: account?.connect?.startedAt })}
            onCancel={() => void postAccount("cancel")} />}
      {/* The level switcher sits under the preview, as icons. */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <View accessibilityRole="tablist" testID="project-preview-levels" style={{ flexDirection: "row", backgroundColor: colors.muted, borderRadius: 10, padding: 2 }}>
          {levels.map((item) => <Pressable key={item} accessibilityRole="tab" accessibilityLabel={PREVIEW_LEVEL_LABEL[item]} accessibilityState={{ selected: current === item }} testID={`project-preview-level-${item}`}
            onPress={() => setLevel(item)}
            style={{ width: 44, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: current === item ? colors.card : "transparent" }}>
            <LevelIcon level={item} color={current === item ? colors.foreground : colors.mutedForeground} />
          </Pressable>)}
        </View>
        <View style={{ flex: 1 }} />
        {current === "web" ? <Pressable accessibilityRole="button" accessibilityLabel="Full screen web preview" testID="project-preview-fullscreen" onPress={openWebPreview} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}>
          <Icon ios="arrow.up.left.and.arrow.down.right" android="fullscreen" size={17} color={colors.mutedForeground} />
        </Pressable> : null}
        <Pressable accessibilityRole="button" accessibilityLabel={current === "device" ? DEVICE_INFO : PRIVATE_INFO} testID="project-preview-info" onPress={() => setInfo(!info)} style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}>
          <Icon ios="info.circle" android="info" size={17} color={colors.mutedForeground} />
        </Pressable>
      </View>
      {info ? <Text testID="project-preview-info-text" style={{ color: colors.mutedForeground, fontSize: 13 }}>
        {current === "device" ? DEVICE_INFO : PRIVATE_INFO}
        {current === "device" ? <>{" "}<Text testID="project-preview-get-expo-go" accessibilityRole="link" onPress={() => void Linking.openURL(Platform.OS === "android" ? EXPO_GO_ANDROID : EXPO_GO_IOS)} style={{ color: colors.primary, fontWeight: "600" }}>Get Expo Go</Text></> : null}
      </Text> : null}
    </View> : null}
  </View>
  </>;
}

/**
 * A page at phone size: the WebView is 390x844 points, so the app lays out as
 * on an iPhone, then scaled to fit about half of the screen above the composer.
 * A binary without the WebView falls back to the in-app browser.
 */
function PhoneFrame({ uri, identity, ownerEmail, testID, onFallback, stream, children, fullscreen = false }: {
  uri: string; identity?: PreviewAppIdentity | null; ownerEmail?: string; testID: string; onFallback?: () => void; stream?: boolean; children?: React.ReactNode; fullscreen?: boolean;
}) {
  const { colors } = useTheme();
  const { height, width } = useWindowDimensions();
  const frameH = fullscreen ? Math.max(200, height - 120) : Math.min(520, Math.round(height * 0.46));
  const scale = fullscreen ? Math.min(frameH / PHONE_H, width / PHONE_W) : frameH / PHONE_H;
  const frame = useRef<import("react-native-webview").WebView<object>>(null);
  const loadedOrigin = useRef<string | null>(null);
  const [authenticatedUri, setAuthenticatedUri] = useState<string | null>(null);
  const [authFailed, setAuthFailed] = useState(false);
  const appId = identity?.appId;
  const projectId = identity?.projectId;
  const authority = useMemo(() => ({ uri, appId, projectId, ownerEmail, live: true }), [uri, appId, projectId, ownerEmail]);
  const currentAuthority = useRef(authority);
  currentAuthority.current = authority;
  useEffect(() => { authority.live = true; return () => { authority.live = false; }; }, [authority]);
  const mint = useCallback(() => appId && projectId ? mintPreviewAppToken({ appId, projectId, previewUrl: uri }, {
    getAccessToken: getAuthToken, authOrigin: AUTH_ORIGIN, controlPlaneOrigin: CONTROLPLANE_ORIGIN, requestOrigin: AUTH_REQUEST_ORIGIN,
  }) : Promise.resolve(null), [appId, projectId, uri]);
  useEffect(() => {
    if (!appId || !projectId) { setAuthenticatedUri(uri); return; }
    let live = true;
    setAuthenticatedUri(null);
    setAuthFailed(false);
    void mint().then(credential => {
      if (!live) return;
      if (credential) setAuthenticatedUri(authenticatedPreviewUrl(credential.previewUrl, appId, credential.token));
      else setAuthFailed(true);
    }).catch(() => { if (live) setAuthFailed(true); });
    return () => { live = false; };
  }, [uri, appId, projectId, ownerEmail, mint]);
  if (!WebView) {
    return <Pressable accessibilityRole="button" testID={`${testID}-fallback`} onPress={onFallback} style={{ minHeight: 44, borderRadius: 12, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: colors.primary, fontWeight: "600" }}>Open web preview</Text>
    </Pressable>;
  }
  return <View testID={testID} style={{ alignSelf: "center", width: Math.round(PHONE_W * scale), height: frameH, borderRadius: 20, borderWidth: 3, borderColor: colors.foreground, overflow: "hidden", backgroundColor: colors.bg }}>
    {authenticatedUri ? <WebView ref={frame} source={{ uri: authenticatedUri }} style={{ flex: 0, width: PHONE_W, height: PHONE_H, transformOrigin: "top left", transform: [{ scale }] }}
      onLoadStart={event => {
        try { loadedOrigin.current = new URL(event.nativeEvent.url).origin; }
        catch { loadedOrigin.current = null; }
      }}
      onMessage={async event => {
        if (!appId || !projectId) return;
        let data: unknown;
        try {
          if (!authenticatedUri || new URL(event.nativeEvent.url).origin !== new URL(authenticatedUri).origin) return;
          data = JSON.parse(event.nativeEvent.data);
        } catch { return; }
        const request = previewAuthRequest(data, appId);
        if (!request) return;
        const target = frame.current;
        const expectedOrigin = new URL(authenticatedUri!).origin;
        const response = await renewPreviewAuth(request, mint, () => authority.live && currentAuthority.current === authority && frame.current === target && loadedOrigin.current === expectedOrigin);
        if (response) target?.injectJavaScript(`window.__omgReceivePreviewAuth?.(${JSON.stringify(response)}); true;`);
      }}
      scrollEnabled={!stream} bounces={false} allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false}
      sharedCookiesEnabled={!identity} keyboardDisplayRequiresUserAction={false} setSupportMultipleWindows={false} /> : <Text style={{ padding: 16, color: colors.mutedForeground }}>{authFailed ? "Preview sign-in failed. Reload the preview to try again." : "Preparing preview…"}</Text>}
    {children}
  </View>;
}

/** Level 2. Until the stream is ready the web preview stays in the frame under a status line. */
function SimulatorLevel({ stream, webUrl, identity, ownerEmail, onStart }: { stream: SimulatorStream; webUrl: string; identity?: PreviewAppIdentity | null; ownerEmail?: string; onStart(): void }) {
  const { colors } = useTheme();
  const status = simulatorStatusText(stream);
  if (!status && stream.streamUrl) {
    return <ReadySimulatorFrame key={stream.streamId ?? stream.streamUrl} uri={stream.streamUrl} />;
  }
  const canStart = stream.state === "idle" || stream.state === "error";
  return <PhoneFrame uri={webUrl} identity={identity} ownerEmail={ownerEmail} testID="project-preview-simulator-waiting">
    <View testID="project-preview-simulator-status" style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 10, gap: 8, backgroundColor: colors.card }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>{status}</Text>
      {canStart ? <Pressable accessibilityRole="button" testID="project-preview-simulator-start" onPress={onStart} style={{ minHeight: 36, borderRadius: 999, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: colors.primaryForeground, fontWeight: "600" }}>{stream.state === "error" ? "Try again" : "Start simulator"}</Text>
      </Pressable> : null}
    </View>
  </PhoneFrame>;
}

/** The stream page renews its own token. Status polls must preserve its document. */
function ReadySimulatorFrame({ uri }: { uri: string }) {
  const [entryUri] = useState(uri);
  return <PhoneFrame uri={entryUri} testID="project-preview-simulator" stream />;
}

function openComputer() { router.push("/computer"); }

function LevelIcon({ level, color }: { level: PreviewLevel; color: string }) {
  if (level === "web") return <Icon ios="globe" android="public" size={16} color={color} />;
  if (level === "simulator") return <Icon ios="ipad.and.iphone" android="devices" size={16} color={color} />;
  return <Icon ios="iphone" android="smartphone" size={16} color={color} />;
}
const DEVICE_INFO = "An iPhone opens the app only when Expo Go and the Computer use the same Expo account. Android needs no account.";
const PRIVATE_INFO = "Private to you. The link is temporary.";

const EXPO_LOGO = require("../../assets/brand/expo-logo.png");

/**
 * Level 3 on the phone that runs Expo Go. Signed out: the Expo mark, one
 * line and two buttons, "Create free account" and "I have one". Signed in:
 * three short steps. The account rule is behind the info icon.
 */
function DeviceLevel({ account, connecting, busy, error, onOpen, onConnect, onOpenComputer, onCancel }: {
  account: ExpoAccountSnapshot | null; connecting: boolean; busy: boolean; error: string | null;
  onOpen(): void; onConnect(mode: ExpoConnectMode): void; onOpenComputer(): void; onCancel(): void;
}) {
  const { colors } = useTheme();
  const signedOut = !!account && !account.signedIn;
  const last = account?.connect && !connecting && account.connect.state !== "done" ? expoConnectMessage(account.connect) : null;
  const pill = (id: string, label: string, onPress: () => void, primary = true, icon = false) =>
    <Pressable key={id} accessibilityRole="button" testID={id} disabled={busy} onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: 16, borderRadius: 999,
        backgroundColor: busy ? colors.muted : primary ? colors.primary : "transparent", borderWidth: primary ? 0 : 1, borderColor: colors.border }}>
      {icon ? <Icon ios="iphone" android="smartphone" size={15} color={busy ? colors.mutedForeground : colors.primaryForeground} /> : null}
      <Text style={{ color: busy ? colors.mutedForeground : primary ? colors.primaryForeground : colors.foreground, fontWeight: "600", fontSize: 15 }}>{label}</Text>
    </Pressable>;
  if (account?.signedIn) {
    return <View testID="project-preview-device" style={{ paddingVertical: 6 }}>
      <View testID="project-preview-expo-steps" style={{ gap: 2 }}>
        <StepRow ios="arrow.down.circle" android="download">
          <Text style={{ color: colors.foreground, fontSize: 14 }}>Get Expo Go </Text>
          <Text testID="project-preview-get-expo-go" accessibilityRole="link" onPress={() => void Linking.openURL(EXPO_GO_IOS)} style={{ color: colors.primary, fontSize: 14, fontWeight: "600" }}>App Store</Text>
        </StepRow>
        <StepRow ios="person.crop.circle" android="account_circle">
          <Text testID="project-preview-expo-account" style={{ color: colors.foreground, fontSize: 14 }}>Sign in as <Text style={{ fontWeight: "600" }}>{account.username ?? "your Expo account"}</Text></Text>
          <View testID="project-preview-expo-computer-ok" accessibilityLabel="The Computer is signed in" style={{ marginLeft: 6 }}>
            <Icon ios="checkmark.circle.fill" android="check_circle" size={15} color={colors.success} />
          </View>
        </StepRow>
        <StepRow ios="iphone" android="smartphone">
          <Text testID="project-preview-expo-go" accessibilityRole="link" onPress={onOpen} style={{ color: colors.primary, fontSize: 14, fontWeight: "600" }}>Open in Expo Go</Text>
        </StepRow>
      </View>
      {error ? <Text testID="project-preview-expo-connect-error" style={{ color: colors.destructive, fontSize: 13 }}>{error}</Text> : null}
    </View>;
  }
  return <View testID="project-preview-device" style={{ alignItems: "center", gap: 8, paddingVertical: 10 }}>
    {connecting
      ? pill("project-preview-open-sheet", "Show Expo page", onOpenComputer)
      : signedOut
        ? <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Image source={EXPO_LOGO} style={{ width: 18, height: 18, tintColor: colors.foreground }} accessibilityLabel="Expo" testID="expo-logo" />
              <Text testID="project-preview-expo-connect-status" style={{ color: last ? colors.mutedForeground : colors.foreground, fontSize: 14, fontWeight: last ? "400" : "600" }}>{last ?? "Preview on your iPhone"}</Text>
            </View>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {pill("project-preview-expo-signup", EXPO_SIGNUP_LABEL, () => onConnect("signup"))}
              {pill("project-preview-connect-expo", "I have one", () => onConnect("login"), false)}
            </View>
          </>
        : pill("project-preview-expo-go", "Open in Expo Go", onOpen, true, true)}
    {connecting && account?.connect
      ? <View testID="project-preview-expo-connect" style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text testID="project-preview-expo-connect-status" style={{ color: colors.mutedForeground, fontSize: 13 }}>{expoConnectMessage(account.connect)}</Text>
          <Pressable accessibilityRole="link" testID="project-preview-cancel-expo" disabled={busy} onPress={onCancel} style={{ minHeight: 32, justifyContent: "center" }}>
            <Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "600" }}>Cancel</Text>
          </Pressable>
        </View>
      : null}
    {error ? <Text testID="project-preview-expo-connect-error" style={{ color: colors.destructive, fontSize: 13 }}>{error}</Text> : null}
  </View>;
}

/** One checklist line: an icon, then short text. */
function StepRow({ ios, android, children }: Extract<GlyphProps, { ios: unknown }> & { children: React.ReactNode }) {
  const { colors } = useTheme();
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 32 }}>
    <Icon ios={ios} android={android} size={17} color={colors.mutedForeground} />
    <View style={{ flexDirection: "row", alignItems: "center", flexShrink: 1 }}>{children}</View>
  </View>;
}

const EXPO_GO_IOS = "https://apps.apple.com/app/expo-go/id982107779";
const EXPO_GO_ANDROID = "https://play.google.com/store/apps/details?id=host.exp.exponent";
