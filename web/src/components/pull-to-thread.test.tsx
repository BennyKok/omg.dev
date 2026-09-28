import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { THREAD_PULL_ARM, THREAD_PULL_HINT } from "../../../packages/protocol/src/threads";

const { PullToThread } = await import("./pull-to-thread");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

function touch(type: string, y: number) {
  const event = new window.Event(type, { bubbles: true }) as unknown as { touches: { clientY: number }[] };
  event.touches = [{ clientY: y }];
  return event as unknown as Event;
}

async function pull(distance: number) {
  const area = ui.query('[data-testid="pull-to-thread"]')!;
  await ui.flushAsync(() => {
    area.dispatchEvent(touch("touchstart", 100));
  });
  await ui.flushAsync(() => {
    area.dispatchEvent(touch("touchmove", 100 + distance));
  });
  const during = ui.text();
  await ui.flushAsync(() => {
    area.dispatchEvent(touch("touchend", 100 + distance));
  });
  return during;
}

test("a short pull does nothing; a long pull says release, and releasing starts a thread", async () => {
  let started = 0;
  ui.render(<PullToThread onStart={() => started++} scrollTop={() => 0}><div>list</div></PullToThread>);
  expect(await pull(THREAD_PULL_HINT - 10)).not.toContain("thread");
  expect(started).toBe(0);
  expect(await pull(THREAD_PULL_HINT + 5)).toContain("Pull more to start a thread");
  expect(started).toBe(0);
  expect(await pull(THREAD_PULL_ARM + 5)).toContain("Release to start a thread");
  expect(started).toBe(1);
});

test("a pull that starts while the list is scrolled is an ordinary scroll", async () => {
  let started = 0;
  ui.render(<PullToThread onStart={() => started++} scrollTop={() => 240}><div>list</div></PullToThread>);
  expect(await pull(THREAD_PULL_ARM + 50)).not.toContain("Release");
  expect(started).toBe(0);
});
