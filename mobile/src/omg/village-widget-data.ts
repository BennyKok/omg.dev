import { Asset } from "expo-asset";
import { Directory, File } from "expo-file-system";
import { widgetsDirectory } from "expo-widgets";

import { agentIcon } from "./agent-icons";
import type { VillageCharacter, VillageProps } from "./agent-village-widget";
import { VILLAGE_BACKGROUNDS, VILLAGE_SCENES, type VillageFamily } from "./village-scene";

/**
 * Primary colour per agent mark, sampled from the @3x PNGs.
 *
 * Dark marks keep their dark legs on both the pastoral and the nocturnal
 * scene. An earlier revision swapped Cursor to its white plate colour so the
 * legs would not vanish on `#141414`. Benny rejected that. The disc behind the
 * mark carries the contrast on the nocturnal scene instead, and the legs stay
 * the colour the mark actually is.
 */
const LEG_COLOR: Record<string, string> = {
  claude: "#D87656",
  codex: "#5467FF",
  "codex-aisdk": "#5467FF",
  cursor: "#26251E",
  copilot: "#111318",
  devin: "#3EDFC4",
  deepseek: "#4D6BFE",
  grok: "#111827",
  hermes: "#111111",
  jcode: "#07090D",
  muse: "#0866FF",
  opencode: "#121010",
  pi: "#111318",
  fx: "#000000",
  omg: "#23150E",
};

/** Bare glyphs with no disc of their own. */
const PLATED = new Set(["claude", "deepseek"]);

/**
 * Marks that are near black. On the nocturnal scene the widget puts a disc
 * behind these too. Benny asked for Cursor to keep its dark legs, so the legs
 * stay `#26251E` and the disc carries the contrast instead.
 */
const DARK_MARK = new Set(["cursor", "copilot", "grok", "hermes", "jcode", "opencode", "pi", "fx", "omg"]);

/** Mirrors agentIcon(): anything unrecognised shows the Claude mark. */
function normalizeAgent(agent?: string | null): string {
  const key = (agent ?? "").trim().toLowerCase();
  return key in LEG_COLOR ? key : "claude";
}

const ICON_DIRECTORY_NAME = "agents";
const SCENE_DIRECTORY_NAME = "notebook-v2";

/**
 * Copies the agent marks into the App Group directory and returns the
 * `file://` URI per agent key. Safe to call on every launch: a mark already
 * present is not copied again.
 */
export async function stageAgentIcons(agents: string[]): Promise<Record<string, string>> {
  if (!widgetsDirectory) return {};
  const directory = new Directory(widgetsDirectory, ICON_DIRECTORY_NAME);
  if (!directory.exists) directory.create({ intermediates: true });

  const staged: Record<string, string> = {};
  for (const agent of new Set(agents.map(normalizeAgent))) {
    const target = new File(directory, `agent-${agent}.png`);
    if (!target.exists) {
      // agentIcon() is typed ImageSourcePropType for <Image source>, but every
      // entry is a bare require(), which Metro resolves to a numeric module id.
      // Asset.fromModule() wants exactly that id.
      const asset = Asset.fromModule(agentIcon(agent) as number);
      await asset.downloadAsync();
      if (!asset.localUri) continue;
      await new File(asset.localUri).copy(target);
    }
    staged[agent] = target.uri;
  }
  return staged;
}

/**
 * Copies the notebook garden backgrounds into the App Group directory and
 * returns the `file://` URI per family and scheme.
 */
export async function stageVillageScenes(): Promise<Record<string, string>> {
  if (!widgetsDirectory) return {};
  const directory = new Directory(widgetsDirectory, SCENE_DIRECTORY_NAME);
  if (!directory.exists) directory.create({ intermediates: true });

  const staged: Record<string, string> = {};
  for (const family of ["small", "medium", "large"] as VillageFamily[]) {
    for (const scheme of ["light", "dark"] as const) {
      const target = new File(directory, `village-${family}-${scheme}.png`);
      if (!target.exists) {
        const asset = Asset.fromModule(VILLAGE_BACKGROUNDS[family][scheme] as number);
        await asset.downloadAsync();
        if (!asset.localUri) continue;
        await new File(asset.localUri).copy(target);
      }
      staged[`${family}-${scheme}`] = target.uri;
    }
  }
  return staged;
}

/**
 * Builds the scene half of the widget props for one family.
 *
 * Both colour schemes go into the entry. A widget cannot be asked which scheme
 * it is in before it renders, so choosing here would pin the art to whatever
 * the app happened to see and leave dark mode showing the daylight island.
 */
export function villageScene(
  family: VillageFamily,
  scenes: Record<string, string>,
): VillageProps["scenes"][VillageFamily] | null {
  const light = scenes[`${family}-light`];
  const dark = scenes[`${family}-dark`];
  if (!light || !dark) return null;
  const scene = VILLAGE_SCENES[family];
  return {
    backgroundLightUri: light,
    backgroundDarkUri: dark,
    width: scene.width,
    height: scene.height,
    slots: scene.slots.map((slot) => ({ ...slot })),
  };
}

/** Turns one session into one villager. */
export function villageCharacter(
  agent: string | null | undefined,
  state: VillageCharacter["state"],
  staged: Record<string, string>,
  said?: { title?: string | null; lastActivityAt?: number | null },
): VillageCharacter | null {
  const key = normalizeAgent(agent);
  const iconUri = staged[key];
  if (!iconUri) return null;
  return {
    iconUri,
    legColor: LEG_COLOR[key] ?? LEG_COLOR.claude,
    plate: PLATED.has(key),
    iconSize: key === "claude" ? 23 : 34,
    markTone: DARK_MARK.has(key) ? "dark" : "light",
    state,
    title: said?.title ?? null,
    lastActivityAt: said?.lastActivityAt ?? null,
  };
}

/**
 * The four walk poses, one per timeline entry. WidgetKit does not run a render
 * loop, so this is the only motion a Home Screen widget can express, and the
 * system decides when it actually redraws.
 */
export const WALK_PHASES = 4;

/**
 * How many entries one write covers.
 *
 * This used to be WALK_PHASES, so a write bought exactly four redraws and the
 * village then froze until the app next came forward. Cycling the four poses
 * over more entries buys the same wall-clock window at a shorter step, which
 * is what makes a change visible between two glances. Every entry carries a
 * full copy of the props, so this is also what the timeline costs in the App
 * Group defaults — do not raise it without measuring that.
 */
export const WALK_ENTRIES = 8;

/** One timeline entry per pose, `stepMs` apart, cycling the poses. */
export function walkTimeline<T extends { walkPhase: number }>(
  props: Omit<T, "walkPhase">,
  stepMs: number,
  from: Date = new Date(),
  count: number = WALK_ENTRIES,
): { date: Date; props: T }[] {
  const entries: { date: Date; props: T }[] = [];
  for (let index = 0; index < count; index += 1) {
    entries.push({
      date: new Date(from.getTime() + index * stepMs),
      props: { ...props, walkPhase: index % WALK_PHASES } as T,
    });
  }
  return entries;
}
