import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import ComputerControlDom from "../src/omg/computer-control-dom";
import { isDemoMode } from "../src/omg/demo";
import { Text } from "../src/omg/text";
import { useOmg } from "../src/omg/provider";
import {
  getComputerSocketAccess,
  getHostedTransport,
  type ComputerSocketAccess,
} from "../src/omg/transport";
import { useTheme } from "../src/omg/theme";

type ComputerStatus = {
  running: boolean;
  deps?: { ok?: boolean; hint?: string };
};

export default function ComputerScreen() {
  const { bindingId, client } = useOmg();
  const { colors, type } = useTheme();
  const [access, setAccess] = useState<ComputerSocketAccess | null>(null);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback(async () => {
    setAccess(null);
    setPreview(false);
    setError(null);
    if (!bindingId || !client) {
      setError("Select a Computer first.");
      return;
    }
    if (isDemoMode()) {
      setPreview(true);
      setAccess({ url: "", protocol: "" });
      return;
    }
    try {
      const transport = getHostedTransport(bindingId);
      const status = await transport.request<ComputerStatus>("/api/computer/status");
      if (status.deps?.ok === false) throw new Error(status.deps.hint || "Remote control is not available on this Computer.");
      if (!status.running) {
        await transport.request<ComputerStatus>("/api/computer/start", { method: "POST" });
      }
      // The RFB connection is the final authority. Some hosted paths lag on
      // the status read even after start returned successfully. Enter the
      // viewer and let its authenticated socket report Connecting or Lost,
      // instead of replacing a usable screen with a false start error.
      setAccess(await getComputerSocketAccess(bindingId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't open your Computer.");
    }
  }, [bindingId, client]);

  useEffect(() => { void open(); }, [open]);

  if (access) {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg }]} testID="computer-control-screen">
        <ComputerControlDom
          socketUrl={access.url}
          protocol={access.protocol}
          preview={preview}
          dom={{ scrollEnabled: false, style: styles.viewer }}
        />
      </View>
    );
  }

  return (
    <View style={[styles.center, { backgroundColor: colors.bg }]} testID="computer-control-loading">
      {error ? (
        <>
          <Text style={[type.body, { color: colors.text, textAlign: "center" }]}>{error}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try again"
            onPress={() => void open()}
            style={[styles.retry, { backgroundColor: colors.primary }]}
          >
            <Text style={[type.callout, { color: "white", fontWeight: "700" }]}>Try again</Text>
          </Pressable>
        </>
      ) : (
        <>
          <ActivityIndicator color={colors.primary} />
          <Text style={[type.callout, { color: colors.textMuted }]}>Opening your Computer…</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  viewer: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 28 },
  retry: { minHeight: 44, paddingHorizontal: 20, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});
