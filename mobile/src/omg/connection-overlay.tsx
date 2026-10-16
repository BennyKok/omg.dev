import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import { router, usePathname } from "expo-router";
import { CLOUD_BINDING_ID } from "./config";
import {
  nativeOverlayView,
  isLive,
  type NativeOverlayView,
  type SocketStatus,
} from "./connection-overlay-state";
import { LaunchScreen } from "./launch";
import { useOmg } from "./provider";
import { sessionCache } from "./session-cache-store";
import { Text } from "./text";
import { useTheme } from "./theme";

/** Screens that own their own machine UI. The connection page stays out of their way. */
const SUPPRESSED = [/^\/computers/, /^\/settings/, /^\/sign-in/, /^\/onboarding/, /^\/plan/];

function useTick(nextChangeMs: number | null) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (nextChangeMs === null) return;
    const timer = setTimeout(() => setTick((n) => n + 1), Math.max(16, nextChangeMs));
    return () => clearTimeout(timer);
  }, [nextChangeMs]);
}

/**
 * The connection rules, read from OmgProvider and the live socket. LaunchGate
 * (first connect) and ConnectionOverlay (every wait after it) both call this,
 * so the two can never say different things about the same wait.
 */
export function useNativeConnectionView({ suppressible }: { suppressible: boolean }) {
  const { authStatus, readiness, client, bindingId, cloud, probe } = useOmg();
  const pathname = usePathname();

  const [socket, setSocket] = useState<SocketStatus | null>(null);
  useEffect(() => {
    setSocket(null);
    if (!client) return;
    return client.live.subscribeConnection((state) => setSocket(state.status));
  }, [client]);

  const [readyBinding, setReadyBinding] = useState<string | null>(null);
  useEffect(() => {
    if (readiness?.status === "ready" && bindingId) setReadyBinding(bindingId);
  }, [readiness?.status, bindingId]);
  const selected = authStatus === "signed-in" && !!bindingId;
  const everReady = selected && readyBinding === bindingId;
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
  const [notLiveSince, setNotLiveSince] = useState<number | null>(() => (live ? null : Date.now()));
  useEffect(() => {
    setNotLiveSince((since) => (live ? null : since ?? Date.now()));
  }, [live]);
  // A retry starts a fresh wait: its limits count from the tap.
  const retry = () => {
    setNotLiveSince(Date.now());
    client?.live.reconnectNow();
    void probe();
  };

  const view = nativeOverlayView({
    ...input,
    selected,
    notLiveMs: live || notLiveSince === null ? 0 : Date.now() - notLiveSince,
    suppressed: suppressible && SUPPRESSED.some((re) => re.test(pathname)),
  });
  useTick(view.nextChangeMs);
  return { view, live, retry, chooseAnother: () => router.push("/computers") };
}

/** Try again and Choose another computer, when the rules offer them. */
export function ConnectionActions({
  view,
  onRetry,
  onChooseAnother,
}: {
  view: NativeOverlayView;
  onRetry?: () => void;
  onChooseAnother?: () => void;
}) {
  const { colors, type } = useTheme();
  const retry = onRetry && view.canRetry;
  const choose = onChooseAnother && view.canSwitch;
  if (!retry && !choose) return null;
  return (
    <>
      {retry ? (
        <Pressable accessibilityRole="button" onPress={onRetry}
          style={({ pressed }) => [styles.primary, { backgroundColor: colors.foreground, opacity: pressed ? 0.8 : 1 }]}>
          <Text style={[type.callout, { color: colors.background, fontWeight: "600" }]}>Try again</Text>
        </Pressable>
      ) : null}
      {choose ? (
        <Pressable accessibilityRole="button" onPress={onChooseAnother}
          style={({ pressed }) => [styles.secondary, { borderColor: colors.borderStrong, backgroundColor: pressed ? colors.cardPressed : "transparent" }]}>
          <Text style={[type.callout, { color: colors.foreground }]}>Choose another computer</Text>
        </Pressable>
      ) : null}
    </>
  );
}

/** Presentational: the full connection page. Exported for the e2e harness. */
export function ConnectionPage({
  view,
  done,
  onFinished,
  onRetry,
  onChooseAnother,
}: {
  view: NativeOverlayView;
  done?: boolean;
  onFinished?: () => void;
  onRetry?: () => void;
  onChooseAnother?: () => void;
}) {
  return (
    <LaunchScreen
      testID="connection-page"
      label={view.title}
      detail={view.detail}
      mood={view.mood}
      done={done}
      onFinished={onFinished}
      actions={done ? null : <ConnectionActions view={view} onRetry={onRetry} onChooseAnother={onChooseAnother} />}
    />
  );
}

/**
 * Every wait after the first connect (LaunchGate owns that one). One full
 * page, the launch screen's own look, mounted once above the navigator. When
 * the computer answers, it plays the launch screen's exit, so the app reads
 * as opening again rather than as an error closing.
 */
export function ConnectionOverlay({ enabled = true }: { enabled?: boolean }) {
  const { view, retry, chooseAnother } = useNativeConnectionView({ suppressible: true });
  const shown = enabled && view.mode === "page";
  // Keep the last page on screen while it plays its exit. Decided in render:
  // waiting for an effect left one frame with nothing mounted, and the page
  // vanished and came back before it left.
  const last = useRef<NativeOverlayView | null>(null);
  const [, setClosed] = useState(0);
  if (shown) last.current = view;

  if (shown) {
    // Keyed apart from the closing page: LaunchScreen plays its exit once per
    // mount, so a wait that returns mid-exit needs a fresh page.
    return <ConnectionPage key="open" view={view} onRetry={retry} onChooseAnother={chooseAnother} />;
  }
  if (last.current) {
    return (
      <ConnectionPage
        key="closing"
        view={last.current}
        done
        onFinished={() => {
          last.current = null;
          setClosed((n) => n + 1);
        }}
      />
    );
  }
  return null;
}

const styles = StyleSheet.create({
  primary: { alignSelf: "stretch", height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  secondary: {
    alignSelf: "stretch",
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
});
