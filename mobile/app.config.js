// Extends app.json. The only thing that lives here is config that depends on
// the build environment: the Google Sign-In plugin refuses to run without the
// reversed iOS client id (`com.googleusercontent.apps.<id>`), so it is added
// only when EAS provides one. A build without it still succeeds and simply has
// no Google button (see GOOGLE_IOS_CLIENT_ID in src/omg/config.ts).
//
// Meta app events follow the same rule: the plugin and `extra.meta` appear only
// when EAS provides META_APP_ID and META_CLIENT_TOKEN. src/omg/meta-events.ts
// reads `extra.meta.enabled` and is a no-op everywhere else. iOS only: see
// plugins/with-meta-ios.js and react-native.config.js.
const TRACKING_PURPOSE =
  "omg.dev asks to share an advertising identifier with Meta only to measure which of our ads brought you to the app. For example, it tells us that you installed omg.dev after you saw our ad on Instagram. We do not sell this data, and you can still use every feature if you choose Ask App Not to Track.";

function metaPlugin() {
  const appID = process.env.META_APP_ID;
  const clientToken = process.env.META_CLIENT_TOKEN;
  if (!appID || !clientToken) return null;
  return ["./plugins/with-meta-ios.js", {
    appID,
    clientToken,
    displayName: "omg",
    scheme: `fb${appID}`,
    isAutoInitEnabled: true,
    autoLogAppEventsEnabled: true,
    advertiserIDCollectionEnabled: true,
    iosUserTrackingPermission: TRACKING_PURPOSE,
  }];
}

module.exports = ({ config }) => {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const meta = metaPlugin();
  if (meta) config = { ...config, extra: { ...config.extra, meta: { enabled: true } } };
  const plugins = [
    ...(config.plugins ?? []),
    ...(meta ? [meta] : []),
    "./plugins/with-activity-icons.js",
    "./plugins/with-agent-notifications.js",
    "./plugins/with-share-extension.js",
    ["expo-widgets", {
      enablePushNotifications: true,
      widgets: [{
        name: "OmgAgentVillage",
        displayName: "omg.dev",
        description: "See your agents working and waiting for you.",
        ios: {
          supportedFamilies: ["systemSmall", "systemMedium", "systemLarge"],
          contentMarginsDisabled: true,
        },
      }],
    }],
  ];
  if (!iosClientId) return { ...config, plugins };
  const iosUrlScheme = `com.googleusercontent.apps.${iosClientId.replace(/\.apps\.googleusercontent\.com$/, "")}`;
  return {
    ...config,
    plugins: [...plugins, ["@react-native-google-signin/google-signin", { iosUrlScheme }]],
  };
};
