import { afterEach, expect, test } from "bun:test";
import { mount, type Mounted } from "./test-support/render";
import { createSameOriginTransport } from "@omg-dev/client";
import { configureOmgTransport } from "./lib/omg-client";
import { EmbeddedHostOptionsProvider } from "./lib/embedded-host-options";
const { ModelOptionList } = await import("./App");
let ui: Mounted;
afterEach(() => { ui?.cleanup(); configureOmgTransport(createSameOriginTransport()); });
const baseline = { "omg/openai/gpt-6-luna": { inputPricePerMillion: 100_000, outputPricePerMillion: 500_000 } };
const models = ["omg/anthropic/claude-haiku-5.5", "omg/anthropic/claude-opus-5.5"];
function respond(fetch: () => Promise<Response>) {
  configureOmgTransport(createSameOriginTransport({ fetch: fetch as typeof globalThis.fetch }));
}

test("picker shows relative usage levels without changing selection ids", async () => {
  respond(async () => Response.json({ models: { ...baseline,
    [models[0]!]: { inputPricePerMillion: 100_000, outputPricePerMillion: 500_000 },
    [models[1]!]: { inputPricePerMillion: 4_000_000, outputPricePerMillion: 20_000_000 },
  } }));
  ui = mount();
  let selected = "";
  ui.render(<ModelOptionList value={models[0]!} models={models} onChoose={(id) => { selected = id; }} />);
  await ui.flushAsync();
  expect(ui.queryAll("button")[0]!.querySelector("span[aria-label]")).toBeNull();
  expect(ui.query('[aria-label="Uses credits much faster"]')).not.toBeNull();
  expect(ui.text()).not.toContain("$");
  expect(ui.text()).not.toContain("10k");
  ui.flush(() => (ui.queryAll("button")[1] as HTMLButtonElement).click());
  expect(selected).toBe(models[1]!);
});

test("failed pricing keeps model selection usable and shows unavailable estimates", async () => {
  respond(async () => new Response("unavailable", { status: 502 }));
  ui = mount();
  let selected = "";
  ui.render(<ModelOptionList value={models[0]!} models={models} onChoose={(id) => { selected = id; }} />);
  await ui.flushAsync();
  expect(ui.queryAll('[aria-label="Credit usage unavailable"]')).toHaveLength(1);
  expect(ui.query('[aria-label="Low credit usage"]')).toBeNull();
  ui.flush(() => (ui.queryAll("button")[0] as HTMLButtonElement).click());
  expect(selected).toBe(models[0]!);
});

test("connected subscription models do not get managed usage levels", async () => {
  let calls = 0;
  respond(async () => { calls++; return Response.json({ models: { ...baseline,} }); });
  ui = mount();
  ui.render(<ModelOptionList value="opus" models={["opus", "sonnet"]} onChoose={() => {}} />);
  await ui.flushAsync();
  expect(calls).toBe(0);
  expect(ui.query('[aria-label="Credit usage unavailable"]')).toBeNull();
});

test("switching machines clears the previous machine's prices", async () => {
  respond(async () => Response.json({ models: { ...baseline, [models[1]!]: { inputPricePerMillion: 4_000_000, outputPricePerMillion: 20_000_000 } } }));
  ui = mount();
  const component = () => <ModelOptionList value={models[0]!} models={models} onChoose={() => {}} />;
  ui.render(component());
  await ui.flushAsync();
  expect(ui.query('[aria-label="Uses credits much faster"]')).not.toBeNull();
  respond(async () => new Response("unavailable", { status: 502 }));
  ui.render(component());
  expect(ui.query('[aria-label="Uses credits much faster"]')).toBeNull();
  await ui.flushAsync();
  expect(ui.queryAll('[aria-label="Credit usage unavailable"]')).toHaveLength(1);
});

test("usage comparison needs the default model price", async () => {
  respond(async () => Response.json({ models: { [models[0]!]: baseline["omg/openai/gpt-6-luna"] } }));
  ui = mount();
  ui.render(<ModelOptionList value={models[0]!} models={models} onChoose={() => {}} />);
  await ui.flushAsync();
  expect(ui.queryAll('[aria-label="Credit usage unavailable"]')).toHaveLength(1);
});

test("groups models by credit use and selects the first visible filtered result", async () => {
  const medium = "omg/apex";
  const list = [models[1]!, medium, ...Object.keys(baseline), models[0]!, "omg/unknown", "a", "b", "c", "d"];
  respond(async () => Response.json({ models: { ...baseline,
    [medium]: { inputPricePerMillion: 500_000, outputPricePerMillion: 2_500_000 },
    [models[0]!]: baseline["omg/openai/gpt-6-luna"],
    [models[1]!]: { inputPricePerMillion: 4_000_000, outputPricePerMillion: 20_000_000 },
  } }));
  ui = mount();
  let selected = "";
  ui.render(<ModelOptionList value={models[0]!} models={list} onChoose={(id) => { selected = id; }} />);
  await ui.flushAsync();
  const groups = ui.queryAll('[role="group"]');
  expect(groups.map((group) => group.querySelectorAll("button").length)).toEqual([2, 1, 1, 5]);
  expect(groups[0]!.textContent).toContain("GPT-6 Luna");
  expect(groups[1]!.textContent).toContain("Apex");
  expect(groups[2]!.textContent).toContain("Opus");
  ui.flush(() => ui.query("input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(selected).toBe("omg/openai/gpt-6-luna");
});


test("locked model clicks and keyboard selection open upgrade without changing the model", async () => {
  const locked = models[1]!;
  const options = [locked, ...Object.keys(baseline), "a", "b", "c", "d", "e", "f", "g"];
  respond(async () => Response.json({ models: {
    ...baseline, [locked]: { inputPricePerMillion: 4_000_000, outputPricePerMillion: 20_000_000, available: false, minPlan: "pro" },
  } }));
  ui = mount();
  let selected = "";
  const upgrades: string[] = [];
  ui.render(<EmbeddedHostOptionsProvider value={{ defaultAgent: "omg", connectionOnboarding: false,
    onPlanLimit: detail => upgrades.push(detail.action) }}>
    <ModelOptionList value={Object.keys(baseline)[0]!} models={options} onChoose={id => { selected = id; }} />
  </EmbeddedHostOptionsProvider>);
  await ui.flushAsync();
  const row = ui.query('button[aria-disabled="true"]') as HTMLButtonElement;
  expect(row.querySelector('[aria-label="Upgrade required"]')).not.toBeNull();
  ui.flush(() => row.click());
  expect(selected).toBe("");
  expect(upgrades).toEqual(["select-model"]);
  const input = ui.query("input") as HTMLInputElement;
  ui.flush(() => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, "opus");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  ui.flush(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  expect(selected).toBe("");
  expect(upgrades).toEqual(["select-model", "select-model"]);
  ui.flush(() => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!.call(input, "luna");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  ui.flush(() => (ui.query("button") as HTMLButtonElement).click());
  expect(selected).toBe(Object.keys(baseline)[0]!);
});
