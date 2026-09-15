import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { plugin } from "bun";
plugin({ name: "widget-png-fixtures", setup(build) {
  build.onLoad({ filter: /\.png$/ }, () => ({ contents: "module.exports = 1", loader: "js" }));
} });
const { VILLAGE_SCENES } = await import("../src/omg/village-scene");

test("small backgrounds stay within the native widget image budget", () => {
  for (const scheme of ["light", "dark"]) {
    const png = readFileSync(new URL(`../assets/village/notebook-small-${scheme}.png`, import.meta.url));
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    // 3x assets suffice; larger generated images can fail WidgetKit archival.
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(width * height).toBeLessThanOrEqual(510 * 510);
  }
});

// Execute Expo's compiled widget body in isolation, as the extension does.
// This catches missing module-scope constants that a normal TS check cannot.
const require = createRequire(import.meta.url);
const { transformFileSync } = require("@babel/core");
const { code } = transformFileSync(new URL("../src/omg/agent-village-widget.tsx", import.meta.url).pathname, {
  configFile: false,
  babelrc: false,
  presets: [require.resolve("babel-preset-expo")],
  caller: { name: "metro", platform: "ios", isDev: false, isServer: false },
});
let layout = "";
runInNewContext(code, {
  exports: {},
  require: (name: string) => name === "expo-widgets"
    ? { createWidget: (_name: string, compiled: string) => { layout = compiled; } }
    : name.includes("interopRequireDefault") ? { default: (value: unknown) => value } : {},
});
type Node = { type: string; props: Record<string, any> };
/**
 * The third argument is the KEY. React's automatic runtime passes it beside
 * the props rather than inside them, so dropping it made a view's identity
 * invisible to these tests -- and identity is what decides whether SwiftUI
 * treats a new agent as an insertion worth animating or as a change to
 * whoever already stood in that position.
 */
const jsx = (type: string, props: Record<string, any>, key?: string) => ({ type, props, key });
const globals: Record<string, unknown> = { _jsx: jsx, _jsxs: jsx };
for (const type of ["ZStack", "VStack", "Image", "Text", "Circle", "Capsule", "Ellipse", "RoundedRectangle"]) globals[type] = type;
for (const type of ["frame", "offset", "font", "foregroundColor", "containerBackground", "widgetURL", "bold", "clipShape", "resizable", "lineLimit", "widgetAccentedRenderingMode"]) {
  globals[type] = (value: unknown) => ({ type, value });
}
const render = runInNewContext(`(${layout})`, globals);
const props = {
  machineName: "Test Computer", runningCount: 7, blockedCount: 0,
  attentionSessionId: "", updatedAt: 1, walkPhase: 0,
  scenes: Object.fromEntries(Object.entries(VILLAGE_SCENES).map(([key, scene]) => [key, {
    ...scene, backgroundLightUri: `${key}-light`, backgroundDarkUri: `${key}-dark`,
  }])),
  characters: Array.from({ length: 7 }, () => ({
    iconUri: "claude", iconSize: 23, plate: true, markTone: "light", legColor: "#D87656", state: "working",
  })),
};
function nodes(node: any): Node[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== "object") return [];
  return [node, ...nodes(node.props?.children)];
}
for (const [family, capacity] of [["Small", 2], ["Medium", 4], ["Large", 7]] as const) {
  for (const scheme of ["light", "dark"]) test(`${family} ${scheme} renders its own scene and bounded cast`, () => {
    const tree = nodes(render(props, { widgetFamily: `system${family}`, colorScheme: scheme }));
    const images = tree.filter(node => node.type === "Image");
    expect(images[0].props.uiImage).toBe(`${family.toLowerCase()}-${scheme}`);
    expect(images).toHaveLength(capacity + 1);
    expect(images[1].props.modifiers).toContainEqual({ type: "frame", value: { width: 23, height: 23 } });
    expect(tree.find(node => node.type === "Circle")?.props.modifiers).toContainEqual({ type: "frame", value: { width: 38, height: 38 } });
    expect(images.every(node => node.props.modifiers.some((modifier: any) => modifier.type === "resizable"))).toBe(true);
  });
}
test("waiting state has a singular caption and opens its session", () => {
  const tree = nodes(render({ ...props, blockedCount: 1, attentionSessionId: "waiting-id" }, { widgetFamily: "systemMedium" }));
  expect(tree.find(node => node.type === "Text")?.props.children).toBe("1 needs you");
  expect(tree[0].props.modifiers).toContainEqual({ type: "widgetURL", value: "omg:///session/waiting-id" });
});
test("empty fleet renders without a character or an invalid scene access", () => {
  const tree = nodes(render({ ...props, characters: [], runningCount: 0 }, { widgetFamily: "systemSmall" }));
  expect(tree.filter(node => node.type === "Image")).toHaveLength(1);
  expect(tree.filter(node => node.type === "Text").map(node => node.props.children)).toContain("No active agents");
});
test("gallery before the first app launch has a usable placeholder", () => {
  const tree = nodes(render({}, { widgetFamily: "systemSmall" }));
  expect(tree[0].props.children).toBe("Open omg.dev to start your garden");
});

