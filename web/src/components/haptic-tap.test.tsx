import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import React from "react";
import { mount, type Mounted } from "../test-support/render";

const { HapticTap } = await import("./haptic-tap");
const { setUiFeedbackPrefs } = await import("@/lib/ui-feedback-prefs");

// happy-dom is a desktop with no native switch. Make it look like an iPhone:
// switch support, a coarse pointer and no Vibration API. Stub the globals the
// component reads, which other test files in the same run may have replaced.
const g = globalThis as unknown as { window: Window; navigator: Navigator; HTMLInputElement: typeof HTMLInputElement };
let proto: Record<string, unknown>;
let window: Window;
let originalMatchMedia: Window["matchMedia"];
let originalVibrate: PropertyDescriptor | undefined;

beforeAll(() => {
  window = g.window;
  proto = g.HTMLInputElement.prototype as unknown as Record<string, unknown>;
  originalMatchMedia = window.matchMedia;
  originalVibrate = Object.getOwnPropertyDescriptor(g.navigator, "vibrate");
  setUiFeedbackPrefs({ haptics: true });
  proto.switch = false;
  (window as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
    matches: query === "(pointer: coarse)",
    media: query,
    addEventListener() {},
    removeEventListener() {},
  });
  Object.defineProperty(g.navigator, "vibrate", { value: undefined, configurable: true });
});

afterAll(() => {
  delete proto.switch;
  (window as unknown as { matchMedia: unknown }).matchMedia = originalMatchMedia;
  if (originalVibrate) Object.defineProperty(g.navigator, "vibrate", originalVibrate);
  else delete (g.navigator as unknown as Record<string, unknown>).vibrate;
});

let ui: Mounted;
afterEach(() => {
  ui?.cleanup();
  setUiFeedbackPrefs({ haptics: true });
});

const cover = () => ui.query("input[data-haptic-tap]") as HTMLInputElement | null;

describe("HapticTap on an iPhone", () => {
  test("lays a native switch over the button, and the tap still runs the button", () => {
    ui = mount();
    let taps = 0;
    ui.render(
      <button type="button" onClick={() => (taps += 1)}>
        Send
        <HapticTap />
      </button>,
    );
    const input = cover();
    expect(input).not.toBeNull();
    expect(input!.getAttribute("switch")).toBe("");
    expect(input!.getAttribute("aria-hidden")).toBe("true");
    ui.flush(() => input!.click());
    expect(taps).toBe(1);
  });

  test("submits the form of a submit button, once", async () => {
    ui = mount();
    let submits = 0;
    ui.render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submits += 1;
        }}
      >
        <button type="submit">
          Start
          <HapticTap />
        </button>
      </form>,
    );
    await ui.flushAsync(async () => {
      cover()!.click();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(submits).toBe(1);
  });

  test("does not submit when a handler cancelled the click", async () => {
    ui = mount();
    let submits = 0;
    ui.render(
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submits += 1;
        }}
      >
        <button type="submit" onClick={(e) => e.preventDefault()}>
          Start
          <HapticTap />
        </button>
      </form>,
    );
    await ui.flushAsync(async () => {
      cover()!.click();
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    expect(submits).toBe(0);
  });

  test("a disabled button gets no switch, so it cannot buzz", () => {
    ui = mount();
    ui.render(
      <button type="button" disabled>
        Send
        <HapticTap disabled />
      </button>,
    );
    expect(cover()).toBeNull();
  });

  test("turning haptics off in Settings removes the switch", () => {
    ui = mount();
    ui.render(
      <button type="button">
        Send
        <HapticTap />
      </button>,
    );
    expect(cover()).not.toBeNull();
    ui.flush(() => setUiFeedbackPrefs({ haptics: false }));
    expect(cover()).toBeNull();
  });
});
