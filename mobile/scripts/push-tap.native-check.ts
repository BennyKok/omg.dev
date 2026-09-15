/**
 * The notification-tap navigation rule.
 *
 * A tap whose target resolved to "/" was pushed like any other path, which
 * stacked a second home screen over the first: the app opened on Home with a
 * back chevron and a ghost page behind it. Caught on a device, not by a check.
 */
import { expect, test } from "bun:test";
import { notificationTapAction } from "../src/omg/notification-tap";

test("a target-less tap pops to the existing home instead of stacking a new one", () => {
  // Every branch of toNativeAppUrl() that gives up resolves to exactly this.
  expect(notificationTapAction("/")).toEqual({ kind: "dismissTo", path: "/" });
});

test("a real target is still pushed, so back returns to where you were", () => {
  expect(notificationTapAction("/session/abc")).toEqual({ kind: "push", path: "/session/abc" });
  expect(notificationTapAction("/notifications")).toEqual({ kind: "push", path: "/notifications" });
});

test("anything that is not an app-relative path is ignored", () => {
  for (const url of [undefined, null, 42, "", "https://omg.dev/session/abc", "omg:///session/abc", "session/abc"]) {
    expect(notificationTapAction(url)).toEqual({ kind: "ignore" });
  }
});