for (const family of ["Small", "Medium", "Large"]) {
  for (const scheme of ["light", "dark"]) test(`${family} tinted ${scheme} preserves image detail and readable ink`, () => {
    const tree = nodes(render(props, { widgetFamily: `system${family}`, colorScheme: scheme, widgetRenderingMode: "accented" }));
    const images = tree.filter(node => node.type === "Image");
    expect(images[0].props.uiImage).toBe(`${family.toLowerCase()}-dark`);
    // The garden is always desaturated so it keeps its detail under the tint.
    expect(images[0].props.modifiers).toContainEqual({ type: "widgetAccentedRenderingMode", value: "desaturated" });
    // Marks opt out of the tint only when they sit on a disc, which would
    // otherwise swallow them; see the disc test below.
    for (const image of images.slice(1)) {
      const mode = image.props.modifiers.find((modifier: any) => modifier.type === "widgetAccentedRenderingMode");
      expect(["desaturated", "fullColor"]).toContain(mode.value);
    }
    const summary = tree.find(node => node.type === "Text" && node.props.children === "7 working");
    expect(summary?.props.modifiers).toContainEqual({ type: "foregroundColor", value: "#F2F0EA" });
  });
}

/**
 * A disc under a mark is a full-colour affordance. In tinted mode iOS renders
 * from the alpha of the content, so the disc and the mark merge into one flat
 * puck and the mark stops existing — which is what shipped, and what a device
 * screenshot caught.
 */
/**
 * A bare glyph like Claude keeps its disc everywhere, because without one it
 * reads as a different species from the marks that ship their own. In tinted
 * mode that disc would swallow it -- iOS renders from alpha -- so the mark is
 * drawn `fullColor` to stay on top of it. A mark that needs no disc does not
 * get one when tinted, which is what made them visible in the first place.
 */
for (const family of ["Small", "Medium", "Large"]) {
  const environment = { widgetFamily: `system${family}`, colorScheme: "dark" };
  const cast = (plate: boolean, markTone: string) => [{
    iconUri: "i", iconSize: 34, plate, markTone, legColor: "#000", state: "working",
  }];

  test(`${family} keeps a bare glyph's disc when tinted, and lets the glyph out of the tint`, () => {
    const tree = nodes(render({ ...props, characters: cast(true, "light") }, { ...environment, widgetRenderingMode: "accented" }));
    expect(tree.filter(node => node.type === "Circle").length).toBeGreaterThan(0);
    const mark = tree.filter(node => node.type === "Image")[1];
    expect(mark.props.modifiers).toContainEqual({ type: "widgetAccentedRenderingMode", value: "fullColor" });
  });

  test(`${family} gives a self-contained mark no disc when tinted`, () => {
    const tree = nodes(render({ ...props, characters: cast(false, "dark") }, { ...environment, widgetRenderingMode: "accented" }));
    expect(tree.filter(node => node.type === "Circle")).toHaveLength(0);
    const mark = tree.filter(node => node.type === "Image")[1];
    expect(mark.props.modifiers).toContainEqual({ type: "widgetAccentedRenderingMode", value: "desaturated" });
  });

  test(`${family} still discs a dark mark on the nocturnal scene in full colour`, () => {
    const tree = nodes(render({ ...props, characters: cast(false, "dark") }, environment));
    expect(tree.filter(node => node.type === "Circle").length).toBeGreaterThan(0);
  });
}

