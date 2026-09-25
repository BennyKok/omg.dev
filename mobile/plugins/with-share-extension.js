// "omg.dev" in the iOS share sheet.
//
// A Share Extension is the only way for an iOS app to receive content from
// another app's share sheet (YouTube, Safari, X, ...). This plugin adds one.
// It has no UI of its own: it reads the shared link or text, opens
//
//     omg:///share?id=<uuid>&url=<link>&text=<text>
//
// and closes. The app then starts a session that asks the agent to read or
// watch the content. The URL format and the prompt live in
// src/omg/share-intent.ts; the handling lives in src/omg/share-routing.tsx.
//
// The payload travels in the URL, so the extension needs no App Group and no
// extra capability to sign.
//
// The Xcode target helpers are internal to expo-widgets, as in
// with-agent-notifications.js. An upgrade that moves them fails the prebuild
// loudly here instead of shipping a build with no extension.
const { withDangerousMod, withXcodeProject } = require("@expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const withTargetXcodeProject = require("expo-widgets/plugin/build/ios/xcode/withTargetXcodeProject").default;
const withEasConfig = require("expo-widgets/plugin/build/ios/withEasConfig").default;

const TARGET = "OmgShareExtension";

const INFO_PLIST = (version, build, scheme) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDisplayName</key>
	<string>omg.dev</string>
	<key>CFBundleShortVersionString</key>
	<string>${version}</string>
	<key>CFBundleVersion</key>
	<string>${build}</string>
	<key>OmgURLScheme</key>
	<string>${scheme}</string>
	<key>NSExtension</key>
	<dict>
		<key>NSExtensionAttributes</key>
		<dict>
			<key>NSExtensionActivationRule</key>
			<dict>
				<key>NSExtensionActivationSupportsWebURLWithMaxCount</key>
				<integer>1</integer>
				<key>NSExtensionActivationSupportsText</key>
				<true/>
			</dict>
		</dict>
		<key>NSExtensionPointIdentifier</key>
		<string>com.apple.share-services</string>
		<key>NSExtensionPrincipalClass</key>
		<string>$(PRODUCT_MODULE_NAME).ShareViewController</string>
	</dict>
</dict>
</plist>
`;

const ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict/>
</plist>
`;

const SWIFT = `import UIKit
import UniformTypeIdentifiers

/// Reads what was shared, hands it to the app as a URL, and closes.
final class ShareViewController: UIViewController {
  private var finished = false

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    guard !finished else { return }
    finished = true
    Task { @MainActor in
      let (link, text) = await self.collect()
      if let target = self.appURL(link: link, text: text) {
        self.open(target)
      }
      self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }
  }

  private func collect() async -> (URL?, String?) {
    var link: URL?
    var text: String?
    let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
    for item in items {
      for provider in item.attachments ?? [] {
        if link == nil, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
           let value = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) {
          if let url = value as? URL, !url.isFileURL { link = url }
          else if let raw = value as? String { link = URL(string: raw) }
        }
        if text == nil, provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
           let value = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) {
          if let raw = value as? String { text = raw }
          else if let data = value as? Data { text = String(data: data, encoding: .utf8) }
        }
      }
      if text == nil, let body = item.attributedContentText?.string, !body.isEmpty { text = body }
    }
    // Some apps share the link only as text. Lift it out so the agent gets a URL.
    if link == nil, let body = text,
       let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue),
       let match = detector.firstMatch(in: body, range: NSRange(body.startIndex..., in: body)) {
      link = match.url
    }
    return (link, text)
  }

  private func appURL(link: URL?, text: String?) -> URL? {
    guard link != nil || !(text ?? "").isEmpty else { return nil }
    let scheme = Bundle.main.object(forInfoDictionaryKey: "OmgURLScheme") as? String ?? "omg"
    var components = URLComponents()
    components.scheme = scheme
    components.host = ""
    components.path = "/share"
    var query = [URLQueryItem(name: "id", value: UUID().uuidString)]
    if let link { query.append(URLQueryItem(name: "url", value: link.absoluteString)) }
    if let text, !text.isEmpty { query.append(URLQueryItem(name: "text", value: String(text.prefix(4000)))) }
    components.queryItems = query
    return components.url
  }

  /// An extension has no UIApplication.shared, and this target builds with
  /// APPLICATION_EXTENSION_API_ONLY, so \`open(_:options:)\` cannot be named.
  /// The UIApplication is still in the responder chain, and the method is
  /// called through the runtime. This is how share extensions open their app.
  private func open(_ url: URL) {
    let selector = NSSelectorFromString("openURL:options:completionHandler:")
    typealias OpenURL = @convention(c) (AnyObject, Selector, NSURL, NSDictionary, AnyObject?) -> Void
    var responder: UIResponder? = self
    while let current = responder {
      if current is UIApplication, current.responds(to: selector) {
        let call = unsafeBitCast(current.method(for: selector), to: OpenURL.self)
        call(current, selector, url as NSURL, NSDictionary(), nil)
        return
      }
      responder = current.next
    }
  }
}
`;

function writeSources(config) {
  return withDangerousMod(config, ["ios", (mod) => {
    const { platformProjectRoot } = mod.modRequest;
    const dir = path.join(platformProjectRoot, TARGET);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const version = mod.ios?.version ?? mod.version ?? "1.0";
    const build = mod.ios?.buildNumber ?? "1";
    const scheme = Array.isArray(mod.scheme) ? mod.scheme[0] : (mod.scheme ?? "omg");
    fs.writeFileSync(path.join(dir, "Info.plist"), INFO_PLIST(version, build, scheme));
    fs.writeFileSync(path.join(dir, `${TARGET}.entitlements`), ENTITLEMENTS);
    fs.writeFileSync(path.join(dir, "ShareViewController.swift"), SWIFT);
    return mod;
  }]);
}

// The target helper sets INFOPLIST_KEY_CFBundleDisplayName to the target
// name, and that build setting wins over Info.plist. Without this the share
// sheet shows "OmgShareExtension".
function setDisplayName(config) {
  return withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const target = project.findTargetKey(TARGET);
    if (!target) throw new Error(`${TARGET} target missing; the share extension plugin order changed`);
    const listId = project.pbxNativeTargetSection()[target].buildConfigurationList;
    const list = project.pbxXCConfigurationList()[listId];
    const configs = project.pbxXCBuildConfigurationSection();
    for (const { value } of list.buildConfigurations) {
      configs[value].buildSettings.INFOPLIST_KEY_CFBundleDisplayName = '"omg.dev"';
    }
    return mod;
  });
}

module.exports = function withShareExtension(config) {
  const bundleIdentifier = `${config.ios.bundleIdentifier}.${TARGET}`;
  // xcodeproj mods registered LATER run FIRST, so this is registered before
  // the step that creates the target.
  config = setDisplayName(config);
  config = withTargetXcodeProject(config, {
    targetName: TARGET,
    bundleIdentifier,
    deploymentTarget: config.ios?.deploymentTarget ?? "16.4",
    appleTeamId: config.ios?.appleTeamId,
    getFileUris: () => {
      const root = path.join(config._internal?.projectRoot ?? process.cwd(), "ios", TARGET);
      return [path.join(root, "ShareViewController.swift"), path.join(root, `${TARGET}.entitlements`)];
    },
  });
  config = writeSources(config);

  // EAS signs every extension listed here. Same shape as the notification
  // service target, which also has no App Group.
  config = withEasConfig(config, { targetName: TARGET, bundleIdentifier, groupIdentifier: null });
  const ext = config.extra.eas.build.experimental.ios.appExtensions.find((e) => e.targetName === TARGET);
  ext.entitlements = {};
  return config;
};
