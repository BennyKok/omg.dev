// The native app consumes @omg-dev/* from npm, so a grammar the box and the
// composer must agree on byte-for-byte cannot wait for a package release.
// `packages/protocol/src` is the one owner of those shared, import-free
// modules; watching it lets `mobile/src` import them by path. EAS archives
// the git root, so the path survives a cloud build.
const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [
  ...(config.watchFolders ?? []),
  path.resolve(__dirname, "../packages/protocol/src"),
];

module.exports = config;