/**
 * The authored scene size matches exactly one device. Anywhere the real widget
 * is larger, art drawn at the authored size leaves `containerBackground`
 * showing as a border, so the art is deliberately drawn oversized and clipped.
 */
for (const [family, key] of [["Small", "small"], ["Medium", "medium"], ["Large", "large"]] as const) {
  for (const mode of [undefined, "accented"] as const) {
    test(`${family} background over-bleeds the authored scene${mode ? " when tinted" : ""}`, () => {
      const scene = VILLAGE_SCENES[key];
      const tree = nodes(render(props, { widgetFamily: `system${family}`, colorScheme: "dark", widgetRenderingMode: mode }));
      const background = tree.filter(node => node.type === "Image")[0];
      const sized = background.props.modifiers.find((modifier: any) => modifier.type === "frame");
      expect(sized.value.width).toBeGreaterThan(scene.width);
      expect(sized.value.height).toBeGreaterThan(scene.height);
      // Uniform, so the garden is never stretched out of shape.
      expect(sized.value.width / scene.width).toBeCloseTo(sized.value.height / scene.height, 6);
    });
  }
}

/**
 * A widget cannot animate, so the only motion anyone perceives is the
 * difference between two glances. That difference used to be 10pt on a 364pt
 * widget, which is why the walk was reported as not happening at all. Pin the
 * travel so it cannot quietly shrink back.
 */
function travel(state: string, family = "Medium", index = 0) {
  const seats = Array.from({ length: index + 1 }, () => ({
    iconUri: "i", iconSize: 34, plate: false, markTone: "light", legColor: "#000", state,
  }));
  const seen: { x: number; y: number }[] = [];
  for (const walkPhase of [0, 1, 2, 3]) {
    const tree = nodes(render({ ...props, walkPhase, characters: seats }, { widgetFamily: `system${family}` }));
    const mark = tree.filter(node => node.type === "Image")[index + 1];
    seen.push(mark.props.modifiers.find((modifier: any) => modifier.type === "offset").value);
  }
  const xs = seen.map(p => p.x), ys = seen.map(p => p.y);
  return { x: Math.max(...xs) - Math.min(...xs), y: Math.max(...ys) - Math.min(...ys) };
}

test("a working agent covers ground a glance apart can tell", () => {
  expect(travel("working").x).toBeGreaterThanOrEqual(40);
});

/**
 * Nappers used to be pinned. "All finished" is the state the widget is in most
 * of the time, so that made the walk unreachable in practice, and Benny asked
 * to see the village move. They amble at half pace now, still slower than a
 * working agent so the states stay tellable apart.
 */
test("a napping agent ambles, at half a working agent's pace", () => {
  const napping = travel("idle");
  const working = travel("working");
  expect(napping.x).toBeGreaterThan(0);
  expect(napping.x).toBeLessThan(working.x);
  expect(napping.y).toBeGreaterThan(0);
});

test("walkers never have the room to collide or leave the scene", () => {
  const scene = VILLAGE_SCENES.medium;
  const seats = scene.slots.map(() => ({
    iconUri: "i", iconSize: 34, plate: false, markTone: "light", legColor: "#000", state: "working",
  }));
  for (const walkPhase of [0, 1, 2, 3]) {
    const tree = nodes(render({ ...props, walkPhase, characters: seats }, { widgetFamily: "systemMedium" }));
    const marks = tree.filter(node => node.type === "Image").slice(1)
      .map(node => node.props.modifiers.find((modifier: any) => modifier.type === "offset").value);
    // Centres stay a mark apart, measured the way they are seen. Two slots can
    // sit close in x and still never overlap when they differ in y.
    for (let i = 0; i < marks.length; i += 1) {
      for (let j = i + 1; j < marks.length; j += 1) {
        expect(Math.hypot(marks[i].x - marks[j].x, marks[i].y - marks[j].y)).toBeGreaterThanOrEqual(34);
      }
    }
    for (const mark of marks) expect(Math.abs(mark.x)).toBeLessThanOrEqual(scene.width / 2 - 17);
  }
});

/**
 * The speech bubble. One, over the lead, because the bridge already sorts the
 * cast by who matters and a bubble per agent overlaps on medium.
 */
