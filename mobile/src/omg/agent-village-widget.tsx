import { Capsule, Circle, Ellipse, Image, RoundedRectangle, Text, VStack, ZStack } from "@expo/ui/swift-ui";
import { bold, clipShape, resizable, lineLimit, containerBackground, font, foregroundColor, frame, offset, widgetURL, widgetAccentedRenderingMode } from "@expo/ui/swift-ui/modifiers";
import { createWidget, type WidgetEnvironment } from "expo-widgets";

/** What one character needs to draw itself. */
export type VillageCharacter = {
  /**
   * The session this villager IS. Used as the view's identity, so SwiftUI can
   * tell a new agent arriving from the cast simply reshuffling -- an insertion
   * is what `.transition` animates, and an index would make every arrival look
   * like a change to whoever already stood there.
   */
  id?: string;
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

function AgentVillage(props: VillageProps, environment: WidgetEnvironment) {
  "widget";
  if (!props.scenes) {
    return <Text modifiers={[font({ size: 14 }), widgetURL("omg:///")]}>Open omg.dev to start your garden</Text>;
  }
  /**
   * `.transition(_:)`, which upstream @expo/ui does not expose.
   *
   * SwiftUI uses it to animate a view being INSERTED, which is exactly what a
   * new agent is. `animation(_:value:)` cannot stand in: it animates a change
   * to something already on screen, and an arriving villager is not a change
   * to anything -- it was not there.
   *
   * A modifier record is a plain object, so this needs no helper. It must be
   * declared INSIDE the widget body: the compiled layout is evaluated on its
   * own in the extension and cannot see module scope, which the native check
   * caught the moment this lived at the top of the file.
   *
   * The native half is `patches/@expo%2Fui@58.0.4.patch`, registering a
   * `TransitionModifier`. Being native, it rides a BUILD and not an update.
   */
  const transition = (kind: string) => ({ $type: "transition", kind });
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
  /**
   * Offset from the PARENT's centre, for children of a framed view.
   *
   * `place()` above is absolute: it positions against the whole widget, which
   * is right for anything laid out in scene coordinates. Inside the villager
   * -- which is framed to its mark so the arrival transition scales about the
   * agent -- the children are positioned relative to that mark instead, and
   * this is that. Two helpers because there are genuinely two coordinate
   * spaces, and the bug they prevent is a limb drawn a whole widget away.
   */
  const at = (dx: number, dy: number) => offset({ x: dx, y: dy });

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
    /**
     * SLEEPING, RENDERED THE ONLY WAY A WIDGET CAN.
     *
     * There is no animation loop, so "idle animation" can only mean a pose
     * that differs per timeline entry. A napper gets two of them: the body
     * rises and settles, and the "z" above it drifts up and away before
     * starting over -- which is the shape of a sleep marker in every cartoon
     * and reads as resting rather than as walking.
     *
     * Deeper than it was, because a 3pt rise on a 170pt widget is not a breath
     * anybody sees between two glances.
     */
    const breath = character.state === "idle" ? [0, -3, -5, -3][phase] : 0;
    /*
     * IT HAS TO STAY ATTACHED TO THE SLEEPER.
     *
     * The drift used to end 23pt right of the mark's centre and 29pt above it,
     * which on a 34pt mark is most of a mark's width clear of the head -- so
     * at the end of the cycle the "z" read as a separate thing floating in the
     * grass rather than as this agent's sleep. Benny reported exactly that.
     *
     * It still rises and fades, because that is what makes it read as sleep
     * rather than as a letter; it just does it in the space right above the
     * head instead of leaving.
     */
    const snoozeLift = [0, -4, -7, -10][phase];
    const snoozeDrift = [0, 2, 3, 5][phase];
    const snoozeSize = [11, 10, 9, 8][phase];

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
      /*
       * THE VILLAGER IS ITS OWN SMALL VIEW, and that is what makes the
       * arrival animation land in the right place.
       *
       * Every child used to be positioned with `place()`, which offsets from
       * the centre of the WHOLE WIDGET. That made this ZStack widget-sized, so
       * `.transition(.scale)` scaled it about the widget's centre: a new agent
       * flew in from the middle of the village rather than growing where it
       * stands. Benny: "scale in center is not from the center of the agent."
       *
       * Framing it to the mark and placing the frame gives SwiftUI a view
       * whose centre IS the agent, so the default `.scale` anchor is already
       * the right one and no anchor has to cross the native bridge. Children
       * are offset relative to the mark's centre with `at()`. Nothing clips:
       * SwiftUI lets children overflow a frame, which the legs, the shadow and
       * the "z" all rely on.
       */
      <ZStack
        key={character.id ?? `villager-${index}`}
        modifiers={[frame({ width: MARK, height: MARK }), place(slot.x, markY), transition("scale")]}
      >
        <Ellipse modifiers={[frame({ width: 25, height: 5 }), foregroundColor(dark ? "#3C4333" : "#B5B99C"), at(0, slot.y + 1 - markY)]} />
        <Capsule
          modifiers={[
            frame({ width: 5, height: legHeight }),
            foregroundColor(character.legColor),
            at(-5 + stride, MARK / 2 + legHeight / 2),
          ]}
        />
        <Capsule
          modifiers={[
            frame({ width: 5, height: legHeight }),
            foregroundColor(character.legColor),
            at(5 - stride, MARK / 2 + legHeight / 2),
          ]}
        />
        {disc
          ? <Circle modifiers={[frame({ width: PLATE, height: PLATE }), foregroundColor(discColor), at(0, 0)]} />
          : null}
        <Image
          uiImage={character.iconUri}
          modifiers={[resizable(), widgetAccentedRenderingMode(markTint), frame({ width: character.iconSize, height: character.iconSize }), clipShape(disc ? "circle" : "roundedRectangle", 9), at(0, 0)]}
        />
        {character.state === "blocked"
          ? <Text modifiers={[bold(), font({ size: 15 }), foregroundColor(flagged), at(16, -18)]}>!</Text>
          : null}
        {character.state === "idle"
          ? <Text modifiers={[font({ size: snoozeSize }), foregroundColor(subdued), at(12 + snoozeDrift, -12 + snoozeLift)]}>z</Text>
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
   * ONE BUBBLE PER AGENT, as many as the village has room for.
   *
   * It used to be a single bubble over the highest-ranked session. That read
   * as arbitrary once two agents were on screen -- you could see who was
   * working and only hear from one of them. Benny asked for each.
   *
   * They are placed in rank order, which the bridge already sorts: a parked
   * question, then a provider error, then running. Each takes the first
   * candidate position that clears every villager AND every bubble already
   * placed, so the ones that matter most get the good spots. A speaker with
   * nowhere left to stand is simply silent rather than overlapping someone --
   * which is also what caps the count, without a magic number deciding it.
   */
  const renderedAt = Number(environment.date ?? 0) || props.updatedAt;
  /**
   * A BUBBLE IS AS WIDE AS WHAT IT SAYS.
   *
   * Every bubble was one fixed width, so "Napping" got the same slab as "Fix
   * the widget border" and the village looked like a form rather than a
   * conversation. Benny called it: too wide, and not matching the content.
   *
   * SwiftUI would size a Text to its content on its own, but the placement
   * here has to KNOW the width -- it is what the overlap scan tests against --
   * so the width is estimated from the string instead of measured.
   *
   * 6.6pt per glyph, not the 5.6 this started at: at 11pt semibold that was
   * too mean and titles truncated on the device -- "Napping" came out as
   * "Nappi...".
   *
   * It does NOT go wider than that, and the reason is worth keeping. Widening
   * further did fit more words, and cost a whole speaker: the seat scan could
   * no longer place the second bubble without covering somebody, so it went
   * silent. Room for the words is bought INSIDE the bubble instead, by taking
   * less off for the text inset. A truncated title is a smaller loss than an
   * agent with nothing to say.
   */
  const bubbleRoom = Math.min(family === "large" ? 176 : 150, width - 56);
  const widthFor = (title: string, hasTime: boolean) => Math.round(Math.min(
    bubbleRoom,
    Math.max(
      // Never narrower than the time line it also has to hold.
      hasTime ? 62 : 48,
      title.length * 6.6 + 22,
    ),
  ));
  const paper = dark ? "#1B1F19" : "#FFFFFF";

  /** The summary's baseline, so a bubble can never stack on top of it. */
  const captionBand = captionY + 20;

  const age = (at: number | null | undefined) => {
    // `!= null`, not truthiness: an epoch of 0 is a timestamp, and a falsy
    // test silently drops the time instead of showing it.
    if (typeof at !== "number") return "";
    const minutes = Math.max(0, Math.round((renderedAt - at) / 60000));
    return minutes < 1 ? "now"
      : minutes < 60 ? `${minutes}m`
        : minutes < 60 * 24 ? `${Math.round(minutes / 60)}h`
          : `${Math.round(minutes / (60 * 24))}d`;
  };

  /**
   * A LIVE CLOCK, THE ONE THING A WIDGET CAN UPDATE FOR FREE.
   *
   * WidgetKit renders timer Text itself, outside the timeline: it ticks every
   * second and costs no reload budget. Everything else here can only change
   * when an entry is rendered, which iOS grants sparingly, so without this a
   * twelve minute old frame looked exactly like a fresh one.
   *
   * Only a RUNNING agent gets one. A counter climbing beside a session that
   * has stopped says the wrong thing, so those keep a rounded age.
   */
  const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

  /**
   * WHERE EVERYBODY ACTUALLY IS, not where their slot is.
   *
   * These boxes were built from the raw slot while the villagers walk away
   * from it -- up to `room` points, which is 28 on a roomy seat. A bubble
   * cleared the slot and then landed on the agent standing beside it, and a
   * narrower bubble made that easy to hit. The pose is computed once here, by
   * the same rule the crowd draws with, and both read it.
   *
   * The box is PLATE wide, not MARK: a plated mark sits on a disc wider than
   * the glyph, and clearing the glyph still clips the disc.
   */
  const poses = characters.map((who, index) => {
    const origin = scene.slots[index];
    const phase = (props.walkPhase + index) % 4;
    const roaming = who.state === "working";
    let nearest = Infinity;
    for (let other = 0; other < characters.length; other += 1) {
      if (other === index) continue;
      const gap = scene.slots[other];
      nearest = Math.min(nearest, Math.hypot(gap.x - origin.x, gap.y - origin.y));
    }
    const room = Math.max(0, Math.min(
      MAX_ROAM,
      (nearest - MARK) / 2,
      Math.min(origin.x, width - origin.x) - PLATE / 2,
    ));
    const pace = roaming ? 1 : who.state === "idle" ? 0.5 : 0;
    const sweep = [-1, 0, 1, 0][phase] * room * pace;
    const lift = [0, -1, 0, 1][phase] * Math.min(4, room / 4) * pace;
    const breath = who.state === "idle" ? [0, -3, -5, -3][phase] : 0;
    const hop = who.state === "blocked" ? [0, -5, -8, -5][phase] : 0;
    const legHeight = who.state === "idle" ? 5 : 7;
    const x = origin.x + sweep;
    const y = origin.y + lift + breath;
    return { phase, room, x, y, legHeight, markY: y + hop - legHeight - MARK / 2 };
  });

  const markBoxes = poses.map((pose) => ({ x: pose.x, y: pose.markY, w: PLATE, h: PLATE }));
  const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
    Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;

  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const bubbles = characters.map((who, index) => {
    const said = family === "small" ? "" : (who.title ?? "").trim();
    if (!said) return null;
    const startedAt = who.lastActivityAt;
    const ticking = who.state === "working" && typeof startedAt === "number";
    const when = ticking ? "" : age(startedAt);
    const bubbleHeight = ticking || when ? 34 : 24;
    const bubbleWidth = widthFor(said, ticking || !!when);

    const pose = poses[index];
    const slot = { x: pose.x, y: pose.y };
    const headY = pose.markY;
    const clampX = (x: number) => Math.min(Math.max(x, bubbleWidth / 2 + 6), width - bubbleWidth / 2 - 6);
    const clampY = (y: number) => Math.min(Math.max(y, captionBand + bubbleHeight / 2), height - bubbleHeight / 2 - 6);
    const reach = MARK / 2 + 6 + bubbleWidth / 2;
    const candidates = [
      { x: slot.x, y: headY - MARK / 2 - bubbleHeight / 2 - 6 },
      { x: slot.x + reach, y: headY },
      { x: slot.x - reach, y: headY },
      { x: slot.x, y: headY + MARK / 2 + bubbleHeight / 2 + 10 },
      { x: width - bubbleWidth / 2 - 8, y: captionBand + bubbleHeight / 2 },
      { x: bubbleWidth / 2 + 8, y: captionBand + bubbleHeight / 2 },
    ];

    let spot: { x: number; y: number } | null = null;
    for (const candidate of candidates) {
      const box = { x: clampX(candidate.x), y: clampY(candidate.y), w: bubbleWidth, h: bubbleHeight };
      if (markBoxes.some((mark) => overlaps(box, mark))) continue;
      if (placed.some((other) => overlaps(box, other))) continue;
      spot = { x: box.x, y: box.y };
      placed.push(box);
      break;
    }
    // Nowhere to stand without covering somebody. Stay quiet.
    if (!spot) return null;

    /**
     * THE TAIL AIMS AT ITS SPEAKER, in whatever direction that is.
     *
     * It used to be chosen by comparing x alone, so it always went sideways.
     * The placement scan picks ABOVE the agent whenever there is room, and
     * there usually is -- so the common case was a bubble directly over its
     * agent with the dots trailing off to one side, pointing at nothing.
     * Reported from a device: "the dot is too far away from center".
     *
     * Now the dots ride the ray from the bubble's centre to the agent's mark,
     * leaving the bubble wherever that ray actually crosses its edge.
     */
    const toward = { x: pose.x - spot.x, y: pose.markY - spot.y };
    const reachLen = Math.hypot(toward.x, toward.y) || 1;
    const unit = { x: toward.x / reachLen, y: toward.y / reachLen };
    // Where the ray leaves the bubble's rectangle: whichever side it meets first.
    const edge = Math.min(
      unit.x === 0 ? Infinity : (bubbleWidth / 2) / Math.abs(unit.x),
      unit.y === 0 ? Infinity : (bubbleHeight / 2) / Math.abs(unit.y),
    );
    const tailOffsets = [{ size: 7, out: 4 }, { size: 4, out: 11 }];
    const tailAt = (out: number) => ({
      x: spot.x + unit.x * (edge + out),
      y: spot.y + unit.y * (edge + out),
    });
    const tailFits = tailOffsets.every((dot) => {
      const at = tailAt(dot.out);
      return at.x - dot.size / 2 >= 0 && at.x + dot.size / 2 <= width
        && at.y - dot.size / 2 >= 0 && at.y + dot.size / 2 <= height;
    });

    return (
      <ZStack key={`bubble-${index}`}>
        {tinted ? null : (
          <RoundedRectangle
            cornerRadius={11}
            modifiers={[frame({ width: bubbleWidth, height: bubbleHeight }), foregroundColor(paper), place(spot.x, spot.y)]}
          />
        )}
        {tinted || !tailFits ? null : tailOffsets.map((dot) => {
          const at = tailAt(dot.out);
          return (
            <Circle
              key={`tail-${index}-${dot.out}`}
              modifiers={[frame({ width: dot.size, height: dot.size }), foregroundColor(paper), place(at.x, at.y)]}
            />
          );
        })}
        <VStack alignment="leading" spacing={1} modifiers={[
          frame({ width: bubbleWidth - 12, alignment: "leading" }),
          place(spot.x, spot.y),
        ]}>
          <Text modifiers={[bold(), font({ size: 11 }), lineLimit(1), foregroundColor(ink)]}>{said}</Text>
          {ticking
            ? (
              <Text
                timerInterval={{ lower: new Date(startedAt as number), upper: new Date((startedAt as number) + YEAR_MS) }}
                countsDown={false}
                modifiers={[font({ size: 10 }), lineLimit(1), foregroundColor(subdued)]}
              />
            )
            : when
              ? <Text modifiers={[font({ size: 10 }), lineLimit(1), foregroundColor(subdued)]}>{when}</Text>
              : null}
        </VStack>
      </ZStack>
    );
  }).filter(Boolean);

  return (
    <ZStack modifiers={[frame({ width, height }), containerBackground(sky, "widget"), widgetURL(url)]}>
      {village}
      {crowd}
      {bubbles}
      {caption}
      {characters.length === 0 ? emptyVillage : null}
    </ZStack>
  );
}

export const AgentVillageWidget = createWidget<VillageProps>("OmgAgentVillage", AgentVillage);
