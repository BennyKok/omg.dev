// Extends app.json. The only thing that lives here is config that depends on
// the build environment: the Google Sign-In plugin refuses to run without the
// reversed iOS client id (`com.googleusercontent.apps.<id>`), so it is added
// only when EAS provides one. A build without it still succeeds and simply has
// no Google button (see GOOGLE_IOS_CLIENT_ID in src/omg/config.ts).
module.exports = ({ config }) => {
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  if (!iosClientId) return config;
  const iosUrlScheme = `com.googleusercontent.apps.${iosClientId.replace(/\.apps\.googleusercontent\.com$/, "")}`;
  return {
    ...config,
    plugins: [...(config.plugins ?? []), ["@react-native-google-signin/google-signin", { iosUrlScheme }]],
  };
};
