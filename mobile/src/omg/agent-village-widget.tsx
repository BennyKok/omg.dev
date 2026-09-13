import { Capsule, Circle, Ellipse, Image, Text, VStack, ZStack } from "@expo/ui/swift-ui";
import { bold, clipShape, resizable, lineLimit, containerBackground, font, foregroundColor, frame, offset, widgetURL } from "@expo/ui/swift-ui/modifiers";
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

function AgentVillage(props: VillageProps, environment: { widgetFamily: string; colorScheme?: "light" | "dark" }) {
  "widget";
  if (!props.scenes) {
    return <Text modifiers={[font({ size: 14 }), widgetURL("omg:///")]}>Open omg.dev to start your garden</Text>;
  }
  const MARK = 34;
  const PLATE = 38;
  const family = environment.widgetFamily === "systemSmall" ? "small" : environment.widgetFamily === "systemLarge" ? "large" : "medium";
  const scene = props.scenes[family];

  const dark = environment.colorScheme === "dark";
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

  const village = (
    <Image
      uiImage={dark ? scene.backgroundDarkUri : scene.backgroundLightUri}
      modifiers={[resizable(), frame({ width, height }), place(width / 2, height / 2)]}
    />
  );

  // `walkPhase` swings the legs and lifts a blocked agent off the ground, so
  // consecutive timeline entries read as walking and jumping.
  const crowd = characters.map((character, index) => {
    const slot = scene.slots[index];
    const phase = (props.walkPhase + index) % 4;
    const stride = character.state === "working" ? [0, 3, 0, -3][phase] : 0;
    const hop = character.state === "blocked" ? [0, -5, -8, -5][phase] : 0;
    const legHeight = character.state === "idle" ? 5 : 7;
    const markY = slot.y + hop - legHeight - MARK / 2;
    const disc = character.plate || (dark && character.markTone === "dark");

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
          modifiers={[resizable(), frame({ width: character.iconSize, height: character.iconSize }), clipShape(disc ? "circle" : "roundedRectangle", 9), place(slot.x, markY)]}
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
    <VStack alignment="leading" spacing={1} modifiers={[frame({ width: width - 32, alignment: "leading" }), place(width / 2, 29)]}>
      <Text modifiers={[bold(), font({ size: 19, design: "serif" }), lineLimit(1), foregroundColor(ink)]}>{summary}</Text>
      <Text modifiers={[font({ size: 11 }), lineLimit(1), foregroundColor(subdued)]}>{props.machineName}</Text>
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
