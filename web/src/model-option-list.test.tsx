import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "./test-support/render";
import { useState } from "react";
import { OMG_LEVEL_MODELS, OMG_MODELS } from "../../src/omg-models";
import { createSameOriginTransport } from "@omg-dev/client";
import { configureOmgTransport } from "./lib/omg-client";

const { ModelOptionList } = await import("./App");

function openAllModels(ui: Mounted) {
  const more = ui.queryAll("button").find((row) => row.textContent === "All models") as HTMLButtonElement;
  ui.flush(() => more.click());
}

// A hosted person sees Auto and three levels, so they do not have to choose
// among 14 models. The full list must stay one tap away, and a person who
// already chose a specific model must see that choice without the tap.
test("hosted picker leads with Auto and the levels, the full list one tap away", async () => {
  const ui = mount();
  try {
    let chosen: string | null = null;
    ui.render(<ModelOptionList value={OMG_MODELS[0]!} models={OMG_MODELS} onChoose={(m) => { chosen = m; }} />);
    const labels = () => ui.queryAll("button").map((row) => row.textContent);
    // Rows are placeholders until the credit prices settle (or their wait ends).
    for (let i = 0; i < 50 && labels().length < 5; i++) await ui.flushAsync(() => new Promise((r) => setTimeout(r, 50)));
    expect(labels()).toEqual(["Auto", "Max", "Balanced", "Fast", "All models"]);
    const balanced = ui.queryAll("button").find((row) => row.textContent === "Balanced") as HTMLButtonElement;
    ui.flush(() => balanced.click());
    expect(chosen).toBe("omg/omg/balanced");
    openAllModels(ui);
    // Everything except the build model, which nobody picks.
    expect(labels().length).toBe(OMG_MODELS.length - 1);
  } finally {
    ui.cleanup();
  }
  const pinned = mount();
  try {
    pinned.render(<ModelOptionList value="omg/anthropic/claude-opus-5.5" models={OMG_MODELS} onChoose={() => {}} />);
    expect(pinned.queryAll("button").map((row) => row.textContent)).toContain("Claude Opus 5.5");
  } finally {
    pinned.cleanup();
  }
});

