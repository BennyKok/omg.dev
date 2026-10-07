import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, StyleSheet, View } from "react-native";
import { router, usePathname } from "expo-router";
import Reanimated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Boxy } from "./boxy";
import { CLOUD_BINDING_ID } from "./config";
import {
  nativeOverlayView,
  isLive,
  type ConnectionOverlayMode,
  type NativeOverlayView,
  type SocketStatus,
} from "./connection-overlay-state";
import { useOmg } from "./provider";
import { Text } from "./text";
import { useTheme } from "./theme";

/** Hidden at least this long counts as leaving and coming back. */
const RESUME_AWAY_MS = 5_000;
/** How long "Resuming…" stands in for "Reconnecting…" after a return. */
const RESUME_WINDOW_MS = 15_000;
/** How long the happy "Connected" moment stays. */
const BACK_MS = 1_200;
/** Screens that own their own machine UI. The overlay stays out of their way. */
const SUPPRESSED = [/^\/computers/, /^\/settings/, /^\/sign-in/, /^\/onboarding/, /^\/plan/];

function useTick(nextChangeMs: number | null) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (nextChangeMs === null) return;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.max(16, nextChangeMs));
    return () => clearTimeout(timer);
  }, [nextChangeMs]);
}

function useResuming(): boolean {
  const [until, setUntil] = useState(0);
  const leftAt = useRef<number | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        leftAt.current = Date.now();
        return;
      }
      if (state !== "active" || leftAt.current === null) return;
      const away = Date.now() - leftAt.current;
      leftAt.current = null;
      if (away >= RESUME_AWAY_MS) setUntil(Date.now() + RESUME_WINDOW_MS);
    });
    return () => sub.remove();
  }, []);
  const remaining = until - Date.now();
  useTick(remaining > 0 ? remaining : null);
  return remaining > 0;
}

/**
 * The one connection surface for the whole native app, mounted once above
 * the navigator. It reads OmgProvider's readiness and the live socket status
 * and keeps no copy of either.
 *
 * - A short blip shows nothing; a longer one a pill under the header.
 * - A long or hard failure dims the app (still visible behind) and shows a
 *   card with Boxy, Try again, and Choose another computer.
 * - When the connection returns, Boxy smiles "Connected" and fades.
 */
export function ConnectionOverlay() {
  const { authStatus, readiness, client, bindingId, cloud, probe } = useOmg();
  const pathname = usePathname();
  const resuming = useResuming();

  const [socket, setSocket] = useState<SocketStatus | null>(null);
  useEffect(() => {
    setSocket(null);
    if (!client) return;
    return client.live.subscribeConnection((state) => setSocket(state.status));
  }, [client]);

  // Before the selected computer is ready once in this run, this is the first
  // connect, and the card says "Connecting…" sooner than a reconnect would.
  const [readyBinding, setReadyBinding] = useState<string | null>(null);
  useEffect(() => {
    if (readiness?.status === "ready" && bindingId) setReadyBinding(bindingId);
  }, [readiness?.status, bindingId]);
  const selected = authStatus === "signed-in" && !!bindingId;
  const everReady = selected && readyBinding === bindingId;

  const input = {
    readiness: readiness?.status ?? null,
    socket,
    cloudPaused: bindingId === CLOUD_BINDING_ID && cloud?.status === "paused",
  };
  const live = isLive(input);
  const [notLiveSince, setNotLiveSince] = useState<number | null>(null);
  useEffect(() => {
    setNotLiveSince((since) => (live ? null : since ?? Date.now()));
  }, [live]);

  const view = nativeOverlayView({
    ...input,
    selected,
    everReady,
    notLiveMs: notLiveSince === null ? 0 : Date.now() - notLiveSince,
    resuming,
    suppressed: SUPPRESSED.some((re) => re.test(pathname)),
  });
  useTick(view.nextChangeMs);

  const lastShown = useRef<ConnectionOverlayMode>("hidden");
  const [back, setBack] = useState<ConnectionOverlayMode>("hidden");
  useEffect(() => {
    if (view.mode !== "hidden") {
      lastShown.current = view.mode;
      setBack("hidden");
      return;
    }
    // Not live but still under the pill threshold: wait. A short flap (the
    // first connect reloads its bootstrap at once) must not cut "Connected"
    // short; its own timer closes it, and a real drop brings the pill.
    if (!live) return;
    if (lastShown.current === "hidden") return;
    setBack(lastShown.current);
    lastShown.current = "hidden";
  }, [view.mode, live]);
  // The close timer belongs to the "Connected" moment alone. When it shared
  // the effect above, a brief flap right after recovery (the runtime reloads
  // its bootstrap) cancelled it and nothing restarted it, so "Connected"
  // stayed on screen for good.
  useEffect(() => {
    if (back === "hidden") return;
    const timer = setTimeout(() => setBack("hidden"), BACK_MS);
    return () => clearTimeout(timer);
  }, [back]);

  const retry = () => {
    client?.live.reconnectNow();
    void probe();
  };
  const chooseAnother = () => router.push("/computers");

  if (view.mode !== "hidden") {
    return <ConnectionSurface view={view} onRetry={retry} onChooseAnother={chooseAnother} />;
  }
  if (back !== "hidden") {
    return (
      <ConnectionSurface
        view={{ mode: back, mood: "happy", title: "Connected", detail: null, canSwitch: false, nextChangeMs: null }}
      />
    );
  }
  return null;
}