const talking = (extra: Record<string, unknown>, environment: Record<string, unknown> = {}) => nodes(render({
  ...props,
  characters: [{
    iconUri: "i", iconSize: 34, plate: false, markTone: "light", legColor: "#000",
    state: "working", ...extra,
  }, ...props.characters],
}, { widgetFamily: "systemMedium", ...environment }));

test("the lead's title appears in the bubble", () => {
  const tree = talking({ title: "Fix the widget border", lastActivityAt: 1000 - 5 * 60_000 }, { date: 1000 });
  expect(tree.filter(node => node.type === "Text").map(node => node.props.children))
    .toContain("Fix the widget border");
});

/**
 * WidgetKit renders timer Text itself, outside the timeline: it ticks every
 * second and costs no reload budget. Everything else on this widget can only
 * change when an entry is rendered, which iOS grants sparingly -- so without
 * this the widget had nothing on it that moved, and a twelve minute old frame
 * looked exactly like a fresh one.
 */
test("a running lead carries a live clock, not a number frozen at render time", () => {
  const started = 1000 - 5 * 60_000;
  const timer = talking({ title: "t", lastActivityAt: started, state: "working" }, { date: 1000 })
    .find(node => node.type === "Text" && node.props.timerInterval);
  expect(timer).toBeDefined();
  expect(timer.props.countsDown).toBe(false);
  expect(new Date(timer.props.timerInterval.lower).getTime()).toBe(started);
  // Counting up: only the lower bound is read, and a run has no known end.
  expect(new Date(timer.props.timerInterval.upper).getTime()).toBeGreaterThan(started + 300 * 24 * 3600 * 1000);
});

/**
 * A counter climbing beside a session that has stopped says the wrong thing,
 * so anything not running keeps the rounded string -- and that string is dated
 * from the ENTRY being rendered, not from when the frame was written, because
 * one write covers twelve minutes.
 */
test("a lead that is not running keeps a rounded age, dated from its entry", () => {
  const at = (date: number) => talking({ title: "t", lastActivityAt: 0, state: "idle" }, { date })
    .filter(node => node.type === "Text").map(node => node.props.children);
  expect(at(60_000)).toContain("1m");
  expect(at(12 * 60_000)).toContain("12m");
  expect(talking({ title: "t", lastActivityAt: 0, state: "idle" }, { date: 60_000 })
    .find(node => node.type === "Text" && node.props.timerInterval)).toBeUndefined();
});

test("a session with no title gets no bubble at all", () => {
  const withTitle = talking({ title: "Something" }).filter(node => node.type === "Text").length;
  for (const empty of [null, undefined, "", "   "]) {
    expect(talking({ title: empty }).filter(node => node.type === "Text").length).toBeLessThan(withTitle);
  }
});

test("small has no room for a bubble and does not draw one", () => {
  const tree = talking({ title: "Fix the widget border" }, { widgetFamily: "systemSmall" });
  expect(tree.filter(node => node.type === "Text").map(node => node.props.children))
    .not.toContain("Fix the widget border");
});

test("the bubble stays inside the scene on every family", () => {
  for (const [family, key] of [["Medium", "medium"], ["Large", "large"]] as const) {
    const scene = VILLAGE_SCENES[key];
    const tree = talking({ title: "A very long session title that would overflow" }, { widgetFamily: `system${family}` });
    const box = tree.find(node => node.type === "RoundedRectangle");
    const sized = box.props.modifiers.find((modifier: any) => modifier.type === "frame").value.width;
    const at = box.props.modifiers.find((modifier: any) => modifier.type === "offset").value;
    expect(Math.abs(at.x) + sized / 2).toBeLessThanOrEqual(scene.width / 2);
    expect(Math.abs(at.y)).toBeLessThanOrEqual(scene.height / 2);
  }
});

/**
 * The first simulator render printed the title directly under the summary,
 * like a subtitle, because the bubble's floor was derived from the mark alone
 * and the caption sits above every mark. They must not share vertical space.
 */
