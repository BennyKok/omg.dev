// The Meta SDK is iOS only in this app (src/omg/meta-events.ts,
// plugins/with-meta-ios.js). Not linking it on Android keeps Meta code, its
// auto-init provider and its permissions out of the Play build.
module.exports = {
  dependencies: {
    "react-native-fbsdk-next": { platforms: { android: null } },
  },
};
