/// <reference lib="dom" />
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { _resetUmamiForTest, isUmamiConfigured, trackEvent } from "./umami";

// The requirement this guards: Umami is optional and env-configured (no
// hardcoded site ID or script URL — this repo doesn't own one). Unset env
// must no-op cleanly, and a failing/blocked call must never throw into
// onboarding code that isn't expecting to catch anything.

let win: Window;
const ENV_KEYS = ["VITE_UMAMI_SRC", "VITE_UMAMI_WEBSITE_ID"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  win = new Window();
  globalThis.document = win.document as unknown as Document;
  globalThis.window = win as unknown as typeof globalThis.window;
  _resetUmamiForTest();
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  win.close();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("isUmamiConfigured", () => {
  test("false when neither env var is set", () => {
    expect(isUmamiConfigured()).toBe(false);
  });

  test("false when only one env var is set", () => {
    process.env.VITE_UMAMI_SRC = "https://umami.example/script.js";
    expect(isUmamiConfigured()).toBe(false);
  });

  test("true once both env vars are set", () => {
    process.env.VITE_UMAMI_SRC = "https://umami.example/script.js";
    process.env.VITE_UMAMI_WEBSITE_ID = "site-123";
    expect(isUmamiConfigured()).toBe(true);
  });
});

describe("trackEvent", () => {
  test("no-ops cleanly when unconfigured: no script tag, no throw", () => {
    expect(() => trackEvent("onboarding_survey_identity", { value: "founder" })).not.toThrow();
    expect(win.document.querySelectorAll("script").length).toBe(0);
  });

  test("injects the configured script once and forwards the event once umami is ready", () => {
    process.env.VITE_UMAMI_SRC = "https://umami.example/script.js";
    process.env.VITE_UMAMI_WEBSITE_ID = "site-123";

    const calls: Array<{ name: string; data?: Record<string, unknown> }> = [];
    (win as unknown as { umami: { track: (n: string, d?: Record<string, unknown>) => void } }).umami = {
      track: (name, data) => calls.push({ name, data }),
    };

    trackEvent("onboarding_survey_complete", { identity: "founder" });

    const scripts = win.document.querySelectorAll("script");
    expect(scripts.length).toBe(1);
    expect(scripts[0]?.getAttribute("src")).toBe("https://umami.example/script.js");
    expect(scripts[0]?.getAttribute("data-website-id")).toBe("site-123");
    expect(calls).toEqual([{ name: "onboarding_survey_complete", data: { identity: "founder" } }]);

    // A second call reuses the same script tag rather than injecting another.
    trackEvent("onboarding_survey_identity", { value: "founder" });
    expect(win.document.querySelectorAll("script").length).toBe(1);
    expect(calls.length).toBe(2);
  });

  test("configured but window.umami not ready yet: drops the event, does not throw", () => {
    process.env.VITE_UMAMI_SRC = "https://umami.example/script.js";
    process.env.VITE_UMAMI_WEBSITE_ID = "site-123";

    expect(() => trackEvent("onboarding_survey_identity", { value: "founder" })).not.toThrow();
    // Script gets requested even though tracking is dropped this call.
    expect(win.document.querySelectorAll("script").length).toBe(1);
  });

  test("a throwing umami.track never propagates — fire-and-forget", () => {
    process.env.VITE_UMAMI_SRC = "https://umami.example/script.js";
    process.env.VITE_UMAMI_WEBSITE_ID = "site-123";
    (win as unknown as { umami: { track: () => void } }).umami = {
      track: () => {
        throw new Error("blocked by extension");
      },
    };

    expect(() => trackEvent("onboarding_survey_pain", { value: "waiting" })).not.toThrow();
  });
});
