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

test("a failed computer dims the app with Boxy, Retry, and the computer switcher", () => {
  let retried = 0;
  ui = mount();
  ui.render(view({ ...base, status: "reconnecting", lifecycle: "unavailable", retry: () => { retried++; } }));
  const el = overlay()!;
  expect(el.getAttribute("data-connection-overlay")).toBe("overlay");
  expect(el.querySelector("[data-boxy-mood]")?.getAttribute("data-boxy-mood")).toBe("error");
  expect(el.textContent).toContain("Computer unavailable");
  expect(el.textContent).toContain("Switch computer");
  const retry = [...el.querySelectorAll("button")].find((b) => b.textContent === "Retry")!;
  ui.flush(() => retry.click());
  expect(retried).toBe(1);
});

test("the recovery smiles in the same place, then fades out", async () => {
  ui = mount();
  ui.render(view({ ...base, status: "reconnecting", lifecycle: "unavailable" }));
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

test("the card is not unmounted between the wait and Connected", async () => {
  ui = mount();
  ui.render(view({ ...base, status: "reconnecting", lifecycle: "unavailable" }));
  const waiting = overlay();
  ui.render(view(base));
  await ui.flushAsync();
  // The same node: no frame with nothing on screen, no second fade-in.
  expect(overlay()).toBe(waiting);
  expect(overlay()?.textContent).toContain("Connected");
});

test("the first bootstrap appears after a short wait", async () => {
  ui = mount();
  ui.render(view({ ...base, loading: true, ready: false, status: "connecting" }));
  expect(overlay()).toBeNull();
  await ui.flushAsync(() => sleep(700));
  expect(overlay()?.textContent).toContain("Connecting…");
  expect([...overlay()!.querySelectorAll("button")].some((b) => b.textContent === "Retry")).toBe(false);
});

test("a flap right after recovery cannot leave Connected on screen", async () => {
  ui = mount();
  ui.render(view({ ...base, status: "reconnecting", lifecycle: "unavailable" }));
  ui.render(view(base));
  await ui.flushAsync();
  expect(overlay()?.textContent).toContain("Connected");
  // The runtime reloads its bootstrap at once: briefly not ready, then live.
  ui.render(view({ ...base, ready: false, loading: true }));
  await ui.flushAsync();
  ui.render(view(base));
  await ui.flushAsync(() => sleep(1_400));
  expect(overlay()).toBeNull();
});

test("the first load shows the card, says Connected, then closes", async () => {
  ui = mount();
  ui.render(view({ ...base, loading: true, ready: false, status: "connecting" }));
  await ui.flushAsync(() => sleep(700));
  expect(overlay()?.textContent).toContain("Connecting…");
  // Bootstrap answers, then the socket connects.
  ui.render(view({ ...base, status: "connecting" }));
  ui.render(view(base));
  await ui.flushAsync();
  expect(overlay()?.textContent).toContain("Connected");
  // The first connection retries the bootstrap once: a brief flap.
  ui.render(view({ ...base, ready: false, loading: true }));
  await ui.flushAsync();
  ui.render(view(base));
  await ui.flushAsync();
  // The flap does not cut the Connected moment short.
  expect(overlay()?.textContent).toContain("Connected");
  await ui.flushAsync(() => sleep(1_400));
  expect(overlay()).toBeNull();
});

test("still connecting shows Boxy with no Retry and no switcher", async () => {
  ui = mount();
  ui.render(view({ ...base, status: "connecting", loading: true, ready: false }));
  await ui.flushAsync(() => sleep(700));
  const el = overlay()!;
  expect(el.textContent).toContain("Connecting…");
  expect(el.textContent).not.toContain("Retry");
  expect(el.textContent).not.toContain("Switch computer");
});

test("one Boxy moves from the card to the pill and back", async () => {
  ui = mount();
  ui.render(view({ ...base, status: "reconnecting", lifecycle: "unavailable" }));
  const mascot = overlay()!.querySelector("[data-boxy-mood]");
  expect(mascot).not.toBeNull();
  ui.render(view({ ...base, status: "reconnecting", lifecycle: "waking" }));
  await ui.flushAsync();
  expect(overlay()?.getAttribute("data-connection-overlay")).toBe("pill");
  expect(overlay()?.querySelector("[data-boxy-mood]") === mascot).toBe(true);
  expect(mascot?.parentElement?.style.transform).toContain("scale(0.35)");
  expect(overlay()?.querySelectorAll("[data-boxy-mood]").length).toBe(1);
  ui.render(view({ ...base, status: "reconnecting", lifecycle: "unavailable" }));
  expect(overlay()?.getAttribute("data-connection-overlay")).toBe("overlay");
  expect(overlay()?.querySelector("[data-boxy-mood]") === mascot).toBe(true);
  expect(mascot?.parentElement?.style.transform).toContain("scale(1)");
  ui.render(view(base));
  expect(overlay()?.querySelector("[data-boxy-mood]") === mascot).toBe(true);
  expect(mascot?.getAttribute("data-boxy-mood")).toBe("happy");
});

test("an intermittent offline event does not flash a blocking dialog", async () => {
  ui = mount();
  ui.render(view(base));
  ui.render(view({ ...base, status: "offline" }));
  expect(overlay()).toBeNull();
  ui.render(view(base));
  await ui.flushAsync();
  expect(overlay()).toBeNull();
});

test("a dialog closes after socket recovery even with an older error still stored", async () => {
  ui = mount();
  ui.render(view({ ...base, status: "reconnecting", lifecycle: "unavailable", error: "old 503" }));
  expect(overlay()?.getAttribute("data-connection-overlay")).toBe("overlay");
  ui.render(view({ ...base, error: "old 503" }));
  expect(overlay()?.textContent).toContain("Connected");
  await ui.flushAsync(() => sleep(1_400));
  expect(overlay()).toBeNull();
});
