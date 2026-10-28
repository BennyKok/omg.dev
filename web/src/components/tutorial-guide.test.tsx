// The host's tutorial guide card, drawn by the surface. The old guide was host
// markup positioned over the surface, and it covered the agent's reply, the
// preview bar and the Create page's tutorial cards. These tests fail if the
// card shows in a composer it does not belong to (that is how a card ended up
// floating over Home), if "Fill it in" does not reach this composer, if one
// tap on the close control ends a run without asking, or if the card stops
// following the host's store after the first render.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { mount, type Mounted } from "../test-support/render";
import type { HostGuideCard, HostGuideCardStore } from "../lib/embedded-host-options";

const { GuideComposerSlot, useGuideFocus } = await import("./tutorial-guide");
const { EmbeddedHostOptionsProvider } = await import("../lib/embedded-host-options");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

function host(initial: HostGuideCard | null) {
  let card = initial;
  const listeners = new Set<() => void>();
  const actions: string[] = [];
  const store: HostGuideCardStore = {
    getCard: () => card,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onAction: (id) => actions.push(id),
  };
  const set = (next: HostGuideCard | null) => {
    card = next;
    act(() => {
      for (const listener of listeners) listener();
    });
  };
  return { store, set, actions };
}

const ideaStep: HostGuideCard = {
  key: "idea",
  surface: "new-session",
  title: "Build a to-do app",
  mood: "awake",
  step: { number: 1, count: 6 },
  text: "Type this in the chat box, or fill it in.",
  sentence: { text: "A to-do app where I add tasks." },
  focus: "composer",
  stoppable: true,
};

const sessionStep: HostGuideCard = {
  ...ideaStep,
  key: "change",
  surface: "session",
  sessionId: "s1",
  step: { number: 4, count: 6 },
  sentence: { text: "Add a due date to each task." },
};

function Composer({ surface, sessionId, fills }: { surface: "new-session" | "session"; sessionId?: string; fills: string[] }) {
  const focus = useGuideFocus(surface, sessionId);
  return (
    <form data-testid={`composer-${sessionId ?? "home"}`} data-lfg-guide-focus={focus}>
      <GuideComposerSlot surface={surface} sessionId={sessionId} fill={(text) => void fills.push(text)} />
    </form>
  );
}

function renderComposers(store: HostGuideCardStore, fills: string[] = []) {
  ui.render(
    <EmbeddedHostOptionsProvider value={{ composerGuide: { card: store } }}>
      <Composer surface="new-session" fills={fills} />
      <Composer surface="session" sessionId="s1" fills={fills} />
      <Composer surface="session" sessionId="s2" fills={fills} />
    </EmbeddedHostOptionsProvider>,
  );
}

// The card is a lazy chunk: let it load and React retry the render.
const settle = () =>
  ui.flushAsync(async () => {
    await import("./tutorial-guide-card");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

const inComposer = (id: string, selector: string) => ui.query(`[data-testid="composer-${id}"] ${selector}`);

test("the card shows only in its own composer, and Home offers a row back to the run's chat", async () => {
  const h = host(ideaStep);
  renderComposers(h.store);
  await settle();
  expect(inComposer("home", '[data-testid="tutorial-guide-card"]')).not.toBeNull();
  expect(inComposer("s1", '[data-testid="tutorial-guide-card"]')).toBeNull();
  expect(ui.query('[data-testid="composer-home"]')!.getAttribute("data-lfg-guide-focus")).toBe("composer");

  // The run moves into its chat: Home keeps one resume row, no card; another chat shows nothing.
  h.set(sessionStep);
  await settle();
  expect(inComposer("home", '[data-testid="tutorial-guide-card"]')).toBeNull();
  expect(inComposer("s1", '[data-testid="tutorial-guide-card"]')).not.toBeNull();
  expect(inComposer("s2", "*")).toBeNull();
  const resume = inComposer("home", '[data-testid="tutorial-guide-resume"]') as HTMLButtonElement;
  expect(resume.textContent).toContain("Step 4 of 6");
  act(() => resume.click());
  expect(h.actions).toEqual(["resume"]);

  // The draft matches: Send is ringed.
  h.set({ ...sessionStep, ready: true });
  await settle();
  expect(ui.query('[data-testid="composer-s1"]')!.getAttribute("data-lfg-guide-focus")).toBe("send");
});

test("Fill it in fills this composer and tells the host", async () => {
  const h = host(sessionStep);
  const fills: string[] = [];
  renderComposers(h.store, fills);
  await settle();
  const fill = inComposer("s1", 'button[aria-label="Fill in this sentence"]') as HTMLButtonElement;
  act(() => fill.click());
  expect(fills).toEqual(["Add a due date to each task."]);
  expect(h.actions).toEqual(["fill"]);
});

test("quitting asks first, and a hidden guide is one row with no ring", async () => {
  const h = host(sessionStep);
  renderComposers(h.store);
  await settle();
  act(() => (inComposer("s1", 'button[aria-label="Quit tutorial"]') as HTMLButtonElement).click());
  expect(h.actions).toEqual([]);
  const keep = [...ui.queryAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Keep going")!;
  act(() => keep.click());
  expect(h.actions).toEqual([]);
  act(() => (inComposer("s1", 'button[aria-label="Quit tutorial"]') as HTMLButtonElement).click());
  const quit = [...ui.queryAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Quit")!;
  act(() => quit.click());
  expect(h.actions).toEqual(["stop"]);

  act(() => (inComposer("s1", 'button[aria-label="Hide the guide"]') as HTMLButtonElement).click());
  expect(h.actions).toEqual(["stop", "hide"]);
  h.set({ ...sessionStep, collapsed: true });
  await settle();
  expect(inComposer("s1", '[data-testid="tutorial-guide-card"]')).toBeNull();
  expect(ui.query('[data-testid="composer-s1"]')!.getAttribute("data-lfg-guide-focus")).toBeNull();
  expect(inComposer("s1", '[data-testid="tutorial-guide-collapsed"]')).not.toBeNull();
  act(() => (inComposer("s1", '[data-testid="tutorial-guide-collapsed"]') as HTMLButtonElement).click());
  expect(h.actions).toEqual(["stop", "hide", "show"]);
  h.set({ ...sessionStep, key: "mascot", step: { number: 5, count: 6 } });
  await settle();
  expect(inComposer("s1", '[data-testid="tutorial-guide-card"]')).not.toBeNull();
});