/** Presentational. Exported for the e2e harness. */
export function ConnectionSurface({
  view,
  onRetry,
  onChooseAnother,
}: {
  view: NativeOverlayView;
  onRetry?: () => void;
  onChooseAnother?: () => void;
}) {
  const { colors, isDark, type } = useTheme();
  const insets = useSafeAreaInsets();
  const ink = colors.foreground;
  const happy = view.mood === "happy";
  // A plain opacity fade. A Reanimated `entering` layout animation around
  // Boxy's Skia canvas left the ink half drawn until the next re-render.
  const shown = useSharedValue(0);
  useEffect(() => {
    shown.value = withTiming(1, { duration: 220 });
  }, [shown]);
  const fade = useAnimatedStyle(() => ({ opacity: shown.value }));

  if (view.mode === "pill") {
    return (
      <Reanimated.View
        pointerEvents="box-none"
        style={[styles.pillLayer, { top: insets.top + 56 }, fade]}
      >
        <View
          testID="connection-pill"
          accessibilityRole="alert"
          style={[styles.pill, { backgroundColor: colors.popover, borderColor: colors.border }]}
        >
          <Boxy mood={view.mood} size={28} color={ink} />
          <Text style={[type.subhead, { color: colors.foreground }]}>{view.title}</Text>
          {onRetry && !happy ? (
            <Pressable accessibilityRole="button" onPress={onRetry} hitSlop={8} style={styles.pillAction}>
              <Text style={[type.subhead, { color: colors.mutedForeground }]}>Retry</Text>
            </Pressable>
          ) : null}
        </View>
      </Reanimated.View>
    );
  }

  return (
    <Reanimated.View
      testID="connection-overlay"
      style={[
        StyleSheet.absoluteFill,
        styles.scrim,
        { backgroundColor: isDark ? "rgba(20,20,20,0.3)" : "rgba(242,242,247,0.3)" },
        fade,
      ]}
    >
      <View
        accessibilityRole="alert"
        accessibilityLabel={view.title}
        style={[styles.card, { backgroundColor: colors.background, borderColor: colors.border }]}
      >
        <Boxy mood={view.mood} size={80} color={ink} testID={`boxy-${view.mood}`} />
        <Text style={[type.headline, styles.center, { color: colors.foreground }]}>{view.title}</Text>
        {view.detail ? (
          <Text style={[type.footnote, styles.center, { color: colors.mutedForeground }]}>{view.detail}</Text>
        ) : null}
        {onRetry && !happy ? (
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={({ pressed }) => [styles.primary, { backgroundColor: colors.foreground, opacity: pressed ? 0.8 : 1 }]}
          >
            <Text style={[type.callout, { color: colors.background, fontWeight: "600" }]}>Try again</Text>
          </Pressable>
        ) : null}
        {onChooseAnother && view.canSwitch ? (
          <Pressable
            accessibilityRole="button"
            onPress={onChooseAnother}
            style={({ pressed }) => [
              styles.secondary,
              { borderColor: colors.borderStrong, backgroundColor: pressed ? colors.cardPressed : "transparent" },
            ]}
          >
            <Text style={[type.callout, { color: colors.foreground }]}>Choose another computer</Text>
          </Pressable>
        ) : null}
      </View>
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  pillLayer: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingLeft: 6,
    paddingRight: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  pillAction: { paddingHorizontal: 4, paddingVertical: 2 },
  scrim: { alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  card: {
    width: "100%",
    maxWidth: 280,
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOpacity: 0.25,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  center: { textAlign: "center" },
  primary: { alignSelf: "stretch", height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", marginTop: 4 },
  secondary: {
    alignSelf: "stretch",
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
});
