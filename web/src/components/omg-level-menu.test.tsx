import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { OMG_LEVEL_MODELS, OMG_MODELS } from "../../../src/omg-models";

const { OmgLevelMenu, showOmgLevelMenu } = await import("./omg-level-menu");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

// The composer shows the level menu only while the omg agent is on a level.
// A person who chose a specific model must keep that choice with no level
// menu that could silently replace it.
test("the level menu shows for a level and hides for a specific model", () => {
  for (const level of OMG_LEVEL_MODELS) expect(showOmgLevelMenu(level, OMG_MODELS)).toBe(true);
  expect(showOmgLevelMenu("omg/anthropic/claude-opus-5.5", OMG_MODELS)).toBe(false);
  // A list without the levels (an older catalog) offers nothing to pick.
  expect(showOmgLevelMenu("omg/omg/auto", ["omg/omg/auto", "omg/apex"])).toBe(false);
});

// Picking a level from the composer must change the model the session starts on.
test("picking a level from the menu chooses that level's model", async () => {
  let chosen: string | null = null;
  ui.render(<OmgLevelMenu value="omg/omg/auto" onChange={(model) => { chosen = model; }} />);
  const trigger = ui.query("button") as HTMLButtonElement;
  expect(trigger.textContent).toBe("Auto");
  await ui.flushAsync(async () => {
    trigger.click();
    await new Promise((r) => setTimeout(r, 50));
  });
  const items = [...document.querySelectorAll("[role='menuitemradio']")] as HTMLElement[];
  expect(items.map((item) => item.textContent)).toEqual(["Auto", "Max", "Balanced", "Fast"]);
  await ui.flushAsync(async () => items[1]!.click());
  expect(chosen).toBe("omg/omg/max");
});
