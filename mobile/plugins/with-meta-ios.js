// Meta (Facebook) SDK, iOS only.
//
// react-native-fbsdk-next's own plugin also writes the Android manifest:
// AutoInitEnabled, the App ID, and AD_ID-style permissions. The Android app
// does not measure anything for Meta (src/omg/meta-events.ts is iOS only), and
// the native module is not autolinked there (react-native.config.js). Running
// its Android mods would still put Meta keys in the Play build and change what
// the Play Data safety form has to declare. So this applies the iOS half of
// that plugin and nothing else.
//
// Same iOS mods, same order as the upstream plugin (withFacebook.js).
const { createRunOncePlugin } = require("@expo/config-plugins");
const { getMergePropsWithConfig } = require("react-native-fbsdk-next/plugin/build/config");
const {
  withFacebookIOS,
  withUserTrackingPermission,
} = require("react-native-fbsdk-next/plugin/build/withFacebookIOS");
const { withSKAdNetworkIdentifiers } = require("react-native-fbsdk-next/plugin/build/withSKAdNetworkIdentifiers");

// https://developers.facebook.com/docs/SKAdNetwork
const META_SKADNETWORK_IDS = ["v9wttpbfk9.skadnetwork", "n38lu8286q.skadnetwork"];

function withMetaIOS(config, props) {
  const merged = getMergePropsWithConfig({ plugins: { facebook: {} } }, props);
  for (const key of ["appID", "clientToken", "displayName", "scheme", "iosUserTrackingPermission"]) {
    if (!merged[key]) throw new Error(`with-meta-ios: missing ${key}`);
  }
  config = withFacebookIOS(config, merged);
  config = withUserTrackingPermission(config, merged);
  config = withSKAdNetworkIdentifiers(config, META_SKADNETWORK_IDS);
  return config;
}

module.exports = createRunOncePlugin(withMetaIOS, "with-meta-ios", "1.0.0");
