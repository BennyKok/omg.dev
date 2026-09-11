/**
 * Puts react-native-key-command on the app delegate, the way its README asks.
 *
 * UIKit collects `keyCommands` up the responder chain and ends at the app
 * delegate. The UIApplication category in modules/omg-key-commands was meant
 * to answer for the whole app, but on the SDK 57 simulator build nothing
 * registered through it ever fired, so this does what the library documents:
 * the delegate returns the library's commands and forwards the action.
 *
 * Expo's generated AppDelegate is Swift, and the library is Objective-C with
 * no module map, so the header goes through the target's bridging header.
 */
const { withAppDelegate, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARK = "// omg: hardware keyboard shortcuts (react-native-key-command)";

const SWIFT_METHODS = `
  ${MARK}
  public override var keyCommands: [UIKeyCommand]? {
    return HardwareShortcuts.sharedInstance().keyCommands() as? [UIKeyCommand]
  }

  @objc func handleKeyCommand(_ keyCommand: UIKeyCommand) {
    HardwareShortcuts.sharedInstance().handleKeyCommand(keyCommand)
  }
`;

const HEADER_IMPORT = "#import <react-native-key-command/HardwareShortcuts.h>";

function withKeyCommandsAppDelegate(config) {
  return withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== "swift") {
      throw new Error("with-key-commands expects a Swift AppDelegate (Expo SDK 53+).");
    }
    const src = mod.modResults.contents;
    if (src.includes(MARK)) return mod;
    const anchor = /class AppDelegate: ExpoAppDelegate \{\n/;
    if (!anchor.test(src)) {
      throw new Error("with-key-commands: could not find `class AppDelegate: ExpoAppDelegate {` in AppDelegate.swift");
    }
    mod.modResults.contents = src.replace(anchor, (m) => m + SWIFT_METHODS);
    return mod;
  });
}

function withKeyCommandsBridgingHeader(config) {
  return withDangerousMod(config, [
    "ios",
    (mod) => {
      const iosRoot = mod.modRequest.platformProjectRoot;
      const name = mod.modRequest.projectName;
      const candidates = [
        path.join(iosRoot, name, `${name}-Bridging-Header.h`),
        ...fs
          .readdirSync(path.join(iosRoot, name))
          .filter((f) => f.endsWith("-Bridging-Header.h"))
          .map((f) => path.join(iosRoot, name, f)),
      ];
      const header = candidates.find((p) => fs.existsSync(p));
      if (!header) {
        throw new Error(`with-key-commands: no bridging header under ${path.join(iosRoot, name)}`);
      }
      const current = fs.readFileSync(header, "utf8");
      if (!current.includes(HEADER_IMPORT)) {
        fs.writeFileSync(header, `${current.trimEnd()}\n${HEADER_IMPORT}\n`);
      }
      return mod;
    },
  ]);
}

module.exports = function withKeyCommands(config) {
  return withKeyCommandsBridgingHeader(withKeyCommandsAppDelegate(config));
};
