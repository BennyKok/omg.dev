const { withXcodeProject } = require("@expo/config-plugins");
const fs = require("node:fs");
const path = require("node:path");

/** Bundle the existing agent marks in the extension so push-to-start needs no
 * app launch, network image fetch, or device-specific file path. */
module.exports = function withActivityIcons(config) {
  return withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    const target = project.findTargetKey("ExpoWidgetsTarget");
    if (!target) throw new Error("Activity icons require the expo-widgets target");
    const relative = "ExpoWidgetsTarget/AgentMarks.xcassets";
    const catalog = path.join(mod.modRequest.platformProjectRoot, relative);
    fs.mkdirSync(catalog, { recursive: true });
    fs.writeFileSync(path.join(catalog, "Contents.json"), JSON.stringify({ info: { version: 1, author: "xcode" } }));
    const source = path.join(mod.modRequest.projectRoot, "assets/agents");
    for (const file of fs.readdirSync(source).filter((name) => /^agent-[a-z]+\.png$/.test(name))) {
      const set = path.join(catalog, `${file.slice(0, -4)}.imageset`);
      fs.mkdirSync(set, { recursive: true });
      fs.copyFileSync(path.join(source, file), path.join(set, file));
      fs.writeFileSync(path.join(set, "Contents.json"), JSON.stringify({
        images: [{ idiom: "universal", filename: file }], info: { version: 1, author: "xcode" },
      }));
    }
    const villageSource = path.join(mod.modRequest.projectRoot, "assets/village");
    for (const file of fs.readdirSync(villageSource).filter((name) => /^notebook-(small|medium|large)-(light|dark)\.png$/.test(name))) {
      const set = path.join(catalog, `${file.slice(0, -4)}.imageset`);
      fs.mkdirSync(set, { recursive: true });
      fs.copyFileSync(path.join(villageSource, file), path.join(set, file));
      fs.writeFileSync(path.join(set, "Contents.json"), JSON.stringify({ images: [{ idiom: "universal", filename: file }], info: { version: 1, author: "xcode" } }));
    }
    // Expo's generated provider has no timeline before the app stages data.
    // Supply a native gallery/empty-timeline view that needs no JS layout or
    // App Group files. The normal app-owned timeline remains the only live data.
    const widgetPath = path.join(mod.modRequest.platformProjectRoot, "ExpoWidgetsTarget/OmgAgentVillage.swift");
    let swift = fs.readFileSync(widgetPath, "utf8");
    const providerAnchor = 'provider: WidgetsTimelineProvider(name: name)';
    const viewAnchor = 'WidgetsEntryView(entry: entry)';
    if (!swift.includes(providerAnchor) || !swift.includes(viewAnchor)) throw new Error("Expo widget provider changed; update the village fallback integration");
    swift = swift.replace(providerAnchor, 'provider: OmgVillageProvider()');
    swift = swift.replace(viewAnchor, 'if #available(iOS 17.0, *), entry.props == nil { OmgVillagePreview() } else { WidgetsEntryView(entry: entry) }');
    swift += `

private struct OmgVillageProvider: TimelineProvider {
  let base = WidgetsTimelineProvider(name: "OmgAgentVillage")
  func placeholder(in context: Context) -> WidgetsTimelineEntry { base.placeholder(in: context) }
  func getSnapshot(in context: Context, completion: @escaping @Sendable (WidgetsTimelineEntry) -> Void) {
    base.getSnapshot(in: context, completion: completion)
  }
  func getTimeline(in context: Context, completion: @escaping @Sendable (Timeline<WidgetsTimelineEntry>) -> Void) {
    base.getTimeline(in: context) { timeline in
      completion(timeline.entries.isEmpty ? Timeline(entries: [base.placeholder(in: context)], policy: .never) : timeline)
    }
  }
}

@available(iOS 17.0, *)
private struct OmgVillagePreview: View {
  @Environment(\\.widgetFamily) var family
  @Environment(\\.colorScheme) var scheme
  var body: some View {
    let size = family == .systemSmall ? "small" : family == .systemLarge ? "large" : "medium"
    let dark = scheme == .dark
    ZStack(alignment: .topLeading) {
      Image("notebook-\\(size)-\\(dark ? "dark" : "light")")
        .resizable().scaledToFill()
      VStack(alignment: .leading, spacing: 4) {
        Text("omg.dev").font(.system(size: 19, weight: .bold, design: .serif))
        Text("Open omg.dev to connect").font(.system(size: 12))
      }.foregroundStyle(dark ? Color.white : Color(red: 0.17, green: 0.16, blue: 0.15)).padding(16)
    }
    .containerBackground(for: .widget) { dark ? Color(red: 0.14, green: 0.16, blue: 0.13) : Color(red: 0.96, green: 0.95, blue: 0.91) }
    .widgetURL(URL(string: "omg:///"))
  }
}
`;
    fs.writeFileSync(widgetPath, swift);
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
};
