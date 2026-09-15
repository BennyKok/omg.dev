import { Capsule, Circle, Ellipse, Image, Text, VStack, ZStack } from "@expo/ui/swift-ui";
import { bold, clipShape, resizable, lineLimit, containerBackground, font, foregroundColor, frame, offset, widgetURL, widgetAccentedRenderingMode } from "@expo/ui/swift-ui/modifiers";
import { createWidget } from "expo-widgets";

/** What one character needs to draw itself. */
export type VillageCharacter = {
  /** `file://` URI of the agent PNG in the shared widget directory. */
  iconUri: string;
  iconSize: number;
  /** The mark's own primary colour. The legs are painted with it. */
  legColor: string;
  /**
   * Draw a disc behind the mark on every scene. Claude and DeepSeek are bare
   * glyphs, so without one they read as a different species from Grok or
   * Devin, which ship their own disc.
   */
  plate: boolean;
  /**
   * How dark the mark is. A dark mark on the nocturnal scene needs a disc
   * whether or not it asked for one, or it disappears into the hill.
   */
  markTone: "light" | "dark";
  state: "working" | "blocked" | "idle";
};

export type VillageProps = {
  machineName: string;
  runningCount: number;
  blockedCount: number;
  /** Empty when no session needs attention. WidgetKit storage cannot persist null. */
  attentionSessionId: string;
  scenes: Record<"small" | "medium" | "large", {
    width: number;
    height: number;
    backgroundLightUri: string;
    backgroundDarkUri: string;
    slots: { x: number; y: number }[];
  }>;
  characters: VillageCharacter[];
  /** 0..3. One walk pose per timeline entry. */
  walkPhase: number;
  updatedAt: number;
};