test("the bubble never overlaps the caption", () => {
  for (const family of ["Medium", "Large"]) {
    const tree = talking({ title: "Fix the widget border", lastActivityAt: 0 }, { widgetFamily: `system${family}`, date: 60_000 });
    const box = tree.find(node => node.type === "RoundedRectangle");
    const boxAt = box.props.modifiers.find((m: any) => m.type === "offset").value.y;
    const boxTop = boxAt - box.props.modifiers.find((m: any) => m.type === "frame").value.height / 2;

    const summary = tree.find(node => node.type === "Text" && node.props.children === "7 working");
    // The caption's VStack carries the placement; the Text is inside it.
    const caption = tree.find(node => node.type === "VStack"
      && nodes(node.props.children).some((child: any) => child === summary));
    const capAt = caption.props.modifiers.find((m: any) => m.type === "offset").value.y;
    expect(boxTop).toBeGreaterThan(capAt);
  }
});

test("a bubble with no time is shorter than one with a time", () => {
  const height = (extra: Record<string, unknown>) => {
    const tree = talking({ title: "t", ...extra }, { date: 60_000 });
    return tree.find(node => node.type === "RoundedRectangle")
      .props.modifiers.find((m: any) => m.type === "frame").value.height;
  };
  expect(height({ lastActivityAt: 0 })).toBeGreaterThan(height({ lastActivityAt: null }));
});

/**
 * A filled bubble is the mark-disc trap again: tinted widgets render from
 * alpha, so an opaque body and the text inside it both come out solid white.
 * The simulator drew an empty white slab. Tinted goes without the paper.
 */
test("tinted draws the words but never a filled bubble body", () => {
  const tinted = talking({ title: "Fix the widget border", lastActivityAt: 0 },
    { date: 60_000, widgetRenderingMode: "accented" });
  expect(tinted.filter(node => node.type === "RoundedRectangle")).toHaveLength(0);
  expect(tinted.filter(node => node.type === "Text").map(node => node.props.children))
    .toContain("Fix the widget border");

  const full = talking({ title: "Fix the widget border", lastActivityAt: 0 }, { date: 60_000 });
  expect(full.filter(node => node.type === "RoundedRectangle").length).toBe(1);
});

/**
 * The bubble belongs to a character, so it must never sit on top of one.
 * The first simulator render covered Claude completely.
 */
test("the bubble never covers the agent it belongs to", () => {
  for (const [family, key] of [["Medium", "medium"], ["Large", "large"]] as const) {
    const scene = VILLAGE_SCENES[key];
    const tree = talking({ title: "Fix the widget border", lastActivityAt: 0 },
      { widgetFamily: `system${family}`, date: 60_000 });
    const box = tree.find(node => node.type === "RoundedRectangle");
    const at = box.props.modifiers.find((m: any) => m.type === "offset").value;
    const size = box.props.modifiers.find((m: any) => m.type === "frame").value;
    // EVERY villager, not just the lead. The first simulator render cleared
    // the speaker and went straight through two of its neighbours.
    for (const mark of tree.filter(node => node.type === "Image").slice(1)) {
      const markAt = mark.props.modifiers.find((m: any) => m.type === "offset").value;
      const markSize = mark.props.modifiers.find((m: any) => m.type === "frame").value;
      const apart = Math.abs(at.x - markAt.x) >= (size.width + markSize.width) / 2
        || Math.abs(at.y - markAt.y) >= (size.height + markSize.height) / 2;
      expect(apart).toBe(true);
    }
    // And still inside the scene.
    expect(Math.abs(at.x) + size.width / 2).toBeLessThanOrEqual(scene.width / 2);
    expect(Math.abs(at.y) + size.height / 2).toBeLessThanOrEqual(scene.height / 2);
  }
});

/**
 * The bubble was clamped into the scene but its tail dots were not, so on a
 * large widget -- whose lead stands at x=80 under a 196pt bubble -- one dot
 * landed on the boundary and the next at x=-6, off the widget entirely. One
 * clipped dot and one missing, caught on a device.
 */
for (const [family, key] of [["Medium", "medium"], ["Large", "large"]] as const) {
  test(`${family} keeps every disc and speech tail inside the scene`, () => {
    const scene = VILLAGE_SCENES[key];
    const tree = talking({ title: "ios app", lastActivityAt: 0 },
      { widgetFamily: `system${family}`, date: 60_000 });
    for (const dot of tree.filter(node => node.type === "Circle")) {
      const at = dot.props.modifiers.find((m: any) => m.type === "offset").value;
      const size = dot.props.modifiers.find((m: any) => m.type === "frame").value.width;
      // Offsets are from the centre of the scene.
      expect(at.x - size / 2).toBeGreaterThanOrEqual(-scene.width / 2);
      expect(at.x + size / 2).toBeLessThanOrEqual(scene.width / 2);
    }
  });
}

