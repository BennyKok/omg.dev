/**
 * A binary without the ExpoWebBrowser native module must fall back to Safari,
 * not crash.
 *
 * This is the check for a real crash on 2026-09-21. `in-app-browser.ts` used
 * to load expo-web-browser with a lazy `require` inside a `try`, which reads
 * like a guard and is not one: Metro's `guardedLoadModule` gives a
 * module-load failure to `ErrorUtils.reportFatalError` instead of throwing it
 * back to the caller, so the `catch` never runs. Tapping Connect on a build
 * whose pods predated the package ended the process with
 * "Cannot find native module 'ExpoWebBrowser'".
 *
 * The guard is now a question to expo-modules-core, which answers null. Both
 * answers are exercised here.
 */
import { afterEach, expect, mock, test } from "bun:test";

const opened: string[] = [];
let openBrowserCalls = 0;

mock.module("react-native", () => ({
  Linking: {
    openURL: async (url: string) => {
      opened.push(url);
    },
  },
}));

mock.module("expo-web-browser", () => ({
  openBrowserAsync: async () => {
    openBrowserCalls += 1;
    return { type: "dismiss" };
  },
  dismissBrowser: () => {},
  WebBrowserPresentationStyle: { PAGE_SHEET: "pageSheet" },
}));

/** Install a fake expo-modules-core whose probe answers `present`. */
function withNativeModule(present: boolean) {
  mock.module("expo-modules-core", () => ({
    requireOptionalNativeModule: (name: string) => (present && name === "ExpoWebBrowser" ? {} : null),
  }));
}

afterEach(() => {
  opened.length = 0;
  openBrowserCalls = 0;
});

/**
 * A fresh module registry per case: `in-app-browser.ts` memoises its answer,
 * which is the whole point of the probe running once.
 */
async function load(present: boolean) {
  withNativeModule(present);
  const path = `../src/omg/in-app-browser?case=${present ? "present" : "absent"}`;
  return (await import(path)) as typeof import("../src/omg/in-app-browser");
}

test("no native module: reports no in-app browser and hands off to Safari", async () => {
  const mod = await load(false);
  expect(mod.hasInAppBrowser()).toBe(false);
  expect(await mod.openSignInPage("https://claude.ai/login")).toBe("external");
  expect(opened).toEqual(["https://claude.ai/login"]);
  expect(openBrowserCalls).toBe(0);
});

test("no native module: dismiss is a no-op rather than a throw", async () => {
  const mod = await load(false);
  expect(() => mod.dismissSignInPage()).not.toThrow();
});

test("native module present: opens in the app and waits for the sheet to close", async () => {
  const mod = await load(true);
  expect(mod.hasInAppBrowser()).toBe(true);
  expect(await mod.openSignInPage("https://claude.ai/login")).toBe("closed");
  expect(openBrowserCalls).toBe(1);
  expect(opened).toEqual([]);
});
