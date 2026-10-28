// The host's tutorial cards on the phone Create page. A hosted surface can keep
// the props of its first render, so the cards must follow the host's store:
// a tutorial the person starts elsewhere must show as in progress here, and a
// tap must reach the host with that tutorial's id. The first version portaled
// host markup into the page and dropped the cards after page changes. The
// section test fails if a skill is drawn as a template (or the other way
// round), if the skills lose the app they go into, or if a skill tap does not
// reach the host.

import { beforeEach, afterEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import type { HostTutorialCard, HostTutorials } from "../lib/embedded-host-options";

const { CreateTutorials } = await import("./create-tutorials");
const { EmbeddedHostOptionsProvider } = await import("../lib/embedded-host-options");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

function store(initial: HostTutorialCard[]) {
  let cards: readonly HostTutorialCard[] = initial;
  const listeners = new Set<() => void>();
  const selected: string[] = [];
  const tutorials: HostTutorials = {
    getCards: () => cards,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onSelect: (id) => selected.push(id),
  };
  const set = (next: HostTutorialCard[]) => {
    cards = next;
    for (const listener of listeners) listener();
  };
  return { tutorials, set, selected };
}

const snake = (status: HostTutorialCard["status"]): HostTutorialCard => ({
  id: "snake",
  title: "Make a Snake game",
  imageUrl: "https://example.test/snake.webp",
  detail: "6 steps",
  status,
});

test("cards follow the host's store after the first render, and a tap reaches the host", () => {
  const host = store([snake("start")]);
  ui.render(
    <EmbeddedHostOptionsProvider value={{ tutorials: host.tutorials }}>
      <CreateTutorials />
    </EmbeddedHostOptionsProvider>,
  );
  const card = () => ui.query<HTMLButtonElement>('[data-testid="create-tutorial-snake"]');
  expect(card()).not.toBeNull();
  const before = card()!.textContent;

  ui.flush(() => host.set([snake("continue")]));
  expect(card()!.textContent).not.toBe(before);

  ui.flush(() => card()!.click());
  expect(host.selected).toEqual(["snake"]);
});

test("no host, or a host with no cards, draws nothing", () => {
  ui.render(<CreateTutorials />);
  expect(ui.query('[data-testid="create-tutorials"]')).toBeNull();

  const host = store([]);
  ui.render(
    <EmbeddedHostOptionsProvider value={{ tutorials: host.tutorials }}>
      <CreateTutorials />
    </EmbeddedHostOptionsProvider>,
  );
  expect(ui.query('[data-testid="create-tutorials"]')).toBeNull();
  ui.flush(() => host.set([snake("start")]));
  expect(ui.query('[data-testid="create-tutorials"]')).not.toBeNull();
});

test("the desktop grid shows the first three cards, and each still reaches the host", () => {
  const card = (id: string): HostTutorialCard => ({ ...snake("start"), id, title: id });
  const host = store(["a", "b", "c", "d"].map(card));
  ui.render(
    <EmbeddedHostOptionsProvider value={{ tutorials: host.tutorials }}>
      <CreateTutorials layout="grid" />
    </EmbeddedHostOptionsProvider>,
  );
  const shown = ui.queryAll('[data-testid^="create-tutorial-"]').map((el) => el.getAttribute("data-testid"));
  expect(shown).toEqual(["create-tutorial-a", "create-tutorial-b", "create-tutorial-c"]);
  ui.flush(() => ui.query<HTMLButtonElement>('[data-testid="create-tutorial-c"]')!.click());
  expect(host.selected).toEqual(["c"]);
});

test("templates and skills draw in their own sections, and the skills name the host's app", () => {
  const host = store([
    snake("start"),
    { id: "save-data", kind: "skill", title: "Save your data", imageUrl: "https://example.test/s.svg", iconUrl: "https://example.test/s.svg", detail: "Still there", status: "start" },
  ]);
  let target: string | null = "Pocket Budget";
  const tutorials: HostTutorials = { ...host.tutorials, getSkillTarget: () => target };
  ui.render(
    <EmbeddedHostOptionsProvider value={{ tutorials }}>
      <CreateTutorials />
    </EmbeddedHostOptionsProvider>,
  );
  expect(ui.query('[data-testid="create-tutorial-snake"]')).not.toBeNull();
  expect(ui.query('[data-testid="create-tutorial-save-data"]')).toBeNull();
  const skill = ui.query<HTMLButtonElement>('[data-testid="create-skill-save-data"]');
  expect(skill).not.toBeNull();
  expect(ui.query('[data-testid="create-tutorials"]')!.textContent).toContain("Add it to Pocket Budget");

  target = "Dice Hub";
  ui.flush(() => host.set([snake("start"), { id: "ai-summary", kind: "skill", title: "Add AI", imageUrl: "https://example.test/a.svg", detail: "", status: "continue" }]));
  expect(ui.query('[data-testid="create-tutorials"]')!.textContent).toContain("Add it to Dice Hub");
  ui.flush(() => ui.query<HTMLButtonElement>('[data-testid="create-skill-ai-summary"]')!.click());
  expect(host.selected).toEqual(["ai-summary"]);

  // Skills alone: no empty template section.
  ui.flush(() => host.set([{ id: "ai-summary", kind: "skill", title: "Add AI", imageUrl: "https://example.test/a.svg", detail: "", status: "start" }]));
  expect(ui.query('[data-testid="create-tutorials"]')!.textContent).not.toContain("Start something new");
});
