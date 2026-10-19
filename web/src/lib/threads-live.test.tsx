import { mount } from "../test-support/render";
import { expect, test, spyOn } from "bun:test";
import type { OmgTransport } from "@omg-dev/client";
const { useThread, useThreads } = await import("./threads");
const { configureOmgTransport } = await import("./omg-client");
const { setListsLive, emitListChanges } = await import("./change-topics");

// A connected chat must receive new messages from events without periodic
// reads. A disconnected chat must retain its existing fallback and catch up.
test("thread list and detail use events while live and poll after a disconnect", async () => {
  let title = "before";
  let reads = 0;
  let gate: Promise<void> = Promise.resolve();
  const callbacks: Array<() => void> = [];
  const interval = spyOn(window, "setInterval").mockImplementation(((fn: () => void) => {
    callbacks.push(fn);
    return callbacks.length;
  }) as typeof window.setInterval);
  const clear = spyOn(window, "clearInterval").mockImplementation(() => {});
  const now = spyOn(Date, "now");
  const transport = {
    request: async (path: string) => {
      reads++;
      const snapshot = title;
      await gate;
      return path === "/api/threads" ? { threads: [{ id: "t", title: snapshot }] } : { thread: { id: "t", title: snapshot }, messages: [] };
    },
  } as unknown as OmgTransport;
  configureOmgTransport(transport);
  function View() {
    const { threads } = useThreads();
    const { detail } = useThread("t");
    return <div>{threads[0]?.title}|{detail?.thread.title}</div>;
  }
  const ui = mount();
  try {
    setListsLive(true);
    ui.render(<View />);
    await ui.flushAsync();
    expect(ui.text()).toBe("before|before");
    const initialReads = reads;
    now.mockReturnValue(Date.now() + 600_000);
    await ui.flushAsync(() => { for (const tick of callbacks) tick(); });
    expect(reads).toBe(initialReads);
    title = "event";
    await ui.flushAsync(() => emitListChanges(["threads"]));
    expect(ui.text()).toBe("event|event");
    let release!: () => void;
    gate = new Promise<void>(resolve => { release = resolve; });
    title = "stale read";
    await ui.flushAsync(() => emitListChanges(["threads"]));
    title = "changed during read";
    const delivery = emitListChanges(["threads"]);
    gate = Promise.resolve();
    await ui.flushAsync(async () => { release(); await delivery; });
    expect(ui.text()).toBe("changed during read|changed during read");
    title = "offline";
    setListsLive(false);
    await ui.flushAsync(() => { for (const tick of callbacks) tick(); });
    expect(ui.text()).toBe("offline|offline");
    title = "reconnected";
    setListsLive(true);
    await ui.flushAsync(() => emitListChanges([]));
    expect(ui.text()).toBe("reconnected|reconnected");
  } finally {
    ui.cleanup();
    setListsLive(false);
    interval.mockRestore();
    clear.mockRestore();
    now.mockRestore();
  }
});
