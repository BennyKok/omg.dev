import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, window, type Mounted } from "../test-support/render";
import type { OmgQueueMessage } from "../lib/omg-chat-transport";

const { HeldQueueCards, LOCAL_HELD_ID_PREFIX } = await import("./held-queue-cards");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

const held: OmgQueueMessage[] = [
  { id: "aa11", text: "first thing", status: "held", createdAt: 1 },
  { id: "bb22", text: "second thing", status: "held", createdAt: 2 },
];

function harness(opts?: {
  request?: <T>(path: string, init?: RequestInit) => Promise<T>;
  items?: OmgQueueMessage[];
}) {
  const calls: { path: string; method?: string; body?: unknown }[] = [];
  const sent: string[] = [];
  // What the transcript shows while each send-now is in flight: the caller
  // paints a bubble before it awaits `release`.
  const painted: string[] = [];
  const errors: (string | null)[] = [];
  let items = opts?.items ?? held;
  const request = async <T,>(path: string, init?: RequestInit) => {
    calls.push({
      path,
      method: init?.method,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    if (opts?.request) return opts.request<T>(path, init);
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
        onError={(message) => errors.push(message)}
        onSendNow={async (text, release) => {
          painted.push(text);
          await release();
          sent.push(text);
        }}
        request={request}
      />,
    );
  render();
  return { calls, sent, painted, errors, current: () => items };
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

  test("send now deletes the held row then steers the text", async () => {
    const h = harness();
    const send = ui.query('button[aria-label="Send now, into the current turn"]') as HTMLButtonElement;
    await ui.flushAsync(() => send.click());
    expect(h.current().map((item) => item.id)).toEqual(["bb22"]);
    expect(h.calls).toEqual([
      { path: "/api/sessions/11111111-1111-4111-8111-111111111111/queue/aa11", method: "DELETE", body: undefined },
    ]);
    expect(h.sent).toEqual(["first thing"]);
    expect(ui.text()).not.toContain("first thing");
  });

  test("send now hands the text to the caller before the delete resolves", async () => {
    let finishDelete: () => void = () => {};
    const h = harness({
      request: <T,>() => new Promise<T>((resolve) => (finishDelete = () => resolve({ ok: true } as T))),
    });
    const send = ui.query('button[aria-label="Send now, into the current turn"]') as HTMLButtonElement;
    await ui.flushAsync(() => send.click());
    // The card is gone and the bubble is painted while the DELETE is pending.
    expect(h.painted).toEqual(["first thing"]);
    expect(h.sent).toEqual([]);
    expect(ui.text()).not.toContain("first thing");
    await ui.flushAsync(() => finishDelete());
    expect(h.sent).toEqual(["first thing"]);
  });

  test("send now does not steer when the delete fails, and the card comes back", async () => {
    const h = harness({
      request: async <T,>(_path: string, init?: RequestInit) => {
        if (init?.method === "DELETE") throw new Error("network down");
        return { queue: held } as T;
      },
    });
    const send = ui.query('button[aria-label="Send now, into the current turn"]') as HTMLButtonElement;
    await ui.flushAsync(() => send.click());
    expect(h.sent).toEqual([]);
    expect(h.errors).toEqual(["network down"]);
    expect(h.current().map((item) => item.id)).toEqual(["aa11", "bb22"]);
    expect(ui.text()).toContain("first thing");
  });

  test("a card the server has not answered for yet shows a spinner and no actions", () => {
    harness({
      items: [{ id: `${LOCAL_HELD_ID_PREFIX}x1`, text: "just typed", status: "held", createdAt: 3 }],
    });
    expect(ui.text()).toContain("1 queued");
    expect(ui.text()).toContain("just typed");
    expect(ui.query('[aria-label="Queueing"]')).not.toBeNull();
    expect(ui.query('button[aria-label="Send now, into the current turn"]')).toBeNull();
    expect(ui.query('button[aria-label="Remove queued message"]')).toBeNull();
    expect((ui.query('button[title="Edit"]') as HTMLButtonElement).disabled).toBe(true);
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
