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
for (const type of ["ZStack", "VStack", "Image", "Text", "Circle", "Capsule", "Ellipse"]) globals[type] = type;
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
    for (const image of images) {
      expect(image.props.modifiers).toContainEqual({ type: "widgetAccentedRenderingMode", value: "desaturated" });
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
for (const family of ["Small", "Medium", "Large"]) {
  test(`${family} draws mark discs in full colour but never in tinted mode`, () => {
    const environment = { widgetFamily: `system${family}`, colorScheme: "dark" };
    const plated = nodes(render(props, environment));
    expect(plated.filter(node => node.type === "Circle").length).toBeGreaterThan(0);

    const tinted = nodes(render(props, { ...environment, widgetRenderingMode: "accented" }));
    expect(tinted.filter(node => node.type === "Circle")).toHaveLength(0);
    // The marks themselves must survive the disc going away.
    expect(tinted.filter(node => node.type === "Image").length).toBeGreaterThan(1);
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

test("a napping agent breathes but never sleepwalks", () => {
  const moved = travel("idle");
  expect(moved.x).toBe(0);
  expect(moved.y).toBeGreaterThan(0);
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
