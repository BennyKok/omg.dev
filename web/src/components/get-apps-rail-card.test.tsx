import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import * as qr from "uqr";
const { GetAppsRailCard, IOS_APP_STORE_URL } = await import("./pwa-install");

let ui: Mounted;
beforeEach(() => {
  window.localStorage.removeItem("lfg_get_apps_card_dismissed");
  ui = mount();
});
afterEach(() => ui.cleanup());

test("encodes the phone QR only when opened and reuses it across parent updates", async () => {
  const encode = spyOn(qr, "renderSVG");
  try {
    ui.render(<GetAppsRailCard />);
    ui.render(<GetAppsRailCard />);
    expect(encode).not.toHaveBeenCalled();
    expect(ui.text()).toContain("Get the apps");
    const iphone = ui.queryAll("button").find((b) => b.textContent?.includes("Use on your phone")) as HTMLButtonElement;
    expect(iphone).toBeTruthy();
    ui.flush(() => iphone.click());
    await ui.flushAsync();
    const popover = document.querySelector('[data-testid="ios-app-popover"]');
    expect(popover?.querySelector("img")?.getAttribute("src")).toStartWith("data:image/svg+xml");
    expect(popover?.querySelector("a")?.getAttribute("href")).toBe(IOS_APP_STORE_URL);
    expect(encode).toHaveBeenCalledTimes(1);
    ui.render(<GetAppsRailCard />);
    ui.render(<GetAppsRailCard />);
    expect(encode).toHaveBeenCalledTimes(1);
  } finally {
    encode.mockRestore();
  }
});

test("dismissing hides the card and is remembered", () => {
  ui.render(<GetAppsRailCard />);
  ui.flush(() => (ui.query('button[aria-label="Dismiss the apps card"]') as HTMLButtonElement).click());
  expect(ui.query('[data-testid="get-apps-card"]')).toBeNull();
  ui.remount();
  ui.render(<GetAppsRailCard />);
  expect(ui.query('[data-testid="get-apps-card"]')).toBeNull();
});
