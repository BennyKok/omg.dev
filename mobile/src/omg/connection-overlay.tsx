import { useCallback, useEffect, useRef, useState, type ComponentRef } from "react";
import { AppState, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { router, usePathname } from "expo-router";
import Reanimated, { useAnimatedStyle, useSharedValue, useReducedMotion, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Boxy } from "./boxy";
import { CLOUD_BINDING_ID } from "./config";
import {
  nativeOverlayView,
  isLive,
  PILL_AFTER_MS,
  type ConnectionOverlayMode,
  type NativeOverlayView,
  type SocketStatus,
} from "./connection-overlay-state";
import { useOmg } from "./provider";
import { sessionCache } from "./session-cache-store";
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
 * - A short blip shows nothing; a longer wait a pill under the header, for
 *   as long as it lasts. The saved sessions behind it stay usable.
 * - A real failure, or a first connect with nothing saved to show, dims the
 *   app (still visible behind) and shows a card with Boxy, Try again, and
 *   Choose another computer.
 * - When the connection returns, Boxy smiles "Connected" in the same place
 *   and fades. The surface is never unmounted in between.
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
  // The same test LaunchGate uses to lift the launch screen at once.
  const cachedRoster = bindingId ? sessionCache.read<unknown[]>(`roster:${bindingId}`) : null;
  const hasSaved = Array.isArray(cachedRoster) && cachedRoster.length > 0;

  const input = {
    everReady,
    hasSaved,
    readiness: readiness?.status ?? null,
    socket,
    cloudPaused: bindingId === CLOUD_BINDING_ID && cloud?.status === "paused",
  };
  const live = isLive(input);
  const [notLiveSince, setNotLiveSince] = useState<number | null>(null);
  useEffect(() => {
    setNotLiveSince((since) => (live ? null : since ?? Date.now()));
  }, [live]);

  // Once a surface is visible, a change of wait state must not remove it
  // during the next state's quiet threshold. Move straight into its pill.
  const lastShown = useRef<ConnectionOverlayMode>("hidden");
  const view = nativeOverlayView({
    ...input,
    selected,
    everReady,
    hasSaved,
    notLiveMs: Math.max(lastShown.current === "hidden" ? 0 : PILL_AFTER_MS, notLiveSince === null ? 0 : Date.now() - notLiveSince),
    resuming,
    suppressed: SUPPRESSED.some((re) => re.test(pathname)),
  });
  useTick(view.nextChangeMs);

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

  // Recovery answers in the same render that hides the wait. Waiting for the
  // effect above left one frame with nothing mounted, so "Connected" faded in
  // as a new surface: the card vanished and came back.
  const recovered = view.mode === "hidden" && live && lastShown.current !== "hidden" ? lastShown.current : "hidden";
  const closing = back !== "hidden" ? back : recovered;

  const retry = () => {
    client?.live.reconnectNow();
    void probe();
  };
  const chooseAnother = () => router.push("/computers");

  if (view.mode !== "hidden") {
    return <ConnectionSurface view={view} onRetry={retry} onChooseAnother={chooseAnother} />;
  }
  if (closing !== "hidden") {
    return (
      <ConnectionSurface
        view={{ mode: closing, mood: "happy", title: "Connected", detail: null, canSwitch: false, canRetry: false, nextChangeMs: null }}
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
  const { height } = useWindowDimensions();
  const ink = colors.foreground;
  // A plain opacity fade. A Reanimated `entering` layout animation around
  // Boxy's Skia canvas left the ink half drawn until the next re-render.
  const shown = useSharedValue(0);
  useEffect(() => {
    shown.value = withTiming(1, { duration: 220 });
  }, [shown]);
  const fade = useAnimatedStyle(() => ({ opacity: shown.value }));

  const pill = view.mode === "pill";
  const layer = useRef<ComponentRef<typeof View>>(null);
  const slot = useRef<ComponentRef<typeof View>>(null);
  const placed = useRef(false);
  const measurement = useRef(0);
  const reducedMotion = useReducedMotion();
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const scale = useSharedValue(1);
  const visible = useSharedValue(0);
  const place = useCallback(() => {
    const version = ++measurement.current;
    layer.current?.measureInWindow((left, top) => {
      slot.current?.measureInWindow((slotLeft, slotTop, width, slotHeight) => {
        if (version !== measurement.current || width === 0) return;
        const duration = placed.current && !reducedMotion ? 300 : 0;
        x.value = withTiming(slotLeft - left + width / 2 - 40, { duration });
        y.value = withTiming(slotTop - top + slotHeight / 2 - 40, { duration });
        scale.value = withTiming(pill ? 0.35 : 1, { duration });
        visible.value = 1;
        placed.current = true;
      });
    });
  }, [pill, reducedMotion, x, y, scale, visible]);
  useEffect(() => {
    const frame = requestAnimationFrame(place);
    return () => { cancelAnimationFrame(frame); measurement.current++; };
  }, [place, height, view.title, view.canRetry, view.canSwitch]);
  const mascotStyle = useAnimatedStyle(() => ({
    opacity: visible.value,
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  return (
    <Reanimated.View ref={layer} collapsable={false} pointerEvents="box-none" onLayout={place} style={[StyleSheet.absoluteFill, fade]}>
      <View
        testID={pill ? "connection-pill" : "connection-overlay"}
        pointerEvents={view.mood === "happy" ? "none" : pill ? "box-none" : "auto"}
        style={pill
          ? [styles.pillLayer, { top: insets.top + 44 }]
          : [StyleSheet.absoluteFill, styles.scrim,
            { paddingTop: Math.max(insets.top, height / 2 - BOXY_CENTER_FROM_CARD_TOP),
              backgroundColor: isDark ? "rgba(20,20,20,0.3)" : "rgba(242,242,247,0.3)" }]}
      >
        <View accessibilityRole="alert" accessibilityLabel={view.title} onLayout={place}
          style={pill
            ? [styles.pill, { backgroundColor: colors.popover, borderColor: colors.border }]
            : [styles.card, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View ref={slot} collapsable={false} onLayout={place} style={{ width: pill ? 28 : 80, height: pill ? 28 : 80 }} />
          <Text style={[pill ? type.subhead : type.headline, !pill && styles.center, { color: colors.foreground }]}>{view.title}</Text>
          {!pill && view.detail ? <Text style={[type.footnote, styles.center, { color: colors.mutedForeground }]}>{view.detail}</Text> : null}
          {onRetry && view.canRetry ? (
            <Pressable accessibilityRole="button" onPress={onRetry} hitSlop={pill ? 8 : undefined}
              style={pill ? styles.pillAction : ({ pressed }) => [styles.primary, { backgroundColor: colors.foreground, opacity: pressed ? 0.8 : 1 }]}>
              <Text style={pill ? [type.subhead, { color: colors.mutedForeground }] : [type.callout, { color: colors.background, fontWeight: "600" }]}>{pill ? "Retry" : "Try again"}</Text>
            </Pressable>
          ) : null}
          {onChooseAnother && view.canSwitch ? (
            <Pressable accessibilityRole="button" onPress={onChooseAnother} hitSlop={pill ? 8 : undefined}
              style={pill ? styles.pillAction : ({ pressed }) => [styles.secondary, { borderColor: colors.borderStrong, backgroundColor: pressed ? colors.cardPressed : "transparent" }]}>
              <Text style={pill ? [type.subhead, { color: colors.mutedForeground }] : [type.callout, { color: colors.foreground }]}>{pill ? "Switch" : "Choose another computer"}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
      <Reanimated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0, width: 80, height: 80 }, mascotStyle]}>
        <Boxy mood={view.mood} size={CARD_BOXY_SIZE} color={ink} testID={`boxy-${view.mood}`} />
      </Reanimated.View>
    </Reanimated.View>
  );
}

const CARD_PADDING_TOP = 16;
const CARD_BOXY_SIZE = 80;
const BOXY_CENTER_FROM_CARD_TOP = CARD_PADDING_TOP + CARD_BOXY_SIZE / 2;

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
  scrim: { alignItems: "center", justifyContent: "flex-start", paddingHorizontal: 24 },
  card: {
    width: "100%",
    maxWidth: 280,
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: CARD_PADDING_TOP,
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
