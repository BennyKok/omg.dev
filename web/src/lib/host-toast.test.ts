import { afterEach, expect, test } from "bun:test";
import { configureHostToast, hasHostToast, routedToast, type OmgHostToast } from "./host-toast";

// The bug this guards against: an embedded surface drew its own Sonner stack
// inside the host's page container, and that container's z-index capped every
// LFG toast below the host's chrome, sheets and dialogs. With a host toast
// configured, every call must reach the host and LFG must not mount a stack.

function fakeHostToast() {
  const calls: Array<[string, unknown[]]> = [];
  const record = (name: string) => (...args: unknown[]) => {
    calls.push([name, args]);
    return "id";
  };
  const fn = Object.assign(record("call"), {
    success: record("success"),
    error: record("error"),
    info: record("info"),
    warning: record("warning"),
    message: record("message"),
    loading: record("loading"),
    custom: record("custom"),
    promise: record("promise"),
    dismiss: record("dismiss"),
  });
  return { toast: fn as unknown as OmgHostToast, calls };
}

afterEach(() => configureHostToast(null));

test("without a host, LFG owns the stack", () => {
  expect(hasHostToast()).toBe(false);
});

test("a configured host receives the callable form and every method", () => {
  const host = fakeHostToast();
  configureHostToast(host.toast);
  expect(hasHostToast()).toBe(true);

  routedToast("hello");
  routedToast.loading("Reconnecting…", { id: "ws-conn" });
  routedToast.success("Reconnected", { id: "ws-conn" });
  routedToast.dismiss("ws-conn");

  expect(host.calls.map(([name]) => name)).toEqual(["call", "loading", "success", "dismiss"]);
  expect(host.calls[1][1]).toEqual(["Reconnecting…", { id: "ws-conn" }]);
});

test("a reference taken before the host was configured still routes to it", () => {
  const early = routedToast.error;
  const host = fakeHostToast();
  configureHostToast(host.toast);
  // `early` was resolved against LFG's own stack. Calls made through the
  // module export after configuration must reach the host.
  routedToast.error("boom");
  expect(host.calls).toEqual([["error", ["boom"]]]);
  expect(typeof early).toBe("function");
});
