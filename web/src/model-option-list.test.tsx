import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "./test-support/render";
import { OMG_MODELS } from "../../src/omg-models";

const { ModelOptionList } = await import("./App");

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
    const text = ui.text();
    expect(text).toContain("DeepSeek V4 Flash");
    expect(text).toContain("GLM 5.3 Flash");
    expect(text).toContain("GPT-5.6 Sol");
    expect(text).not.toContain("omg/deepseek/deepseek-v4-flash-0731");
    const rows = ui.queryAll("button");
    expect(rows.length).toBe(OMG_MODELS.length);
    // One mark per row: every hosted id maps to a lab with artwork.
    expect(ui.queryAll("button svg[role='img']").length).toBe(OMG_MODELS.length);
    const glm = rows.find((row) => row.textContent?.includes("GLM 5.2")) as HTMLButtonElement;
    expect(glm.title).toBe("Z.ai · omg/z-ai/glm-5.2");
    ui.flush(() => glm.click());
    expect(chosen).toBe("omg/z-ai/glm-5.2");
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
    expect(ui.text()).toContain("GLM 5.2");
    type("nothing-here");
    expect(ui.text()).toContain("No matching models");
  });

  test("other agents' ids stay as they are, without a mark", () => {
    ui.render(<ModelOptionList value="gpt-5.6" models={["gpt-5.6", "gpt-5.6-mini"]} onChoose={() => {}} />);
    expect(ui.text()).toContain("gpt-5.6-mini");
    expect(ui.queryAll("button svg[role='img']").length).toBe(0);
    expect(ui.query("input")).toBeNull();
  });
});
