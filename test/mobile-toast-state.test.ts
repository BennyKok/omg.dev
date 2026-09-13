import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  createToastController,
  plainMessage,
  TOAST_STATUS,
  type ToastFeedback,
} from "../mobile/src/omg/toast-state";

function setup() {
  const haptics: ToastFeedback[] = [];
  const controller = createToastController((kind) => haptics.push(kind));
  let changes = 0;
  controller.subscribe(() => changes++);
  return { controller, haptics, changes: () => changes };
}

describe("plainMessage", () => {
  test("turns transport failures into one sentence", () => {
    expect(plainMessage("fetch failed: UnexpectedException: The network connection was lost. (at ExpoModulesCore/Promise.swift:56)"))
      .toBe("Connection lost. Check your network and try again.");
  });

  test("cuts a native stack tail off anything else", () => {
    expect(plainMessage("Bot name is taken (at BotStore.swift:12)")).toBe("Bot name is taken");
    expect(plainMessage("  Saved.  ")).toBe("Saved.");
  });
});

describe("createToastController", () => {
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  let timers: Map<number, { fn: () => void; ms: number }>;
  let nextTimer: number;

  beforeEach(() => {
    timers = new Map();
    nextTimer = 1;
    globalThis.setTimeout = ((fn: () => void, ms: number) => {
      const id = nextTimer++;
      timers.set(id, { fn, ms });
      return id;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((id: number) => {
      timers.delete(id);
    }) as unknown as typeof clearTimeout;
  });

  afterEach(() => {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
  });

  const fireAll = () => {
    for (const [id, t] of [...timers]) {
      timers.delete(id);
      t.fn();
    }
  };

  test("every intent has its own icon and haptic", () => {
    expect(TOAST_STATUS.success.haptic).toBe("light");
    expect(TOAST_STATUS.error.haptic).toBe("error");
    expect(TOAST_STATUS.warning.haptic).toBe("warning");
    expect(TOAST_STATUS.info.haptic).toBe("none");
    expect(TOAST_STATUS.success.ios).not.toBe(TOAST_STATUS.error.ios);
    expect(TOAST_STATUS.success.ios).not.toBe(TOAST_STATUS.warning.ios);
  });

  test("a success toast plays the light haptic, an info toast stays silent", () => {
    const { controller, haptics } = setup();
    controller.show("Copied", { intent: "success" });
    expect(controller.snapshot()?.intent).toBe("success");
    expect(haptics).toEqual(["light"]);
    controller.show("Waking the agent…", { intent: "info" });
    expect(haptics).toEqual(["light"]);
  });

  test("haptic: false keeps a passive error quiet", () => {
    const { controller, haptics } = setup();
    controller.show("Machines unavailable", { intent: "error", haptic: false });
    expect(controller.snapshot()?.intent).toBe("error");
    expect(haptics).toEqual([]);
  });

  test("only error toasts get the transport rewrite", () => {
    const { controller } = setup();
    controller.show("fetch failed", { intent: "error" });
    expect(controller.snapshot()?.message).toBe("Connection lost. Check your network and try again.");
    controller.show("fetch failed", { intent: "info" });
    expect(controller.snapshot()?.message).toBe("fetch failed");
  });

  test("an empty message shows nothing", () => {
    const { controller, haptics } = setup();
    expect(controller.show("   ", { intent: "success" })).toBeUndefined();
    expect(controller.snapshot()).toBeNull();
    expect(haptics).toEqual([]);
  });

  test("a repeat of the visible toast restarts the clock without a second haptic", () => {
    const { controller, haptics } = setup();
    const first = controller.show("Copied", { intent: "success" });
    const before = [...timers.keys()];
    expect(controller.show("Copied", { intent: "success" })).toBe(first);
    expect(haptics).toEqual(["light"]);
    expect([...timers.keys()]).not.toEqual(before);
    expect(timers.size).toBe(1);
  });

  test("auto-dismiss scales with reading length and is bounded", () => {
    const { controller } = setup();
    controller.show("Saved.", { intent: "success" });
    expect(controller.snapshot()?.duration).toBe(2200);
    controller.show(Array(40).fill("word").join(" "), { intent: "error" });
    expect(controller.snapshot()?.duration).toBe(7000);
    controller.show("Quick", { intent: "info", duration: 10 });
    expect(controller.snapshot()?.duration).toBe(1000);
  });

  test("the timer dismisses only the toast it was armed for", () => {
    const { controller } = setup();
    controller.show("First", { intent: "info" });
    const armed = [...timers.values()];
    controller.show("Second", { intent: "info" });
    expect(timers.size).toBe(1);
    armed[0]?.fn();
    expect(controller.snapshot()?.message).toBe("Second");
    fireAll();
    expect(controller.snapshot()).toBeNull();
  });

  test("dismiss with a stale id is ignored", () => {
    const { controller } = setup();
    const first = controller.show("First", { intent: "info" });
    controller.show("Second", { intent: "info" });
    controller.dismiss(first);
    expect(controller.snapshot()?.message).toBe("Second");
    controller.dismiss();
    expect(controller.snapshot()).toBeNull();
    expect(timers.size).toBe(0);
  });

  test("pause holds the toast while a finger is on it, resume re-arms it", () => {
    const { controller } = setup();
    const id = controller.show("Hold me", { intent: "warning" })!;
    controller.pause(id);
    expect(timers.size).toBe(0);
    fireAll();
    expect(controller.snapshot()?.message).toBe("Hold me");
    controller.resume(id);
    expect(timers.size).toBe(1);
    fireAll();
    expect(controller.snapshot()).toBeNull();
  });

  test("reset clears state and the pending timer on unmount", () => {
    const { controller, changes } = setup();
    controller.show("Bye", { intent: "info" });
    const seen = changes();
    controller.reset();
    expect(controller.snapshot()).toBeNull();
    expect(timers.size).toBe(0);
    expect(changes()).toBe(seen + 1);
  });
});
