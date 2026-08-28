import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

const { RemoteAccessSettingsSection } = await import("./remote-access-settings");

let ui: Mounted;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  ui = mount();
});

afterEach(() => {
  ui.cleanup();
  globalThis.fetch = originalFetch;
});

function respond(access: Record<string, unknown>) {
  globalThis.fetch = (async () => Response.json({ access })) as typeof fetch;
}

describe("RemoteAccessSettingsSection", () => {
  test("shows the active self-hosted local and Tailscale URLs", async () => {
    respond({
      runtime: "self-hosted",
      localUrl: "http://127.0.0.1:8766",
      tailscale: {
        installed: true,
        connected: true,
        dnsName: "computer.example.ts.net",
        serveEnabled: true,
        serveUrl: "https://computer.example.ts.net",
        command: "tailscale serve --bg localhost:8766",
      },
    });

    ui.render(<RemoteAccessSettingsSection />);
    await ui.flushAsync();

    expect(ui.text()).toContain("Remote access");
    expect(ui.text()).toContain("http://127.0.0.1:8766");
    expect(ui.text()).toContain("https://computer.example.ts.net");
    expect(ui.text()).toContain("Active");
    expect(ui.query('a[href="https://computer.example.ts.net"]')).not.toBeNull();
  });

  test("shows the setup command when Tailscale Serve is not active", async () => {
    respond({
      runtime: "self-hosted",
      localUrl: "http://127.0.0.1:9000",
      tailscale: {
        installed: true,
        connected: true,
        dnsName: "computer.example.ts.net",
        serveEnabled: false,
        serveUrl: null,
        command: "tailscale serve --bg localhost:9000",
      },
    });

    ui.render(<RemoteAccessSettingsSection />);
    await ui.flushAsync();

    expect(ui.text()).toContain("tailscale serve --bg localhost:9000");
    expect(ui.text()).toContain("After setup: https://computer.example.ts.net");
  });

  test("does not advertise the desktop-owned private runtime", async () => {
    respond({
      runtime: "desktop",
      localUrl: "http://127.0.0.1:62280",
      tailscale: {
        installed: true,
        connected: true,
        dnsName: "computer.example.ts.net",
        serveEnabled: false,
        serveUrl: null,
        command: "tailscale serve --bg localhost:62280",
      },
    });

    ui.render(<RemoteAccessSettingsSection />);
    await ui.flushAsync();

    expect(ui.text()).toBe("");
  });
});
