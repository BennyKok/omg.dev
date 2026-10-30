import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import * as qr from "uqr";
const { GetAppsRailCard, PHONE_INSTALL_URL } = await import("./pwa-install");

let ui: Mounted;
beforeEach(() => {
  window.localStorage.removeItem("lfg_get_apps_card_dismissed");
  ui = mount();
});
afterEach(() => ui.cleanup());

test("the phone popup is the web app for iPhone and Android, encoded once", async () => {
  const encode = spyOn(qr, "renderSVG");
  try {
    ui.render(<GetAppsRailCard />);
    ui.render(<GetAppsRailCard />);
    expect(encode).not.toHaveBeenCalled();
    expect(ui.text()).toContain("Install omg");
    const phone = ui.queryAll("button").find((b) => b.textContent?.includes("Install on your phone")) as HTMLButtonElement;
    expect(phone).toBeTruthy();
    ui.flush(() => phone.click());
    await ui.flushAsync();
    const popover = document.querySelector('[data-testid="phone-install-popover"]');
    expect(popover?.querySelector("img")?.getAttribute("src")).toStartWith("data:image/svg+xml");
    expect(encode).toHaveBeenCalledTimes(1);
    expect(encode.mock.calls[0]?.[0]).toBe(PHONE_INSTALL_URL);
    // Home screen steps for both phones, and no app store anywhere.
    expect(popover?.textContent).toContain("Add to Home Screen");
    expect(popover?.textContent).toContain("Install app");
    expect(popover?.innerHTML).not.toContain("apps.apple.com");
    expect(popover?.innerHTML).not.toContain("play.google.com");
    ui.render(<GetAppsRailCard />);
    ui.render(<GetAppsRailCard />);
    expect(encode).toHaveBeenCalledTimes(1);
  } finally {
    encode.mockRestore();
  }
});

test("dismissing hides the card and is remembered", () => {
  ui.render(<GetAppsRailCard />);
  ui.flush(() => (ui.query('button[aria-label="Dismiss the install card"]') as HTMLButtonElement).click());
  expect(ui.query('[data-testid="get-apps-card"]')).toBeNull();
  ui.remount();
  ui.render(<GetAppsRailCard />);
  expect(ui.query('[data-testid="get-apps-card"]')).toBeNull();
});
