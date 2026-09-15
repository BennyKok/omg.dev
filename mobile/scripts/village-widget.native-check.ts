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
const jsx = (type: string, props: Record<string, any>) => ({ type, props });
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
