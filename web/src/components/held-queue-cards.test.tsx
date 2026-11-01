import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, window, type Mounted } from "../test-support/render";
import type { OmgQueueMessage } from "../lib/omg-chat-transport";

const { HeldQueueCards, HeldQueueDock, LOCAL_HELD_ID_PREFIX } = await import("./held-queue-cards");

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
          sent.push(await release());
        }}
        request={request}
      />,
    );
  render();
  return {
    calls,
    sent,
    painted,
    errors,
    current: () => items,
    render: (next: OmgQueueMessage[]) => {
      items = next;
      render();
    },
  };
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

  const SEND_ALL = 'button[aria-label="Send all queued now, into the current turn"]';
  const Q = "/api/sessions/11111111-1111-4111-8111-111111111111/queue";

  test("send now deletes every held row then steers them as one message, in order", async () => {
    const h = harness();
    const send = ui.query(SEND_ALL) as HTMLButtonElement;
    await ui.flushAsync(() => send.click());
    expect(h.current()).toEqual([]);
    expect(h.calls).toEqual([
      { path: `${Q}/aa11`, method: "DELETE", body: undefined },
      { path: `${Q}/bb22`, method: "DELETE", body: undefined },
    ]);
    expect(h.sent).toEqual(["first thing\n\nsecond thing"]);
    expect(ui.text()).not.toContain("first thing");
  });

  test("send now on a later card still sends the whole queue in queue order", async () => {
    const h = harness();
    await ui.flushAsync(() => (ui.query("button[aria-expanded]") as HTMLButtonElement).click());
    const second = ui.queryAll(SEND_ALL)[1] as HTMLButtonElement;
    await ui.flushAsync(() => second.click());
    expect(h.sent).toEqual(["first thing\n\nsecond thing"]);
  });

  test("a single queued card keeps the plain send-now label", async () => {
    const h = harness({ items: [held[0]!] });
    expect(ui.query(SEND_ALL)).toBeNull();
    const send = ui.query('button[aria-label="Send now, into the current turn"]') as HTMLButtonElement;
    await ui.flushAsync(() => send.click());
    expect(h.sent).toEqual(["first thing"]);
  });

  test("send now hands the text to the caller before the deletes resolve", async () => {
    const finishers: (() => void)[] = [];
    const h = harness({
      request: <T,>() => new Promise<T>((resolve) => finishers.push(() => resolve({ ok: true } as T))),
    });
    const send = ui.query(SEND_ALL) as HTMLButtonElement;
    await ui.flushAsync(() => send.click());
    // The cards are gone and the bubble is painted while the DELETEs are pending.
    expect(h.painted).toEqual(["first thing\n\nsecond thing"]);
    expect(h.sent).toEqual([]);
    expect(ui.text()).not.toContain("first thing");
    await ui.flushAsync(() => finishers.forEach((finish) => finish()));
    expect(h.sent).toEqual(["first thing\n\nsecond thing"]);
  });

  test("send now does not steer when every delete fails, and the cards come back", async () => {
    const h = harness({
      request: async <T,>(_path: string, init?: RequestInit) => {
        if (init?.method === "DELETE") throw new Error("network down");
        return { queue: held } as T;
      },
    });
    const send = ui.query(SEND_ALL) as HTMLButtonElement;
    await ui.flushAsync(() => send.click());
    expect(h.sent).toEqual([]);
    expect(h.errors).toEqual(["network down"]);
    expect(h.current().map((item) => item.id)).toEqual(["aa11", "bb22"]);
    expect(ui.text()).toContain("first thing");
  });

  test("send now sends only the rows the server released; a failed row stays queued", async () => {
    const h = harness({
      request: async <T,>(path: string, init?: RequestInit) => {
        if (init?.method === "DELETE" && path.endsWith("/bb22")) throw new Error("network down");
        return { queue: [held[1]] } as T;
      },
    });
    const send = ui.query(SEND_ALL) as HTMLButtonElement;
    await ui.flushAsync(() => send.click());
    expect(h.painted).toEqual(["first thing\n\nsecond thing"]);
    expect(h.sent).toEqual(["first thing"]);
    expect(h.errors).toEqual(["network down"]);
    expect(h.current().map((item) => item.id)).toEqual(["bb22"]);
  });

  // The idle release and a tap can cross: the server already sent the row and
  // answers 404/409. Nothing failed, so nothing is shown; the list re-reads.
  test("send now on a row the server already released shows no error and sends nothing twice", async () => {
    const h = harness({
      request: async <T,>(_path: string, init?: RequestInit) => {
        if (init?.method === "DELETE") throw new Error("queued message not found");
        return { queue: [] } as T;
      },
    });
    await ui.flushAsync(() => (ui.query(SEND_ALL) as HTMLButtonElement).click());
    expect(h.sent).toEqual([]);
    expect(h.errors).toEqual([]);
    expect(h.current()).toEqual([]);
    expect(h.calls.at(-1)).toEqual({ path: Q, method: undefined, body: undefined });
  });

  test("removing or editing a row that is no longer held shows no error", async () => {
    const h = harness({
      request: async <T,>(_path: string, init?: RequestInit) => {
        if (init?.method === "DELETE") throw new Error("only a held message can be removed");
        if (init?.method === "PATCH") throw new Error("only a held message can be edited");
        return { queue: [] } as T;
      },
    });
    const open = ui.queryAll('button[title="Edit"]')[0] as HTMLButtonElement;
    await ui.flushAsync(() => open.click());
    await ui.flushAsync(() => (ui.query('button[aria-label="Save queued message"]') as HTMLButtonElement).click());
    expect(h.errors).toEqual([]);
    expect(h.current()).toEqual([]);
    h.calls.length = 0;
    await ui.flushAsync(() => h.render([held[1]!]));
    await ui.flushAsync(() => (ui.query('button[aria-label="Remove queued message"]') as HTMLButtonElement).click());
    expect(h.calls.map((call) => call.method)).toEqual(["DELETE", undefined]);
    expect(h.errors).toEqual([]);
  });

  test("send now leaves a card that is still waiting for its server row", async () => {
    const local = { id: `${LOCAL_HELD_ID_PREFIX}x1`, text: "just typed", status: "held" as const, createdAt: 3 };
    const h = harness({ items: [...held, local] });
    const send = ui.query(SEND_ALL) as HTMLButtonElement;
    await ui.flushAsync(() => send.click());
    expect(h.sent).toEqual(["first thing\n\nsecond thing"]);
    expect(h.current().map((item) => item.id)).toEqual([local.id]);
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

describe("the held card keeps its row", () => {
  const draw = (items: OmgQueueMessage[]) =>
    ui.render(
      <HeldQueueCards sessionId="s1" items={items} busy onChange={() => {}} onError={() => {}} onSendNow={async () => {}} />,
    );

  test("the server row takes over the card painted before it, in place", () => {
    const localId = `${LOCAL_HELD_ID_PREFIX}abc`;
    draw([{ id: localId, text: "after that", status: "held" }]);
    const painted = ui.query('[aria-label="Queueing"]')?.closest("div");
    expect(painted).toBeTruthy();

    draw([{ id: "srv1", text: "after that", status: "held", renderKey: localId }]);
    // Same element: it now carries the card's controls instead of a spinner.
    expect(ui.query('[aria-label="Queueing"]')).toBeNull();
    expect(ui.query('[aria-label="Send now, into the current turn"]')?.closest("div")).toBe(painted!);
  });
});

describe("the held dock", () => {
  const dock = (items: OmgQueueMessage[]) =>
    ui.render(
      <HeldQueueDock items={items}>
        {(shown) => <ul>{shown.map((item) => <li key={item.id}>{item.text}</li>)}</ul>}
      </HeldQueueDock>,
    );

  test("draws nothing while there is nothing held", () => {
    dock([]);
    expect(ui.query(".lfg-dock")).toBeNull();
  });

  test("folds the last cards away before it leaves", async () => {
    dock(held);
    expect(ui.query(".lfg-dock")?.getAttribute("data-state")).toBe("open");

    dock([]);
    // Still drawn, closing, with the text it had, so the room shrinks rather
    // than vanishing in one frame.
    expect(ui.query(".lfg-dock")?.getAttribute("data-state")).toBe("closed");
    expect(ui.text()).toContain("first thing");

    await ui.flushAsync(() => new Promise((resolve) => window.setTimeout(resolve, 260)));
    expect(ui.query(".lfg-dock")).toBeNull();
  });

  test("opens again if a card comes back while it is closing", () => {
    dock(held);
    dock([]);
    dock([held[1]!]);
    expect(ui.query(".lfg-dock")?.getAttribute("data-state")).toBe("open");
    expect(ui.text()).toContain("second thing");
    expect(ui.text()).not.toContain("first thing");
  });
});

