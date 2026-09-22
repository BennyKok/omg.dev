import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { classifySystemMessage } from "../lib/system-message";

const { SystemMessageLine } = await import("./system-message-line");

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

describe("SystemMessageLine", () => {
  test("a fork opener is a label, not the raw launch prompt", () => {
    const raw = [
      "You are starting a fresh agent session from an existing omg.dev session.",
      "",
      "Source session id: 542a7801-118e-4740-a8df-eb9b1ded1fd5",
      "Source title: Show coding agent icons",
      "",
      "User's extra prompt:",
      "Finish the picker.",
    ].join("\n");
    const system = classifySystemMessage(raw)!;
    ui.render(<SystemMessageLine system={system} raw={raw} />);
    expect(ui.text()).toContain("Started from Show coding agent icons");
    expect(ui.text()).toContain("542a7801");
    expect(ui.text()).toContain("Finish the picker.");
    expect(ui.text()).not.toContain("You are starting a fresh agent session");
  });

  test("a login transfer names the site instead of quoting the cookie warning", () => {
    const raw =
      "[Browser login 841fe13e-e60a-43e4-9cf5-8338179ae574] The user approved a login transfer for " +
      "https://accounts.hetzner.com to the shared Computer browser. Cookies were imported. Verify the " +
      "protected page with Computer tools before continuing; imported cookies alone do not prove authentication.";
    const system = classifySystemMessage(raw)!;
    ui.render(<SystemMessageLine system={system} raw={raw} />);
    expect(ui.text()).toContain("Signed in to accounts.hetzner.com");
    expect(ui.text()).toContain("841fe13e");
    expect(ui.text()).not.toContain("[Browser login");
  });

  test("clicking the line reveals the full body", async () => {
    const raw = "[Background task ios app · 542a7801]\n\nExact shipping tip is 0964f06ea.";
    const system = classifySystemMessage(raw)!;
    ui.render(<SystemMessageLine system={system} raw={raw} />);
    expect(ui.text()).toContain("ios app reported in");
    expect(ui.text()).not.toContain("[Background task");
    const open = ui.query("button[aria-expanded]") as HTMLButtonElement;
    expect(open.getAttribute("aria-expanded")).toBe("false");
    await ui.flushAsync(() => open.click());
    expect(open.getAttribute("aria-expanded")).toBe("true");
    expect(ui.text()).toContain("Exact shipping tip is 0964f06ea.");
  });
});
