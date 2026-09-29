import { useEffect, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import type { OmgTransport } from "@omg-dev/client";
import { COMPUTER_KIOSK_PATH, kioskHost, type KioskFrame } from "../../../packages/protocol/src/computer-kiosk";
import type { ExpoConnectMode } from "../../../packages/protocol/src/expo-account";
import { Icon } from "../components";
import ExpoSigninSheetDom from "./expo-signin-sheet-dom";
import { useTheme } from "./theme";
import { Text } from "./text";

export const EXPO_SHEET_TITLE: Record<ExpoConnectMode, string> = {
  signup: "Sign up for Expo",
  login: "Sign in to Expo",
};

/** The Computer screen socket, from `getComputerSocketAccess`. */
export type ComputerSocket = () => Promise<{ url: string; protocol: string }>;

/**
 * The Expo sign-in sheet on iOS and Android: a native page sheet whose body
 * is Expo's real page from the Computer kiosk window (see
 * expo-signin-sheet-dom.tsx). The header names the site so a person can see
 * it is expo.dev. The X cancels the connect. "Open the full Computer view"
 * stays as a fallback.
 */
export function ExpoSigninSheet({ mode, transport, socket, onClose, onOpenComputer }: {
  mode: ExpoConnectMode;
  transport: Pick<OmgTransport, "request">;
  /** Absent in the simulator E2E harness, which has no Computer. */
  socket?: ComputerSocket;
  onClose(): void;
  onOpenComputer(): void;
}) {
  const { colors } = useTheme();
  const [frame, setFrame] = useState<KioskFrame | null>(null);
  const [access, setAccess] = useState<{ url: string; protocol: string } | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const next = await transport.request<KioskFrame>(COMPUTER_KIOSK_PATH);
        if (alive) setFrame((old) => JSON.stringify(old) === JSON.stringify(next) ? old : next);
      } catch { /* The next poll retries. */ }
    };
    void poll();
    const timer = setInterval(() => void poll(), 700);
    return () => { alive = false; clearInterval(timer); };
  }, [transport]);

  useEffect(() => {
    if (!socket) return;
    let alive = true;
    void socket().then((next) => { if (alive) setAccess(next); }).catch(() => {});
    return () => { alive = false; };
  }, [socket]);

  return <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <View testID="expo-signin-sheet" style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, borderBottomWidth: 1, borderColor: colors.border }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text testID="expo-signin-sheet-title" style={{ color: colors.foreground, fontSize: 17, fontWeight: "600" }}>{EXPO_SHEET_TITLE[mode]}</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
            <Icon ios="lock.fill" android="lock" size={11} color={colors.mutedForeground} />
            <Text testID="expo-signin-sheet-host" style={{ color: colors.mutedForeground, fontSize: 12 }}>{kioskHost(frame)}</Text>
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel and close" testID="expo-signin-sheet-close" onPress={onClose}
          style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }}>
          <Icon ios="xmark" android="close" size={15} color={colors.foreground} />
        </Pressable>
      </View>
      <View style={{ flex: 1, backgroundColor: "#ffffff" }}>
        {access
          ? <ExpoSigninSheetDom socketUrl={access.url} protocol={access.protocol} frame={frame}
              dom={{ scrollEnabled: false, hideKeyboardAccessoryView: true, style: { flex: 1 } }} />
          : <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 15 }}>Opening {kioskHost(frame)}…</Text>
            </View>}
      </View>
      <Pressable accessibilityRole="link" testID="expo-signin-sheet-full-computer" onPress={onOpenComputer}
        style={{ minHeight: 40, alignItems: "center", justifyContent: "center", borderTopWidth: 1, borderColor: colors.border, paddingBottom: 6 }}>
        <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>Open the full Computer view</Text>
      </Pressable>
    </View>
  </Modal>;
}
