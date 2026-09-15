import { Capsule, Circle, Ellipse, Image, RoundedRectangle, Text, VStack, ZStack } from "@expo/ui/swift-ui";
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
  /** Session title, for the speech bubble. Absent means no bubble. */
  title?: string | null;
  /** When the session last did something, for the bubble's relative time. */
  lastActivityAt?: number | null;
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

function AgentVillage(props: VillageProps, environment: { widgetFamily: string; colorScheme?: "light" | "dark"; widgetRenderingMode?: "fullColor" | "accented" | "vibrant"; date?: number | string | Date }) {
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
      // PLATE, not MARK: a plated mark is drawn on a disc wider than itself,
      // so clamping to the glyph let the disc hang 2pt off the scene edge.
      Math.min(origin.x, width - origin.x) - PLATE / 2,
    ));

    // A triangle, not a sawtooth: it paces out and back, so the cycle never
    // teleports the agent across the village when it restarts.
    /*
     * NAPPERS AMBLE TOO, at half pace.
     *
     * They used to be pinned, on the reasoning that the "z" says they are
     * asleep. But "All finished" is the state this widget is in most of the
     * time, so that reasoning made the common case a still photograph and the
     * walk effectively unreachable. Benny asked to see the village move; a
     * gentler amble is how the calm state still moves.
     */
    const pace = roaming ? 1 : character.state === "idle" ? 0.5 : 0;
    const sweep = [-1, 0, 1, 0][phase] * room * pace;
    // A small counter-bob, so a walk does not read as sliding along a rail.
    const lift = [0, -1, 0, 1][phase] * Math.min(4, room / 4) * pace;
    // Sleeping still breathes, on top of whatever ambling it is doing.
    const breath = character.state === "idle" ? [0, -2, -3, -2][phase] : 0;

    const slot = { x: origin.x + sweep, y: origin.y + lift + breath };
    const stride = character.state === "working" ? [0, 3, 0, -3][phase] : 0;
    const hop = character.state === "blocked" ? [0, -5, -8, -5][phase] : 0;
    const legHeight = character.state === "idle" ? 5 : 7;
    const markY = slot.y + hop - legHeight - MARK / 2;
    /**
     * WHO GETS A DISC, AND WHY TINTED MODE IS DIFFERENT.
     *
     * A disc carries contrast on the nocturnal scene, where a dark mark would
     * disappear into the grass. In tinted mode it is also a trap: iOS renders
     * the widget from the ALPHA of its content, so an opaque disc and an
     * opaque mark on top of it merge into one flat puck and the mark stops
     * existing. That shipped, and a device screenshot caught it.
     *
     * Dropping the disc entirely fixed that but left Claude and DeepSeek as
     * bare transparent glyphs with nothing behind them, which Benny reported
     * next. So in tinted mode the disc survives only where the mark genuinely
     * needs a body of its own -- `plate` -- and that mark is drawn in
     * `fullColor` so iOS leaves it out of the accent mask and it stays visible
     * on top. Marks that ship their own disc keep reading fine without one.
     */
    const disc = tinted ? character.plate : (character.plate || (dark && character.markTone === "dark"));
    /*
     * `fullColor` opts this image out of the tint entirely. Only worth it on a
     * disc: a bare mark desaturated onto the garden reads well, and opting
     * every mark out would make the widget look pasted-on rather than tinted.
     */
    const markTint = tinted && disc ? "fullColor" : "desaturated";

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
          modifiers={[resizable(), widgetAccentedRenderingMode(markTint), frame({ width: character.iconSize, height: character.iconSize }), clipShape(disc ? "circle" : "roundedRectangle", 9), place(slot.x, markY)]}
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

  /** The summary's baseline. The bubble is floored against it so the two
   *  cannot stack on top of each other. */
  const captionY = family === "large" ? 46 : 29;

  const caption = (
    <VStack alignment="leading" spacing={1} modifiers={[frame({ width: width - (family === "large" ? 56 : 32), alignment: "leading" }), place(width / 2, captionY)]}>
      <Text modifiers={[bold(), font({ size: 19, design: "serif" }), lineLimit(1), foregroundColor(ink)]}>{summary}</Text>
    </VStack>
  );

  const emptyVillage = (
    <Text modifiers={[font({ size: 12 }), foregroundColor(subdued), place(width / 2, height / 2)]}>
      No active agents
    </Text>
  );


  /**
   * ONE SPEECH BUBBLE, OVER WHOEVER MATTERS MOST.
   *
   * The bridge already sorts the cast by rank -- a parked question first, then
   * a provider error, then running -- so index 0 IS the one worth reading, and
   * putting a bubble over everybody would overlap on medium and bury the
   * garden on large. One bubble, over the lead.
   *
   * Small gets none. A 170pt square has no room for a legible title next to a
   * cast and a caption, and a clipped bubble reads worse than no bubble.
   */
  const lead = characters[0];
  const leadSlot = scene.slots[0];
  const said = family === "small" ? null : (lead?.title ?? "").trim();
  /**
   * "NOW" IS THE ENTRY'S OWN DATE, not the moment the app wrote the frame.
   *
   * A timeline covers the next twelve minutes, so a relative time baked in at
   * write time is up to twelve minutes wrong by the last pose. `environment.date`
   * is the date WidgetKit is rendering for, which is the only clock that
   * follows the entries. It falls back to the write time on anything that does
   * not supply it.
   */
  const renderedAt = Number(environment.date ?? 0) || props.updatedAt;
  // `!= null`, not truthiness: an epoch of 0 is a timestamp, and a falsy test
  // silently drops the time from the bubble instead of showing it.
  const lastActivityAt = lead?.lastActivityAt;
  const sinceMinutes = typeof lastActivityAt === "number"
    ? Math.max(0, Math.round((renderedAt - lastActivityAt) / 60000))
    : null;
  const when = sinceMinutes === null
    ? ""
    : sinceMinutes < 1
      ? "now"
      : sinceMinutes < 60
        ? `${sinceMinutes}m`
        : sinceMinutes < 60 * 24
          ? `${Math.round(sinceMinutes / 60)}h`
          : `${Math.round(sinceMinutes / (60 * 24))}d`;

  const bubbleWidth = Math.min(family === "large" ? 196 : 150, width - 56);
  const bubbleHeight = when ? 34 : 24;
  const paper = dark ? "#1B1F19" : "#FFFFFF";

  /**
   * PICK A SPOT THAT IS ACTUALLY EMPTY.
   *
   * A bubble parked at a fixed offset from the lead covers whoever happens to
   * be standing there. Above the head runs into the caption; beside the head
   * ran straight through two other villagers on the simulator. The village is
   * crowded and its slots differ per family, so the position has to be chosen
   * against the actual cast rather than assumed.
   *
   * Candidates are tried nearest-the-speaker first and the first clear one
   * wins. If the village is too full for any of them the least-obstructed one
   * is used rather than dropping the bubble, because a slightly overlapped
   * title still tells you more than no title at all.
   */
  const leadLegs = lead?.state === "idle" ? 5 : 7;
  const leadHeadY = leadSlot ? leadSlot.y - leadLegs - MARK / 2 : height / 2;
  const markBoxes = characters.map((who, i) => ({
    x: scene.slots[i].x,
    y: scene.slots[i].y - (who.state === "idle" ? 5 : 7) - MARK / 2,
  }));
  const clampX = (x: number) => Math.min(Math.max(x, bubbleWidth / 2 + 6), width - bubbleWidth / 2 - 6);
  const clampY = (y: number) => Math.min(Math.max(y, captionY + 20 + bubbleHeight / 2), height - bubbleHeight / 2 - 6);
  const reach = MARK / 2 + 6 + bubbleWidth / 2;
  const candidates = leadSlot
    ? [
      { x: leadSlot.x, y: leadHeadY - MARK / 2 - bubbleHeight / 2 - 6 },
      { x: leadSlot.x + reach, y: leadHeadY },
      { x: leadSlot.x - reach, y: leadHeadY },
      { x: width - bubbleWidth / 2 - 8, y: captionY + 20 + bubbleHeight / 2 },
      { x: width / 2, y: height - bubbleHeight / 2 - 8 },
    ]
    : [{ x: width / 2, y: height / 2 }];

  /** How much of this position lands on top of a villager. */
  const obstruction = (at: { x: number; y: number }) => markBoxes.reduce((sum, box) => {
    const overlapX = Math.max(0, Math.min(at.x + bubbleWidth / 2, box.x + MARK / 2) - Math.max(at.x - bubbleWidth / 2, box.x - MARK / 2));
    const overlapY = Math.max(0, Math.min(at.y + bubbleHeight / 2, box.y + MARK / 2) - Math.max(at.y - bubbleHeight / 2, box.y - MARK / 2));
    return sum + overlapX * overlapY;
  }, 0);

  let spot = { x: clampX(candidates[0].x), y: clampY(candidates[0].y) };
  let worst = Infinity;
  for (const candidate of candidates) {
    const at = { x: clampX(candidate.x), y: clampY(candidate.y) };
    const cost = obstruction(at);
    if (cost < worst) { worst = cost; spot = at; }
    if (cost === 0) break;
  }
  const bubbleX = spot.x;
  const bubbleY = spot.y;
  /** The tail points back at the speaker, on whichever side it ended up. */
  const tailLeft = bubbleX >= (leadSlot ? leadSlot.x : width / 2);
  /**
   * THE TAIL ONLY EXISTS WHEN IT FITS, and only on the speaker's side.
   *
   * The bubble is clamped into the scene but the dots were not, so a bubble
   * pushed against an edge -- which is every large widget, whose lead stands
   * at x=80 under a 196pt bubble -- put one dot on the boundary and the next
   * at x=-6, off the widget. One clipped dot and one missing, seen on a
   * device.
   *
   * It is not flipped to the roomy side when it does not fit: a tail pointing
   * away from the agent it belongs to is worse than no tail. A bubble without
   * one still reads as a label.
   */
  const tailOffsets = [{ size: 7, out: 5, drop: 8 }, { size: 4, out: 12, drop: 13 }];
  const tailX = (out: number) => bubbleX + (tailLeft ? -1 : 1) * (bubbleWidth / 2 + out);
  const tailFits = tailOffsets.every((dot) => {
    const at = tailX(dot.out);
    return at - dot.size / 2 >= 0 && at + dot.size / 2 <= width;
  });

  /*
   * NO FILLED BODY WHEN TINTED. Same trap as the mark discs: iOS renders a
   * tinted widget from the ALPHA of its content, so an opaque bubble and the
   * text inside it both come out solid white and the words vanish. Verified on
   * the simulator -- a filled bubble rendered as an empty white slab.
   *
   * Bare text over the garden reads fine there, which is what the accidental
   * first version proved, so tinted mode simply goes without the paper.
   */
  const bubble = said
    ? (
      <ZStack>
        {tinted ? null : (
          <RoundedRectangle
            cornerRadius={11}
            modifiers={[frame({ width: bubbleWidth, height: bubbleHeight }), foregroundColor(paper), place(bubbleX, bubbleY)]}
          />
        )}
        {/* Two shrinking dots aimed back at the character, instead of a drawn
            tail: the toolkit exposes no triangle, and the thought-bubble
            reading suits a garden anyway. */}
        {tinted || !tailFits ? null : tailOffsets.map((dot) => (
          <Circle
            key={`tail-${dot.out}`}
            modifiers={[frame({ width: dot.size, height: dot.size }), foregroundColor(paper), place(tailX(dot.out), bubbleY + dot.drop)]}
          />
        ))}
        <VStack alignment="leading" spacing={1} modifiers={[
          frame({ width: bubbleWidth - 18, alignment: "leading" }),
          place(bubbleX, bubbleY),
        ]}>
          <Text modifiers={[bold(), font({ size: 11 }), lineLimit(1), foregroundColor(ink)]}>{said}</Text>
          {when
            ? <Text modifiers={[font({ size: 10 }), lineLimit(1), foregroundColor(subdued)]}>{when}</Text>
            : null}
        </VStack>
      </ZStack>
    )
    : null;

  return (
    <ZStack modifiers={[frame({ width, height }), containerBackground(sky, "widget"), widgetURL(url)]}>
      {village}
      {crowd}
      {bubble}
      {caption}
      {characters.length === 0 ? emptyVillage : null}
    </ZStack>
  );
}

export const AgentVillageWidget = createWidget<VillageProps>("OmgAgentVillage", AgentVillage);