/**
 * A widget has no animation loop, so "idle animation" can only mean a pose
 * that differs per timeline entry. A napper gets two: the body rises and
 * settles, and its "z" drifts up and away before starting over.
 */
test("a napping agent's sleep marker drifts up and away across the cycle", () => {
  const seat = [{ iconUri: "i", iconSize: 34, plate: false, markTone: "light", legColor: "#000", state: "idle" }];
  const zs = [0, 1, 2, 3].map((walkPhase) => {
    const tree = nodes(render({ ...props, walkPhase, characters: seat }, { widgetFamily: "systemMedium" }));
    const z = tree.find(node => node.type === "Text" && node.props.children === "z");
    // RELATIVE to the sleeper, who is ambling underneath it. Measured against
    // the scene the drift would fight the body's own movement and read as
    // jitter, which is not what is being asserted.
    const mark = tree.filter(node => node.type === "Image")[1];
    const at = z.props.modifiers.find((m: any) => m.type === "offset").value;
    const body = mark.props.modifiers.find((m: any) => m.type === "offset").value;
    return {
      x: at.x - body.x,
      y: at.y - body.y,
      size: z.props.modifiers.find((m: any) => m.type === "font").value.size,
    };
  });
  // Rises, drifts aside and shrinks, monotonically, so it reads as drifting
  // away rather than jittering in place.
  for (let i = 1; i < zs.length; i += 1) {
    expect(zs[i].y).toBeLessThan(zs[i - 1].y);
    expect(zs[i].x).toBeGreaterThan(zs[i - 1].x);
    expect(zs[i].size).toBeLessThan(zs[i - 1].size);
  }
});

test("a napper's breath is deep enough to notice between two glances", () => {
  expect(travel("idle").y).toBeGreaterThanOrEqual(5);
});

/**
 * One bubble per agent. A single bubble over the top-ranked session read as
 * arbitrary once two agents were on screen: you could see who was working and
 * only hear from one of them.
 */
const chorus = (titles: (string | null)[], environment: Record<string, unknown> = {}) => nodes(render({
  ...props,
  characters: titles.map((title, i) => ({
    iconUri: "i", iconSize: 34, plate: false, markTone: "light", legColor: "#000",
    state: "working", title, lastActivityAt: i * 1000,
  })),
}, { widgetFamily: "systemMedium", date: 10_000, ...environment }));

const boxesOf = (tree: any[]) => tree.filter(node => node.type === "RoundedRectangle").map(node => ({
  at: node.props.modifiers.find((m: any) => m.type === "offset").value,
  size: node.props.modifiers.find((m: any) => m.type === "frame").value,
}));

test("every agent with a title gets its own bubble", () => {
  const tree = chorus(["first task", "second task"]);
  const said = tree.filter(node => node.type === "Text").map(node => node.props.children);
  expect(said).toContain("first task");
  expect(said).toContain("second task");
  expect(boxesOf(tree)).toHaveLength(2);
});

test("an agent with no title stays silent while its neighbours speak", () => {
  const tree = chorus(["first task", null, "third task"]);
  expect(boxesOf(tree)).toHaveLength(2);
  expect(tree.filter(node => node.type === "Text").map(node => node.props.children)).toContain("third task");
});

test("bubbles never overlap each other, whatever the cast", () => {
  for (const family of ["Medium", "Large"]) {
    const boxes = boxesOf(chorus(
      ["one", "two", "three", "four"].map(t => `session ${t}`),
      { widgetFamily: `system${family}` },
    ));
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const apart = Math.abs(boxes[i].at.x - boxes[j].at.x) >= (boxes[i].size.width + boxes[j].size.width) / 2
          || Math.abs(boxes[i].at.y - boxes[j].at.y) >= (boxes[i].size.height + boxes[j].size.height) / 2;
        expect(apart).toBe(true);
      }
    }
  }
});

