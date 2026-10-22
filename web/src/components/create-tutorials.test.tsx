// The host's tutorial cards on the phone Create page. A hosted surface can keep
// the props of its first render, so the cards must follow the host's store:
// a tutorial the person starts elsewhere must show as in progress here, and a
// tap must reach the host with that tutorial's id. The first version portaled
// host markup into the page and dropped the cards after page changes.

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
