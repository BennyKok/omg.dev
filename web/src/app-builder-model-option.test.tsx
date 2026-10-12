import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "./test-support/render";
import { OMG_MODELS } from "../../src/omg-models";
import { APP_BUILDER_MODEL } from "../../packages/protocol/src/builder-presets";
const { ModelOptionList, AgentModelPicker } = await import("./App");
let ui: Mounted;
beforeEach(() => { ui = mount(); });
afterEach(() => ui.cleanup());

test("the workflow is a model-list item with its own selection callback", () => {
  let builds = 0; const models: string[] = [];
  ui.render(<ModelOptionList value={APP_BUILDER_MODEL} models={OMG_MODELS}
    builderChoice={{ selected: true, onChoose: () => { builds++; } }} onChoose={m => models.push(m)} />);
  const row = ui.queryAll("button").find(x => x.textContent?.includes("App Builder"))!;
  expect(row.getAttribute("aria-pressed")).toBe("true");
  expect(row.textContent).toContain("Haiku · Apex code review · Luna design review");
  expect(ui.query("select")).toBeNull();
  ui.flush(() => row.click()); expect(builds).toBe(1); expect(models).toEqual([]);
  const haiku = ui.queryAll("button").find(x => x.title.split("\n")[0]?.endsWith(APP_BUILDER_MODEL))!;
  ui.flush(() => haiku.click()); expect(models).toEqual([APP_BUILDER_MODEL]);
});

test("filtering and Enter can choose the workflow without a fake model id", () => {
  let builds = 0;
  ui.render(<ModelOptionList value={OMG_MODELS[0]!} models={OMG_MODELS}
    builderChoice={{ selected: false, onChoose: () => { builds++; } }} onChoose={() => { throw Error("Wrong choice"); }} />);
  const input = ui.query("input") as HTMLInputElement;
  function type(value: string) { ui.flush(() => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, value);
    input.dispatchEvent(new input.ownerDocument.defaultView!.Event("input", { bubbles: true }));
  }); }
  type("app builder"); expect(ui.queryAll("button").length).toBe(1); expect(ui.text()).not.toContain("No matching models");
  ui.flush(() => input.dispatchEvent(new input.ownerDocument.defaultView!.KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(builds).toBe(1);
  type("deepseek"); expect(ui.text()).not.toContain("App Builder");
});

test("the selected workflow names the composer pill", () => {
  ui.render(<AgentModelPicker options={[{ key: "omg", label: "omg agent" }]} agent="omg" agentLabel="omg agent"
    onSelectAgent={() => {}} model={APP_BUILDER_MODEL} models={OMG_MODELS} onModelChange={() => {}}
    builderChoice={{ selected: true, onChoose: () => {} }} />);
  const pill = ui.query("button[aria-label^='Agent omg agent']")!;
  expect(pill.textContent).toContain("App Builder");
  expect(pill.getAttribute("aria-label")).toContain("model App Builder");
});

test("Workflows is last and Enter follows the visible order", () => {
  const chosen: string[] = []; let builds = 0;
  ui.render(<ModelOptionList value={OMG_MODELS[0]!} models={OMG_MODELS}
    builderChoice={{ selected: false, onChoose: () => { builds++; } }} onChoose={m => chosen.push(m)} />);
  const rows = ui.queryAll("button");
  expect(rows.at(-1)?.textContent).toContain("App Builder");
  expect(ui.query('[role="group"][aria-label="Workflows"]')?.contains(rows.at(-1)!)).toBe(true);
  const input = ui.query("input")!;
  ui.flush(() => input.dispatchEvent(new input.ownerDocument.defaultView!.KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(chosen.length).toBe(1); expect(builds).toBe(0);
});

test("the workflow explains the project requirement and cannot run without a project", () => {
  let builds = 0;
  ui.render(<ModelOptionList value={OMG_MODELS[0]!} models={OMG_MODELS}
    builderChoice={{ selected: false, disabled: true, onChoose: () => { builds++; } }} onChoose={() => {}} />);
  const row = ui.queryAll("button").find(x => x.textContent?.includes("App Builder")) as HTMLButtonElement;
  expect(row.disabled).toBe(true); expect(row.textContent).toContain("Choose a project");
  ui.flush(() => row.click()); expect(builds).toBe(0);
});