test("bubbles never cover a villager, however many are talking", () => {
  const tree = chorus(["one", "two", "three", "four"].map(t => `session ${t}`));
  const marks = tree.filter(node => node.type === "Image").slice(1).map(node => ({
    at: node.props.modifiers.find((m: any) => m.type === "offset").value,
    size: node.props.modifiers.find((m: any) => m.type === "frame").value,
  }));
  for (const box of boxesOf(tree)) {
    for (const mark of marks) {
      const apart = Math.abs(box.at.x - mark.at.x) >= (box.size.width + mark.size.width) / 2
        || Math.abs(box.at.y - mark.at.y) >= (box.size.height + mark.size.height) / 2;
      expect(apart).toBe(true);
    }
  }
});

test("a crowded village quietens the ones it cannot seat, rather than stacking them", () => {
  // Every slot taken and every one talking: some must go without a bubble.
  const tree = chorus(Array.from({ length: 4 }, (_, i) => `a much longer session title number ${i}`));
  expect(boxesOf(tree).length).toBeLessThanOrEqual(4);
  expect(boxesOf(tree).length).toBeGreaterThan(0);
});

/**
 * A bubble is as wide as what it says. Every bubble was one fixed width, so a
 * one word title got the same slab as a sentence and the village read as a
 * form rather than a conversation.
 */
test("a short title gets a narrower bubble than a long one", () => {
  const widthOf = (title: string) => boxesOf(chorus([title]))[0].size.width;
  expect(widthOf("Napping")).toBeLessThan(widthOf("Fix the border"));
  expect(widthOf("Fix the border")).toBeLessThan(widthOf("Fix the widget border"));
  // There is a FLOOR and a CAP, and neither is arbitrary. The bubble also
  // holds a time line, so a one-word title cannot shrink below what "6:04"
  // needs; and it cannot grow past the scene. Two titles on the same bound are
  // legitimately the same width -- the words truncate, the bubble does not.
  expect(widthOf("a")).toBe(widthOf("ab"));
  expect(widthOf("a")).toBeLessThan(widthOf("Napping"));
  expect(widthOf("a session title long enough to reach the cap"))
    .toBe(widthOf("a session title very much longer still, well past it"));
});

test("a bubble never gets wider than the scene allows, however long the title", () => {
  const scene = VILLAGE_SCENES.medium;
  const box = boxesOf(chorus(["an extremely long session title that would run off the widget entirely"]))[0];
  expect(box.size.width).toBeLessThanOrEqual(scene.width - 56);
  expect(Math.abs(box.at.x) + box.size.width / 2).toBeLessThanOrEqual(scene.width / 2);
});

/**
 * The collision boxes were built from the raw slot while the villagers walk
 * away from it, so a bubble could clear the slot and land on the agent
 * standing beside it. Checked in every phase, because that is when it differs.
 */
test("no bubble lands on a villager in any walk phase", () => {
  for (const walkPhase of [0, 1, 2, 3]) {
    const tree = nodes(render({
      ...props, walkPhase,
      characters: ["one", "two", "three", "four"].map((t, i) => ({
        iconUri: "i", iconSize: 34, plate: i % 2 === 0, markTone: "light", legColor: "#000",
        state: "working", title: `session ${t}`, lastActivityAt: 0,
      })),
    }, { widgetFamily: "systemMedium", date: 10_000 }));
    const marks = tree.filter(node => node.type === "Image").slice(1).map(node => ({
      at: node.props.modifiers.find((m: any) => m.type === "offset").value,
      size: node.props.modifiers.find((m: any) => m.type === "frame").value,
    }));
    for (const box of boxesOf(tree)) {
      for (const mark of marks) {
        const apart = Math.abs(box.at.x - mark.at.x) >= (box.size.width + mark.size.width) / 2
          || Math.abs(box.at.y - mark.at.y) >= (box.size.height + mark.size.height) / 2;
        expect(apart).toBe(true);
      }
    }
  }
});

/**
 * A new agent is an INSERTION, which is what `.transition` animates. Two
 * things have to hold or it does nothing:
 *
 *  - the modifier has to be on the villager, and it is a plain record because
 *    the compiled layout cannot reach module scope for a helper;
 *  - the villager has to be keyed by its SESSION, so SwiftUI sees an arrival
 *    rather than a change to whoever already stood in that index.
 */
