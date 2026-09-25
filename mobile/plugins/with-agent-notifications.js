// Agent marks on push notifications.
//
// iOS always draws the app icon on a notification, with one exception: a
// Communication Notification (INSendMessageIntent) draws the sender's avatar
// and puts the app icon in a small badge, like a WhatsApp message. This plugin
// adds a Notification Service Extension that turns a push carrying
// `data.agent` (see src/push-native.ts in the root repo) into one, with the
// agent's mark as the avatar and the session title as the sender name.
//
// A push without `data.agent`, a failure in the extension, or the person
// turning off Communication Notifications all fall back to the plain alert.
//
// The Xcode target helpers come from expo-widgets, which already builds one
// app extension this way. They are internal to that package, so an upgrade
// that moves them fails the prebuild loudly here instead of shipping a build
// with no extension.
const { withDangerousMod, withEntitlementsPlist, withInfoPlist, withXcodeProject } = require("@expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

const withTargetXcodeProject = require("expo-widgets/plugin/build/ios/xcode/withTargetXcodeProject").default;
const withEasConfig = require("expo-widgets/plugin/build/ios/withEasConfig").default;

const TARGET = "OmgNotificationService";

const INFO_PLIST = (version, build) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSExtension</key>
	<dict>
		<key>NSExtensionPointIdentifier</key>
		<string>com.apple.usernotifications.service</string>
		<key>NSExtensionPrincipalClass</key>
		<string>$(PRODUCT_MODULE_NAME).NotificationService</string>
	</dict>
	<key>CFBundleShortVersionString</key>
	<string>${version}</string>
	<key>CFBundleVersion</key>
	<string>${build}</string>
</dict>
</plist>
`;

const ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict/>
</plist>
`;

// Mirrors agentIcon() in src/omg/agent-icons.ts: `codex-aisdk` is Codex, and
// anything unrecognised (including `aisdk`) is the Claude mark.
const SWIFT = (agents) => `import Intents
import UIKit
import UserNotifications

final class NotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var fallback: UNNotificationContent?

  private static let agents: Set<String> = [${agents.map((a) => JSON.stringify(a)).join(", ")}]

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    fallback = request.content
    guard let raw = Self.agentId(request.content.userInfo),
          let avatar = Self.avatar(for: Self.normalize(raw)) else {
      finish(request.content)
      return
    }

    let key = Self.normalize(raw)
    let title = request.content.title.isEmpty ? "omg" : request.content.title
    let sender = INPerson(
      personHandle: INPersonHandle(value: "omg-agent-\\(key)", type: .unknown),
      nameComponents: nil,
      displayName: title,
      image: avatar,
      contactIdentifier: nil,
      customIdentifier: "omg-agent-\\(key)"
    )
    let conversation = request.content.threadIdentifier.isEmpty
      ? request.identifier
      : request.content.threadIdentifier
    let intent = INSendMessageIntent(
      recipients: nil,
      outgoingMessageType: .outgoingMessageText,
      content: request.content.body,
      speakableGroupName: nil,
      conversationIdentifier: conversation,
      serviceName: nil,
      sender: sender,
      attachments: nil
    )
    intent.setImage(avatar, forParameterNamed: \\.sender)
    let interaction = INInteraction(intent: intent, response: nil)
    interaction.direction = .incoming
    interaction.donate { [weak self] _ in
      guard let self else { return }
      if let updated = try? request.content.updating(from: intent) {
        self.finish(updated)
      } else {
        self.finish(request.content)
      }
    }
  }

  override func serviceExtensionTimeWillExpire() {
    if let fallback { finish(fallback) }
  }

  private func finish(_ content: UNNotificationContent) {
    guard let handler = contentHandler else { return }
    contentHandler = nil
    handler(content)
  }

  /// Expo's relay nests \`data\` under \`body\`. A hand-built APNs payload
  /// (\`simctl push\`) may put it at the top level.
  private static func agentId(_ info: [AnyHashable: Any]) -> String? {
    if let body = info["body"] as? [String: Any], let agent = body["agent"] as? String { return agent }
    if let body = info["body"] as? String,
       let data = body.data(using: .utf8),
       let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
       let agent = json["agent"] as? String { return agent }
    return info["agent"] as? String
  }

  private static func normalize(_ raw: String) -> String {
    let key = raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if key == "codex-aisdk" { return "codex" }
    return agents.contains(key) ? key : "claude"
  }

  /// The mark on a white disc. iOS crops the avatar to a circle, and most
  /// marks are drawn for a light tile.
  private static func avatar(for key: String) -> INImage? {
    guard let mark = UIImage(named: "agent-\\(key)", in: Bundle(for: NotificationService.self), compatibleWith: nil) else {
      return nil
    }
    let side: CGFloat = 60
    let format = UIGraphicsImageRendererFormat()
    format.scale = 3
    let image = UIGraphicsImageRenderer(size: CGSize(width: side, height: side), format: format).image { _ in
      UIColor.white.setFill()
      UIBezierPath(ovalIn: CGRect(x: 0, y: 0, width: side, height: side)).fill()
      let inset = side * 0.2
      mark.draw(in: CGRect(x: inset, y: inset, width: side - inset * 2, height: side - inset * 2))
    }
    guard let png = image.pngData() else { return nil }
    return INImage(imageData: png)
  }
}
`;

function agentFiles(projectRoot) {
  const source = path.join(projectRoot, "assets/agents");
  return fs.readdirSync(source).filter((name) => /^agent-[a-z]+(@[23]x)?\.png$/.test(name));
}

function agentKeys(projectRoot) {
  return [...new Set(agentFiles(projectRoot).map((f) => f.replace(/^agent-/, "").replace(/(@[23]x)?\.png$/, "")))].sort();
}

function writeSources(config) {
  return withDangerousMod(config, ["ios", (mod) => {
    const { projectRoot, platformProjectRoot } = mod.modRequest;
    const dir = path.join(platformProjectRoot, TARGET);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const version = mod.ios?.version ?? mod.version ?? "1.0";
    const build = mod.ios?.buildNumber ?? "1";
    fs.writeFileSync(path.join(dir, "Info.plist"), INFO_PLIST(version, build));
    fs.writeFileSync(path.join(dir, `${TARGET}.entitlements`), ENTITLEMENTS);
    fs.writeFileSync(path.join(dir, "NotificationService.swift"), SWIFT(agentKeys(projectRoot)));

    const catalog = path.join(dir, "AgentMarks.xcassets");
    fs.mkdirSync(catalog, { recursive: true });
    fs.writeFileSync(path.join(catalog, "Contents.json"), JSON.stringify({ info: { version: 1, author: "xcode" } }));
    const source = path.join(projectRoot, "assets/agents");
    for (const key of agentKeys(projectRoot)) {
      const set = path.join(catalog, `agent-${key}.imageset`);
      fs.mkdirSync(set, { recursive: true });
      const images = [];
      for (const [suffix, scale] of [["", "1x"], ["@2x", "2x"], ["@3x", "3x"]]) {
        const file = `agent-${key}${suffix}.png`;
        if (!fs.existsSync(path.join(source, file))) continue;
        fs.copyFileSync(path.join(source, file), path.join(set, file));
        images.push({ idiom: "universal", filename: file, scale });
      }
      fs.writeFileSync(path.join(set, "Contents.json"), JSON.stringify({ images, info: { version: 1, author: "xcode" } }));
    }
    return mod;
  }]);
}

function addAssetCatalog(config) {
  return withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const target = project.findTargetKey(TARGET);
    if (!target) throw new Error(`${TARGET} target missing; the agent notification plugin order changed`);
    const relative = `${TARGET}/AgentMarks.xcassets`;
    if (!project.pbxGroupByName("Resources")) {
      const group = project.addPbxGroup([], "Resources", '""');
      project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup);
    }
    const phases = project.pbxNativeTargetSection()[target].buildPhases;
    const resources = project.hash.project.objects.PBXResourcesBuildPhase ?? {};
    if (!phases.some((phase) => resources[phase.value])) project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target);
    if (!project.hasFile(relative)) project.addResourceFile(relative, { target });
    return mod;
  });
}

