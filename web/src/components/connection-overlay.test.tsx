import { afterEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import type { RuntimeAvailability } from "../lib/runtime-availability";
const { RuntimeAvailabilityContext } = await import("../lib/runtime-availability");
const { ConnectionOverlay } = await import("./connection-overlay");

let ui: Mounted;
afterEach(() => ui?.cleanup());

const base: RuntimeAvailability = {
  status: "live",
  loading: false,
  ready: true,
  error: null,
  lifecycle: null,
  retry: () => {},
};
const overlay = () => document.body.querySelector("[data-connection-overlay]");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function view(value: RuntimeAvailability) {
  return (
    <RuntimeAvailabilityContext.Provider value={value}>
      <ConnectionOverlay machineSwitcher={<button type="button">Switch computer</button>} />
    </RuntimeAvailabilityContext.Provider>
  );
}

test("a live app shows no connection surface", () => {
  ui = mount();
  ui.render(view(base));
  expect(overlay()).toBeNull();
});

test("offline dims the app with Boxy, Retry, and the computer switcher", () => {
  let retried = 0;
  ui = mount();
  ui.render(view({ ...base, status: "offline", retry: () => { retried++; } }));
  const el = overlay()!;
  expect(el.getAttribute("data-connection-overlay")).toBe("overlay");
  expect(el.querySelector("[data-boxy-mood]")?.getAttribute("data-boxy-mood")).toBe("sleeping");
  expect(el.textContent).toContain("Connection unavailable");
  expect(el.textContent).toContain("Switch computer");
  const retry = [...el.querySelectorAll("button")].find((b) => b.textContent === "Retry")!;
  ui.flush(() => retry.click());
  expect(retried).toBe(1);
});

test("the recovery smiles in the same place, then fades out", async () => {
  ui = mount();
  ui.render(view({ ...base, status: "offline" }));
  expect(overlay()?.getAttribute("data-connection-overlay")).toBe("overlay");
  ui.render(view(base));
  await ui.flushAsync();
  const back = overlay()!;
  expect(back.getAttribute("data-connection-overlay")).toBe("overlay");
  expect(back.textContent).toContain("Connected");
  expect(back.querySelector("[data-boxy-mood]")?.getAttribute("data-boxy-mood")).toBe("happy");
  await ui.flushAsync(() => sleep(1_300));
  expect(overlay()).toBeNull();
});

test("the first bootstrap appears after a short wait", async () => {
  ui = mount();
  ui.render(view({ ...base, loading: true, ready: false, status: "connecting" }));
  expect(overlay()).toBeNull();
  await ui.flushAsync(() => sleep(700));
  expect(overlay()?.textContent).toContain("Connecting…");
  expect([...overlay()!.querySelectorAll("button")].some((b) => b.textContent === "Retry")).toBe(false);
});
