import { afterEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

const { BankedResetCredits } = await import("./BankedResetCredits");

let ui: Mounted;
afterEach(() => ui?.cleanup());

const detailed = {
  availableCount: 2,
  credits: [{
    id: "credit-1",
    resetType: "codexRateLimits",
    status: "available",
    grantedAt: 1_781_654_400,
    expiresAt: 1_784_246_400,
    title: "Rate-limit reset",
    description: "Reset an eligible Codex rate-limit window.",
  }],
};

describe("banked reset inventory", () => {
  test("shows the authoritative count and exact returned dates", () => {
    ui = mount();
    ui.render(<BankedResetCredits value={detailed} locale="en-GB" timeZone="UTC" />);
    expect(ui.text()).toContain("2 resets available");
    expect(ui.text()).toContain("Expires 17 Jul 2026, 00:00 UTC");
    expect(ui.text()).toContain("Granted 17 Jun 2026, 00:00 UTC");
  });

  test("states when Codex reports fewer detail rows than the total", () => {
    ui = mount();
    ui.render(<BankedResetCredits value={detailed} locale="en-GB" timeZone="UTC" />);
    expect(ui.text()).toContain("1 more reset; Codex did not return their expiry details.");
  });

  test("supports a count-only response and a zero inventory", () => {
    ui = mount();
    ui.render(<BankedResetCredits value={{ availableCount: 3, credits: null }} />);
    expect(ui.text()).toContain("Codex returned the total, but no expiry details.");
    ui.render(<BankedResetCredits value={{ availableCount: 0, credits: [] }} />);
    expect(ui.text()).toContain("No banked resets available.");
  });

  test("offers the selected available reset to its action handler", () => {
    let selected = "";
    ui = mount();
    ui.render(<BankedResetCredits value={detailed} onUse={(credit) => { selected = credit.id ?? ""; }} />);
    const button = ui.query("button") as HTMLButtonElement;
    expect(button.textContent).toContain("Use reset");
    ui.flush(() => button.click());
    expect(selected).toBe("credit-1");
  });
});