module.exports = function withAgentNotifications(config) {
  const bundleIdentifier = `${config.ios.bundleIdentifier}.${TARGET}`;

  // The main app declares the capability and the intent it donates.
  config = withEntitlementsPlist(config, (mod) => {
    mod.modResults["com.apple.developer.usernotifications.communication"] = true;
    return mod;
  });
  config = withInfoPlist(config, (mod) => {
    const types = new Set(mod.modResults.NSUserActivityTypes ?? []);
    types.add("INSendMessageIntent");
    mod.modResults.NSUserActivityTypes = [...types];
    return mod;
  });

  // Registration order matters: xcodeproj mods registered LATER run FIRST, so
  // the asset catalog step is registered before the step that creates the target.
  config = addAssetCatalog(config);
  config = withTargetXcodeProject(config, {
    targetName: TARGET,
    bundleIdentifier,
    deploymentTarget: config.ios?.deploymentTarget ?? "16.4",
    appleTeamId: config.ios?.appleTeamId,
    getFileUris: () => {
      const root = path.join(config._internal?.projectRoot ?? process.cwd(), "ios", TARGET);
      return [path.join(root, "NotificationService.swift"), path.join(root, `${TARGET}.entitlements`)];
    },
  });
  config = writeSources(config);

  // EAS signs every extension listed here. The shape is shared with the
  // widget target, so reuse its writer. It adds an app group entry; this
  // target has none, so strip that back out.
  config = withEasConfig(config, { targetName: TARGET, bundleIdentifier, groupIdentifier: null });
  const ext = config.extra.eas.build.experimental.ios.appExtensions.find((e) => e.targetName === TARGET);
  ext.entitlements = {};
  return config;
};
