import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Platform, UIManager, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { IconButton, PrimaryButton } from "../../src/components";
import { artifactHtmlDocument, artifactPath } from "../../src/omg/artifact-html";
import { useOmg } from "../../src/omg/provider";
import { Text } from "../../src/omg/text";
import { useTheme } from "../../src/omg/theme";

// Probe before importing: an OTA must not crash a binary without this view.
const WebView: typeof import("react-native-webview").WebView | null =
  Platform.OS !== "web" && UIManager.hasViewManagerConfig("RNCWebView")
    ? require("react-native-webview").WebView : null;

export default function ArtifactHtmlScreen() {
  const { url, title, version } = useLocalSearchParams<{ url?: string; title?: string; version?: string }>();
  const { client } = useOmg();
  const { colors, type, space, isDark } = useTheme();
  const [revision, setRevision] = useState(0);
  const [load, setLoad] = useState<{ html?: string; error?: boolean }>({});
  const reload = useCallback(() => setRevision(n => n + 1), []);
  useEffect(() => {
    let active = true;
    setLoad({});
    const path = artifactPath(url);
    if (!client || !path) { setLoad({ error: true }); return; }
    void client.transport.fetch(path, { headers: { "Cache-Control": "no-cache" } })
      .then(async response => {
        if (!response.ok) throw new Error(`artifact ${response.status}`);
        const html = await response.text();
        if (active) setLoad({ html });
      }).catch(() => { if (active) setLoad({ error: true }); });
    return () => { active = false; };
  }, [client, url, version, revision]);
  const source = useMemo(() => load.html === undefined ? null : ({ html: artifactHtmlDocument(load.html, isDark ? "dark" : "light") }), [load.html, isDark]);
  return <View testID="artifact-html-screen" style={{ flex: 1, backgroundColor: colors.bg }}>
    <Stack.Screen options={{ title: title || "Artifact", headerRight: () => <IconButton ios="arrow.clockwise" android="refresh" accessibilityLabel="Reload artifact" onPress={reload} /> }} />
    {!WebView ? <Text style={{ ...type.callout, color: colors.text, padding: space.lg }}>Update the iOS app to view interactive artifacts.</Text>
      : load.error ? <View style={{ padding: space.lg, gap: space.md }}><Text style={{ ...type.callout, color: colors.text }}>The artifact could not load.</Text><PrimaryButton label="Try again" onPress={reload} /></View>
      : !source ? <ActivityIndicator accessibilityLabel="Loading artifact" style={{ margin: space.xl }} />
      : <WebView key={revision} source={source} style={{ flex: 1, backgroundColor: colors.bg }}
          originWhitelist={["*"]} incognito sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false}
          allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false}
          javaScriptCanOpenWindowsAutomatically={false} setSupportMultipleWindows
          onShouldStartLoadWithRequest={request => request.url === "about:blank" || request.url === "about:srcdoc" || request.url.startsWith("about:srcdoc#")}
          onOpenWindow={() => {}} onError={() => setLoad({ error: true })} />}
  </View>;
}