// The hosted omg picker used to list raw router ids
// ("omg/deepseek/deepseek-v4-flash-0731"), which truncated on a phone-width
// popover. Each row now shows the lab's mark and the short model name, while
// the router id stays the value that is chosen and the text the filter matches.
describe("ModelOptionList", () => {
  let ui: Mounted;
  beforeEach(() => {
    ui = mount();
  });
  afterEach(() => ui.cleanup());

  test("omg rows show the short name and the provider mark, and choose the id", () => {
    let chosen: string | null = null;
    ui.render(
      <ModelOptionList value={OMG_MODELS[0]!} models={OMG_MODELS} onChoose={(m) => { chosen = m; }} />,
    );
    openAllModels(ui);
    const text = ui.text();
    expect(text).toContain("DeepSeek V4 Flash");
    expect(text).toContain("GLM 5.3 Flash");
    expect(text).toContain("GPT-6.1 Sol");
    expect(text).not.toContain("omg/deepseek/deepseek-v4-flash-0731");
    const rows = ui.queryAll("button");
    // The build model is not offered.
    expect(rows.length).toBe(OMG_MODELS.length - 1);
    expect(rows.some((row) => row.title.includes("omg/omg/build"))).toBe(false);
    // Auto and the levels are omg's own choices and carry no lab mark.
    expect(ui.queryAll("button svg[role='img'], button img").length).toBe(OMG_MODELS.length - OMG_LEVEL_MODELS.length - 1);
    const apex = rows.find((row) => row.textContent?.includes("Apex")) as HTMLButtonElement;
    expect(apex.title.split("\n")[0]).toBe("Callstack · omg/apex");
    ui.flush(() => apex.click());
    expect(chosen).toBe("omg/apex");
    const glm = rows.find((row) => row.textContent === "GLM 5.3") as HTMLButtonElement;
    expect(glm.title.split("\n")[0]).toBe("Z.ai · omg/z-ai/glm-5.3");
    ui.flush(() => glm.click());
    expect(chosen).toBe("omg/z-ai/glm-5.3");
  });

  test("the filter matches the short name and the router id", () => {
    ui.render(<ModelOptionList value={OMG_MODELS[0]!} models={OMG_MODELS} onChoose={() => {}} />);
    const input = ui.query("input") as HTMLInputElement;
    expect(input).not.toBeNull();
    const type = (value: string) =>
      ui.flush(() => {
        // React tracks the last value it set; the prototype setter bypasses
        // that so the "input" event reads as a real change.
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!;
        setter.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    type("deepseek v4");
    expect(ui.queryAll("button").length).toBe(2);
    type("z-ai");
    expect(ui.queryAll("button").length).toBe(2);
    expect(ui.text()).toContain("GLM 5.3");
    type("nothing-here");
    expect(ui.text()).toContain("No matching models");
  });

  test("Codex ids show their display name, without a mark", () => {
    ui.render(<ModelOptionList value="gpt-5.6" models={["gpt-5.6", "gpt-5.6-mini"]} onChoose={() => {}} />);
    expect(ui.text()).toContain("GPT-5.6 Mini");
    expect(ui.text()).not.toContain("gpt-5.6-mini");
    expect(ui.queryAll("button svg[role='img']").length).toBe(0);
    expect(ui.query("input")).toBeNull();
  });
});

// The composer pill: a hosted omg model wears the lab's mark with a small omg
// mark in the corner; any other agent keeps its own mark alone.
describe("AgentModelPicker pill", () => {
  let ui: Mounted;
  beforeEach(() => {
    ui = mount();
  });
  afterEach(() => ui.cleanup());

  const options = [
    { key: "omg" as const, label: "omg agent" },
    { key: "aisdk" as const, label: "Claude" },
  ];

  test("an omg model shows the provider mark plus the omg badge", async () => {
    const { AgentModelPicker } = await import("./App");
    ui.render(
      <AgentModelPicker
        options={options}
        agent="omg"
        agentLabel="omg agent"
        onSelectAgent={() => {}}
        model="omg/z-ai/glm-5.3"
        models={OMG_MODELS}
        onModelChange={() => {}}
      />,
    );
    const pill = ui.query("button[aria-label^='Agent omg agent']") as HTMLButtonElement;
    expect(pill).not.toBeNull();
    expect(pill.textContent).toContain("GLM 5.3");
    expect(pill.querySelectorAll("svg[role='img']").length).toBe(1);
    expect(pill.querySelector("img[data-testid='omg-model-badge']")).not.toBeNull();
  });

  test("another agent keeps its own mark and no badge", async () => {
    const { AgentModelPicker } = await import("./App");
    ui.render(
      <AgentModelPicker
        options={options}
        agent="aisdk"
        agentLabel="Claude"
        onSelectAgent={() => {}}
        model="opus"
        models={["opus", "sonnet"]}
        onModelChange={() => {}}
      />,
    );
    const pill = ui.query("button[aria-label^='Agent Claude']") as HTMLButtonElement;
    expect(pill.querySelectorAll("svg[role='img']").length).toBe(0);
    expect(pill.querySelector("img[data-testid='omg-model-badge']")).toBeNull();
    expect(pill.querySelectorAll("img").length).toBe(1);
  });

  test("an OpenCode pill wears the lab mark with the OpenCode badge", async () => {
    const { AgentModelPicker } = await import("./App");
    ui.render(
      <AgentModelPicker
        options={[{ key: "opencode", label: "OpenCode" }]}
        agent="opencode"
        agentLabel="OpenCode"
        onSelectAgent={() => {}}
        model="opencode-go/glm-5.3"
        models={["opencode-go/glm-5.3"]}
        onModelChange={() => {}}
      />,
    );
    const pill = ui.query("button[aria-label^='Agent OpenCode']") as HTMLButtonElement;
    expect(pill.textContent).toContain("GLM 5.3");
    expect(pill.querySelectorAll("svg[role='img']").length).toBe(1);
    expect(pill.querySelector("img[data-testid='agent-model-badge']")).not.toBeNull();
  });
});

describe("ModelOptionList with OpenCode ids", () => {
  let ui: Mounted;
  beforeEach(() => {
    ui = mount();
  });
  afterEach(() => ui.cleanup());

  const OPENCODE = [
    "opencode-go/glm-5.3",
    "opencode-go/kimi-k3",
    "opencode/big-pickle",
    "novita-ai/zai-org/glm-5",
    "xai/grok-4.5",
  ];

  test("rows show short names under router headings, with lab marks where known", () => {
    let chosen: string | null = null;
    ui.render(<ModelOptionList value={OPENCODE[0]!} models={OPENCODE} onChoose={(m) => { chosen = m; }} />);
    const groups = ui.queryAll("[role='group']").map((group) => group.getAttribute("aria-label"));
    expect(groups).toEqual(["OpenCode Go", "OpenCode Zen", "Novita AI", "xAI"]);
    const text = ui.text();
    expect(text).toContain("GLM 5.3");
    expect(text).toContain("Kimi K3");
    expect(text).toContain("Big Pickle");
    expect(text).toContain("Grok 4.5");
    expect(text).not.toContain("opencode-go/glm-5.3");
    // Big Pickle has no known lab, and Moonshot (Kimi) has no mark yet: no
    // icon for those rows, but a spacer keeps the names in one column.
    const rows = ui.queryAll("button");
    expect(rows.filter((row) => row.querySelector("svg[role='img']")).length).toBe(3);
    const glm = rows.find((row) => row.textContent === "GLM 5") as HTMLButtonElement;
    expect(glm.title).toBe("Z.ai via Novita AI · novita-ai/zai-org/glm-5");
    ui.flush(() => glm.click());
    expect(chosen).toBe("novita-ai/zai-org/glm-5");
  });
});


test("the model dropdown retains thinking changes without closing", async () => {
  const { AgentModelPicker } = await import("./App");
  const { ThinkingBar } = await import("./components/agent-setup-sheet");
  const ui = mount();
  const changes: string[] = [];
  function Picker() {
    const [level, setLevel] = useState("medium");
    return (
      <AgentModelPicker
        options={[{ key: "codex", label: "Codex" }]}
        agent="codex"
        agentLabel="Codex"
        onSelectAgent={() => {}}
        model="gpt-6.1-sol"
        models={["gpt-6.1-sol", "gpt-6-luna"]}
        onModelChange={() => {}}
        footer={
          <ThinkingBar
            options={["low", "medium", "high"].map((id) => ({ id, label: id, selected: id === level }))}
            onPick={(next) => { changes.push(next); setLevel(next); }}
          />
        }
      />
    );
  }
  try {
    ui.render(<Picker />);
    const trigger = () => ui.query("button[aria-label^='Agent Codex']") as HTMLButtonElement;
    ui.flush(() => trigger().click());
    await ui.flushAsync();
    const slider = () => document.body.querySelector('[role="slider"][aria-label="Thinking level"]')!;
    expect(slider().getAttribute("aria-valuetext")).toBe("medium");
    ui.flush(() => slider().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(changes).toEqual(["high"]);
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(slider().getAttribute("aria-valuetext")).toBe("high");
    ui.flush(() => trigger().click());
    await ui.flushAsync();
    ui.flush(() => trigger().click());
    await ui.flushAsync();
    expect(slider().getAttribute("aria-valuetext")).toBe("high");
  } finally {
    ui.cleanup();
  }
});

// A removed model must not be offered for new sessions. Haiku selection must
// return the exact router id that the runtime can execute.
test("managed picker offers Haiku 5.5 and excludes retired choices", () => {
  const ui = mount();
  let chosen: string | null = null;
  try {
    ui.render(<ModelOptionList value={OMG_MODELS[0]!} models={OMG_MODELS} onChoose={(model) => { chosen = model; }} />);
    openAllModels(ui);
    const haiku = ui.queryAll("button").find((row) => row.title.split("\n")[0]!.endsWith("omg/anthropic/claude-haiku-5.5")) as HTMLButtonElement;
    expect(haiku).toBeDefined();
    ui.flush(() => haiku.click());
    expect(chosen).toBe("omg/anthropic/claude-haiku-5.5");
    for (const retired of ["omg/z-ai/glm-5.2", "omg/openai/gpt-5.6-sol", "omg/openai/gpt-5.6-terra", "omg/anthropic/claude-opus-4.8", "omg/anthropic/claude-sonnet-4.6", "omg/openai/gpt-5.6-luna", "omg/qwen/qwen3.7-plus", "omg/qwen/qwen3-coder-next"]) {
      expect(ui.queryAll("button").some((row) => row.title.split("\n")[0]!.endsWith(retired))).toBe(false);
    }
  } finally {
    ui.cleanup();
  }
});

// A custom model whose server is stopped reads "Offline" and cannot be picked.
describe("ModelOptionList custom model status", () => {
  let ui: Mounted;
  beforeEach(() => { ui = mount(); });
  afterEach(() => { ui.cleanup(); configureOmgTransport(createSameOriginTransport()); });

  test("offline rows are marked and refuse a pick; online rows still choose", async () => {
    const asked: string[] = [];
    configureOmgTransport(createSameOriginTransport({ fetch: (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return Response.json({ models: { "custom-modal/ds": { online: false }, "custom-pc/gemma": { online: true } } });
    }) as typeof globalThis.fetch }));
    let chosen = "";
    ui.render(<ModelOptionList value="custom-pc/gemma" models={["custom-pc/gemma", "custom-modal/ds"]} onChoose={(m) => { chosen = m; }} />);
    await ui.flushAsync();
    expect(asked.some((url) => url.includes("/api/custom-models/status"))).toBe(true);
    const rows = ui.queryAll("button") as HTMLButtonElement[];
    const offline = rows.find((row) => row.textContent?.includes("Offline"))!;
    expect(offline).toBeDefined();
    expect(offline.getAttribute("aria-disabled")).toBe("true");
    expect(rows.filter((row) => row.textContent?.includes("Offline")).length).toBe(1);
    ui.flush(() => offline.click());
    expect(chosen).toBe("");
    const online = rows.find((row) => row !== offline)!;
    ui.flush(() => online.click());
    expect(chosen).toBe("custom-pc/gemma");
  });

  test("hosted-only lists never ask for custom status", async () => {
    const asked: string[] = [];
    configureOmgTransport(createSameOriginTransport({ fetch: (async (input: RequestInfo | URL) => {
      asked.push(String(input));
      return Response.json({ models: {} });
    }) as typeof globalThis.fetch }));
    ui.render(<ModelOptionList value="gpt-5.6" models={["gpt-5.6", "gpt-5.6-mini"]} onChoose={() => {}} />);
    await ui.flushAsync();
    expect(asked.some((url) => url.includes("/api/custom-models/status"))).toBe(false);
  });
});
