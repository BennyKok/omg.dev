import { afterEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { selectionChangeStateForTests, subscribeSelectionChange } from "./selection-change";

const win = new Window();
globalThis.document = win.document as unknown as Document;

afterEach(() => {
  // Every test must unsubscribe; this catches one that forgot.
  expect(selectionChangeStateForTests().subscribers).toBe(0);
});

describe("shared selectionchange listener", () => {
  test("many subscribers share a single DOM listener", () => {
    const offs = [subscribeSelectionChange(() => {}), subscribeSelectionChange(() => {})];
    expect(selectionChangeStateForTests()).toEqual({ subscribers: 2, attached: true });
    for (const off of offs) off();
  });

  test("the DOM listener is released once the last subscriber leaves", () => {
    const off = subscribeSelectionChange(() => {});
    expect(selectionChangeStateForTests().attached).toBe(true);
    off();
    expect(selectionChangeStateForTests()).toEqual({ subscribers: 0, attached: false });
  });

  test("every subscriber is notified on a selection change", () => {
    let a = 0;
    let b = 0;
    const offA = subscribeSelectionChange(() => (a += 1));
    const offB = subscribeSelectionChange(() => (b += 1));
    document.dispatchEvent(new win.Event("selectionchange") as unknown as Event);
    expect([a, b]).toEqual([1, 1]);
    offA();
    document.dispatchEvent(new win.Event("selectionchange") as unknown as Event);
    expect([a, b]).toEqual([1, 2]);
    offB();
  });

  test("unsubscribing twice is safe and does not strand the listener", () => {
    const off = subscribeSelectionChange(() => {});
    off();
    off();
    expect(selectionChangeStateForTests()).toEqual({ subscribers: 0, attached: false });
  });
});