function AgentVillage(props: VillageProps, environment: { widgetFamily: string; colorScheme?: "light" | "dark"; widgetRenderingMode?: "fullColor" | "accented" | "vibrant" }) {
  "widget";
  if (!props.scenes) {
    return <Text modifiers={[font({ size: 14 }), widgetURL("omg:///")]}>Open omg.dev to start your garden</Text>;
  }
  const MARK = 34;
  const PLATE = 38;
  /** Nobody roams further than this even when the scene has room for it. */
  const MAX_ROAM = 28;
  const family = environment.widgetFamily === "systemSmall" ? "small" : environment.widgetFamily === "systemLarge" ? "large" : "medium";
  const scene = props.scenes[family];

  const tinted = environment.widgetRenderingMode === "accented";
  // Tinted widgets flatten an unconfigured opaque image into a solid mask.
  // Preserve image luminance, and use the dark garden behind iOS's light ink.
  //
  // `dark` selects ART ONLY. It used to gate the mark discs too, which is how
  // a tinted widget ended up drawing a white puck over every dark mark; see
  // `disc` below.
  const dark = environment.colorScheme === "dark" || tinted;
  const width = scene.width;
  const height = scene.height;

  const sky = dark ? "#232820" : "#F4F1E8";
  const ink = dark ? "#F2F0EA" : "#2B2A26";
  const subdued = dark ? "#8A8880" : "#6B6A63";
  const flagged = "#FF9F0A";
  const discColor = dark ? "#EDEAE1" : "#FBF8F1";

  // SwiftUI offsets are measured from the centre of the ZStack. The scene is
  // authored in top-left points, so convert once here.
  const place = (centerX: number, centerY: number) => offset({ x: centerX - width / 2, y: centerY - height / 2 });

  const characters = props.characters.slice(0, scene.slots.length);

  const summary = props.blockedCount > 0
    ? `${props.blockedCount} ${props.blockedCount === 1 ? "needs" : "need"} you`
    : props.runningCount > 0
      ? `${props.runningCount} working`
      : "All finished";
  const url = props.attentionSessionId ? `omg:///session/${props.attentionSessionId}` : "omg:///";

  /**
   * THE SCENE IS AUTHORED FOR ONE WIDGET SIZE, AND THE REAL ONE VARIES.
   *
   * `scene.width`/`scene.height` are fixed points (medium is 364x170, which is
   * the medium widget on a 430x932pt device). Every other iPhone gets a
   * different container, and where the container is BIGGER the art stopped
   * short of the edges and `containerBackground(sky)` showed through as a
   * border. Reported from a device; invisible on the 430x932 simulator that
   * the authored size happens to match exactly.
   *
   * Over-bleed the art instead of trying to learn the container size, which
   * the widget environment does not report. The widget clips whatever hangs
   * over, so the only cost is a few points of the garden at each edge, and
   * coverage no longer depends on knowing every device.
   */
  const BLEED = 1.08;

  const village = (
    <Image
      uiImage={dark ? scene.backgroundDarkUri : scene.backgroundLightUri}
      modifiers={[resizable(), widgetAccentedRenderingMode("desaturated"), frame({ width: width * BLEED, height: height * BLEED }), place(width / 2, height / 2)]}
    />
  );

  // `walkPhase` swings the legs and lifts a blocked agent off the ground, so
  // consecutive timeline entries read as walking and jumping.
  const crowd = characters.map((character, index) => {
    const origin = scene.slots[index];
    const phase = (props.walkPhase + index) % 4;
    const roaming = character.state === "working";

    /**
     * HOW FAR THIS ONE CAN ROAM, MEASURED RATHER THAN TUNED.
     *
     * A widget cannot animate. The only motion anyone ever perceives is the
     * difference between two glances, so that difference has to be legible.
     * The old walk moved a working agent 10pt in total across a full cycle, on
     * a widget 364pt wide, which is a twitch nobody can see.
     *
     * The bound is geometric so it holds for any scene: half the distance to
     * the nearest neighbouring slot less a mark, so two agents cannot meet
     * even when they walk straight at each other, and clipped to the scene so
     * nobody steps off the grass.
     */
    let nearest = Infinity;
    for (let other = 0; other < characters.length; other += 1) {
      if (other === index) continue;
      const gap = scene.slots[other];
      nearest = Math.min(nearest, Math.hypot(gap.x - origin.x, gap.y - origin.y));
    }
    const room = Math.max(0, Math.min(
      MAX_ROAM,
      (nearest - MARK) / 2,
      Math.min(origin.x, width - origin.x) - MARK / 2,
    ));

    // A triangle, not a sawtooth: it paces out and back, so the cycle never
    // teleports the agent across the village when it restarts.
    const sweep = roaming ? [-1, 0, 1, 0][phase] * room : 0;
    // A small counter-bob, so a walk does not read as sliding along a rail.
    const lift = roaming ? [0, -1, 0, 1][phase] * Math.min(4, room / 4) : 0;
    // Napping agents keep their pitch; they only breathe, because the "z" says
    // they are asleep and a sleepwalking villager reads as a bug.
    const breath = character.state === "idle" ? [0, -2, -3, -2][phase] : 0;

    const slot = { x: origin.x + sweep, y: origin.y + lift + breath };
    const stride = character.state === "working" ? [0, 3, 0, -3][phase] : 0;
    const hop = character.state === "blocked" ? [0, -5, -8, -5][phase] : 0;
    const legHeight = character.state === "idle" ? 5 : 7;
    const markY = slot.y + hop - legHeight - MARK / 2;
    /**
     * NO DISC IN TINTED MODE.
     *
     * The disc exists to carry contrast on the nocturnal scene, where a dark
     * mark would otherwise disappear into the grass. Tinted mode does not need
     * it and cannot survive it: iOS renders the widget from the alpha of its
     * content, so an opaque disc and the mark on top of it merge into one flat
     * puck and the mark stops existing. Verified on device and on the
     * simulator — a mark WITHOUT a disc reads perfectly in the same render.
     *
     * So the disc is a full-colour affordance only. iOS owns contrast in
     * tinted mode, and it does the job without help.
     */
    const disc = !tinted && (character.plate || (dark && character.markTone === "dark"));

    return (
      <ZStack key={`villager-${index}`}>
        <Ellipse modifiers={[frame({ width: 25, height: 5 }), foregroundColor(dark ? "#3C4333" : "#B5B99C"), place(slot.x, slot.y + 1)]} />
        <Capsule
          modifiers={[
            frame({ width: 5, height: legHeight }),
            foregroundColor(character.legColor),
            place(slot.x - 5 + stride, markY + MARK / 2 + legHeight / 2),
          ]}
        />
        <Capsule
          modifiers={[
            frame({ width: 5, height: legHeight }),
            foregroundColor(character.legColor),
            place(slot.x + 5 - stride, markY + MARK / 2 + legHeight / 2),
          ]}
        />
        {disc
          ? <Circle modifiers={[frame({ width: PLATE, height: PLATE }), foregroundColor(discColor), place(slot.x, markY)]} />
          : null}
        <Image
          uiImage={character.iconUri}
          modifiers={[resizable(), widgetAccentedRenderingMode("desaturated"), frame({ width: character.iconSize, height: character.iconSize }), clipShape(disc ? "circle" : "roundedRectangle", 9), place(slot.x, markY)]}
        />
        {character.state === "blocked"
          ? <Text modifiers={[bold(), font({ size: 15 }), foregroundColor(flagged), place(slot.x + 16, markY - 18)]}>!</Text>
          : null}
        {character.state === "idle"
          ? <Text modifiers={[font({ size: 11 }), foregroundColor(subdued), place(slot.x + 15, markY - 14)]}>z</Text>
          : null}
      </ZStack>
    );
  });

  const caption = (
    <VStack alignment="leading" spacing={1} modifiers={[frame({ width: width - (family === "large" ? 56 : 32), alignment: "leading" }), place(width / 2, family === "large" ? 46 : 29)]}>
      <Text modifiers={[bold(), font({ size: 19, design: "serif" }), lineLimit(1), foregroundColor(ink)]}>{summary}</Text>
    </VStack>
  );

  const emptyVillage = (
    <Text modifiers={[font({ size: 12 }), foregroundColor(subdued), place(width / 2, height / 2)]}>
      No active agents
    </Text>
  );

  return (
    <ZStack modifiers={[frame({ width, height }), containerBackground(sky, "widget"), widgetURL(url)]}>
      {village}
      {crowd}
      {caption}
      {characters.length === 0 ? emptyVillage : null}
    </ZStack>
  );
}

export const AgentVillageWidget = createWidget<VillageProps>("OmgAgentVillage", AgentVillage);