test("each villager carries a transition and is keyed by its session", () => {
  const cast = [
    { id: "s-one", iconUri: "i", iconSize: 34, plate: false, markTone: "light", legColor: "#000", state: "working" },
    { id: "s-two", iconUri: "i", iconSize: 34, plate: false, markTone: "light", legColor: "#000", state: "working" },
  ];
  const tree = nodes(render({ ...props, characters: cast }, { widgetFamily: "systemMedium" }));
  const villagers = tree.filter(node => node.type === "ZStack"
    && node.props.modifiers?.some((m: any) => m.$type === "transition"));
  expect(villagers).toHaveLength(2);
  for (const villager of villagers) {
    expect(villager.props.modifiers.find((m: any) => m.$type === "transition").kind).toBe("scale");
  }
  expect(villagers.map(v => v.key)).toEqual(["s-one", "s-two"]);
});

test("a villager with no session id still renders, keyed by position", () => {
  const cast = [{ iconUri: "i", iconSize: 34, plate: false, markTone: "light", legColor: "#000", state: "working" }];
  const tree = nodes(render({ ...props, characters: cast }, { widgetFamily: "systemMedium" }));
  expect(tree.filter(node => node.type === "ZStack"
    && node.props.modifiers?.some((m: any) => m.$type === "transition"))).toHaveLength(1);
});

/**
 * The tail has to point at the agent it belongs to, whichever side the
 * placement scan put the bubble on. It used to be chosen by comparing x alone,
 * so it always went sideways -- and the scan prefers ABOVE the agent, which
 * meant the common case was dots trailing off to one side of a bubble sitting
 * directly over its speaker, aimed at nothing.
 */
test("the tail points from the bubble towards its own agent", () => {
  for (const family of ["Medium", "Large"]) {
    const tree = nodes(render({
      ...props,
      characters: [{
        iconUri: "i", iconSize: 34, plate: false, markTone: "light", legColor: "#000",
        state: "working", title: "ios app", lastActivityAt: 0,
      }],
    }, { widgetFamily: `system${family}`, date: 10_000 }));

    const box = tree.find(node => node.type === "RoundedRectangle");
    const at = box.props.modifiers.find((m: any) => m.type === "offset").value;
    const mark = tree.filter(node => node.type === "Image")[1];
    const markAt = mark.props.modifiers.find((m: any) => m.type === "offset").value;
    const dots = tree.filter(node => node.type === "Circle")
      .map(node => node.props.modifiers.find((m: any) => m.type === "offset").value);
    expect(dots.length).toBeGreaterThan(0);

    const span = Math.hypot(markAt.x - at.x, markAt.y - at.y);
    for (const dot of dots) {
      // Each dot is nearer the agent than the bubble's centre is.
      expect(Math.hypot(markAt.x - dot.x, markAt.y - dot.y)).toBeLessThan(span);
      // And it lies along the line between them, not off to one side.
      const cross = Math.abs((markAt.x - at.x) * (dot.y - at.y) - (markAt.y - at.y) * (dot.x - at.x)) / (span || 1);
      expect(cross).toBeLessThan(1.5);
    }
  }
});

test("dots further along the tail sit closer to the agent", () => {
  const tree = nodes(render({
    ...props,
    characters: [{
      iconUri: "i", iconSize: 34, plate: false, markTone: "light", legColor: "#000",
      state: "working", title: "ios app", lastActivityAt: 0,
    }],
  }, { widgetFamily: "systemMedium", date: 10_000 }));
  const mark = tree.filter(node => node.type === "Image")[1];
  const markAt = mark.props.modifiers.find((m: any) => m.type === "offset").value;
  const dots = tree.filter(node => node.type === "Circle").map(node => ({
    at: node.props.modifiers.find((m: any) => m.type === "offset").value,
    size: node.props.modifiers.find((m: any) => m.type === "frame").value.width,
  })).sort((a, b) => b.size - a.size);
  const near = (d: typeof dots[number]) => Math.hypot(markAt.x - d.at.x, markAt.y - d.at.y);
  // The small dot trails the big one, so the tail tapers towards the speaker.
  expect(near(dots[1])).toBeLessThan(near(dots[0]));
});
