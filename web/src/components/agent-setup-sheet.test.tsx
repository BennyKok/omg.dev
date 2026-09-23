import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { mount, type Mounted } from "../test-support/render";
const { AgentSetupSheet, ThinkingBar } = await import("./agent-setup-sheet");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

const agents = [
  { id: "aisdk", label: "Claude", iconSrc: "/claude.svg", selected: true },
  { id: "codex", label: "Codex", iconSrc: "/codex.svg", selected: false },
  { id: "gemini", label: "Gemini", iconSrc: "/gemini.svg", selected: false, locked: true },
];

function click(el: Element | null) {
  if (!el) throw new Error("missing element");
  act(() => {
    (el as HTMLElement).click();
  });
}

function body() {
  return document.body;
}

test("root page shows the agent row, model, Fast and thinking", async () => {
  ui.render(
    <AgentSetupSheet
      open
      onOpenChange={() => {}}
      title="Claude"
      agents={agents}
      onSelectAgent={() => {}}
      modelLabel="claude-opus-5-5"
      renderModels={() => <div>model list</div>}
      fast={{ enabled: false, onToggle: () => {} }}
      thinking={{
        options: [
          { id: "low", label: "Low", selected: false },
          { id: "medium", label: "Medium", selected: true },
        ],
        onPick: () => {},
      }}
    />,
  );
  await ui.flushAsync();
  const text = body().textContent ?? "";
  expect(text).toContain("Claude");
  expect(text).toContain("claude-opus-5-5");
  expect(text).toContain("Medium");
  expect(body().querySelector('[aria-label="Codex agent"]')).not.toBeNull();
  expect(body().querySelector('[aria-label="Connect Gemini"]')).not.toBeNull();
  expect(body().querySelector('[role="switch"][aria-label="Fast mode"]')).not.toBeNull();
});

test("tapping an agent selects it, and a locked agent routes to connect", async () => {
  const onSelect = mock((_id: string) => {});
  const onLocked = mock((_id: string) => {});
  ui.render(
    <AgentSetupSheet
      open
      onOpenChange={() => {}}
      title="Claude"
      agents={agents}
      onSelectAgent={onSelect}
      onLockedAgent={onLocked}
    />,
  );
  await ui.flushAsync();
  click(body().querySelector('[aria-label="Codex agent"]'));
  click(body().querySelector('[aria-label="Connect Gemini"]'));
  expect(onSelect.mock.calls).toEqual([["codex"]]);
  expect(onLocked.mock.calls).toEqual([["gemini"]]);
});

test("the model row opens the model page and done returns to root", async () => {
  ui.render(
    <AgentSetupSheet
      open
      onOpenChange={() => {}}
      title="Claude"
      agents={agents}
      onSelectAgent={() => {}}
      modelLabel="claude-opus-5-5"
      renderModels={(done) => (
        <button type="button" onClick={done}>
          pick model
        </button>
      )}
    />,
  );
  await ui.flushAsync();
  click(body().querySelector('[aria-label="Model claude-opus-5-5. Change model"]'));
  await ui.flushAsync();
  expect(body().textContent).toContain("Models");
  const pick = [...body().querySelectorAll("button")].find((b) => b.textContent === "pick model");
  click(pick ?? null);
  await ui.flushAsync();
  expect(body().textContent).toContain("claude-opus-5-5");
});

test("opening on the profiles page lists Claude profiles and picks one", async () => {
  const onProfile = mock((_id: string) => {});
  ui.render(
    <AgentSetupSheet
      open
      onOpenChange={() => {}}
      initialPage="profiles"
      title="Claude"
      agents={agents}
      onSelectAgent={() => {}}
      profiles={[
        { id: "", label: "Auto", selected: true },
        { id: "acct-2", label: "2", selected: false },
      ]}
      onSelectProfile={onProfile}
    />,
  );
  await ui.flushAsync();
  expect(body().textContent).toContain("Claude profile");
  click(body().querySelector('[aria-label="Claude 2"]'));
  expect(onProfile.mock.calls).toEqual([["acct-2"]]);
});

test("the thinking bar steps with the keyboard", () => {
  const onPick = mock((_id: string) => {});
  ui.render(
    <ThinkingBar
      options={[
        { id: "low", label: "Low", selected: false },
        { id: "medium", label: "Medium", selected: true },
        { id: "high", label: "High", selected: false },
      ]}
      onPick={onPick}
    />,
  );
  const slider = ui.query('[role="slider"]');
  expect(slider?.getAttribute("aria-valuetext")).toBe("Medium");
  act(() => {
    slider?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  });
  expect(onPick.mock.calls).toEqual([["high"]]);
});

test("reopening the sheet never pins its body at 0px", async () => {
  // happy-dom has no layout, so every page measures 0 tall, the same reading
  // a detached page gives while the sheet closes. The body must fall back to
  // its natural height rather than adopt it.
  const original = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  try {
    const sheet = (open: boolean) => (
      <AgentSetupSheet
        open={open}
        onOpenChange={() => {}}
        title="Grok"
        agents={agents}
        onSelectAgent={() => {}}
        modelLabel="grok-4.6"
        renderModels={() => <div>model list</div>}
      />
    );
    ui.render(sheet(true));
    await ui.flushAsync();
    ui.render(sheet(false));
    await ui.flushAsync();
    ui.render(sheet(true));
    await ui.flushAsync();
    const content = body().querySelector('[data-slot="agent-setup-sheet"]');
    expect(content).not.toBeNull();
    const pinned = [...(content?.querySelectorAll<HTMLElement>("div") ?? [])].filter((el) => el.style.height === "0px");
    expect(pinned).toHaveLength(0);
    expect(body().querySelector('[aria-label="Codex agent"]')).not.toBeNull();
  } finally {
    globalThis.ResizeObserver = original;
  }
});
