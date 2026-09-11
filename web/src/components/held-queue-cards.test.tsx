import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, window, type Mounted } from "../test-support/render";
import type { OmgQueueMessage } from "../lib/omg-chat-transport";

const { HeldQueueCards } = await import("./held-queue-cards");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

const held: OmgQueueMessage[] = [
  { id: "aa11", text: "first thing", status: "held", createdAt: 1 },
  { id: "bb22", text: "second thing", status: "held", createdAt: 2 },
];

function harness() {
  const calls: { path: string; method?: string; body?: unknown }[] = [];
  let items = held;
  const request = async <T,>(path: string, init?: RequestInit) => {
    calls.push({
      path,
      method: init?.method,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return { ok: true } as T;
  };
  const render = () =>
    ui.render(
      <HeldQueueCards
        sessionId="11111111-1111-4111-8111-111111111111"
        items={items}
        busy
        onChange={(update) => {
          items = update(items);
          render();
        }}
        onError={() => {}}
        request={request}
      />,
    );
  render();
  return { calls, current: () => items };
}

describe("HeldQueueCards", () => {
  test("collapsed: shows the count, the next send, and a +N chip; expands on click", async () => {
    harness();
    expect(ui.text()).toContain("2 queued");
    expect(ui.text()).not.toContain("sending");
    expect(ui.text()).toContain("first thing");
    expect(ui.text()).not.toContain("second thing");
    expect(ui.text()).toContain("+1");
    const more = ui.query('button[aria-label="Show 1 more queued"]') as HTMLButtonElement;
    await ui.flushAsync(() => more.click());
    expect(ui.text().indexOf("first thing")).toBeLessThan(ui.text().indexOf("second thing"));
    expect(ui.text()).not.toContain("+1");
  });

  test("removing a card drops it locally and on the server", async () => {
    const h = harness();
    await ui.flushAsync(() => (ui.query('button[aria-expanded]') as HTMLButtonElement).click());
    const remove = ui.queryAll('button[aria-label="Remove queued message"]')[1] as HTMLButtonElement;
    await ui.flushAsync(() => remove.click());
    expect(h.current().map((item) => item.id)).toEqual(["aa11"]);
    expect(h.calls).toEqual([
      { path: "/api/sessions/11111111-1111-4111-8111-111111111111/queue/bb22", method: "DELETE", body: undefined },
    ]);
    expect(ui.text()).not.toContain("second thing");
  });

  test("editing a card patches the held text", async () => {
    const h = harness();
    const open = ui.queryAll('button[title="Edit"]')[0] as HTMLButtonElement;
    await ui.flushAsync(() => open.click());
    const field = ui.query('textarea[aria-label="Edit queued message"]') as HTMLTextAreaElement;
    expect(field.value).toBe("first thing");
    await ui.flushAsync(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(field, "first thing, revised");
      field.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    const save = ui.query('button[aria-label="Save queued message"]') as HTMLButtonElement;
    await ui.flushAsync(() => save.click());
    expect(h.current()[0]?.text).toBe("first thing, revised");
    expect(h.calls).toEqual([
      {
        path: "/api/sessions/11111111-1111-4111-8111-111111111111/queue/aa11",
        method: "PATCH",
        body: { text: "first thing, revised" },
      },
    ]);
  });
});
