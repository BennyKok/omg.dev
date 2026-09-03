import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

const { ExecutorSettingsSection } = await import("./executor-settings");

let ui: Mounted;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  ui = mount();
});

afterEach(() => {
  ui.cleanup();
  globalThis.fetch = originalFetch;
});

const BASE = {
  enabled: true,
  installed: true,
  binary: "/usr/bin/executor",
  installCommand: "npm install -g executor",
  running: true,
  origin: "http://127.0.0.1:4788",
  pid: 42,
  startedAt: 1,
  error: null,
};

function respond(status: Record<string, unknown>) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/api/executor/status")) return Response.json(status);
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("ExecutorSettingsSection", () => {
  test("shows a running gateway with the dashboard button", async () => {
    respond(BASE);
    ui.render(<ExecutorSettingsSection enabled onEnabledChange={async () => {}} />);
    await ui.flushAsync();

    expect(ui.text()).toContain("Connectors");
    expect(ui.text()).toContain("Running");
    expect(ui.text()).toContain("http://127.0.0.1:4788");
    expect(ui.text()).toContain("Open dashboard");
    expect(ui.text()).not.toContain("npm install -g executor");
  });

  test("shows the install command when the binary is missing", async () => {
    respond({ ...BASE, installed: false, binary: null, running: false, origin: null, pid: null });
    ui.render(<ExecutorSettingsSection enabled onEnabledChange={async () => {}} />);
    await ui.flushAsync();

    expect(ui.text()).toContain("Not installed");
    expect(ui.text()).toContain("npm install -g executor");
    expect(ui.text()).not.toContain("Open dashboard");
  });

  test("shows off when disabled and reports the toggle", async () => {
    respond({ ...BASE, enabled: false, running: false, origin: null });
    const seen: boolean[] = [];
    ui.render(
      <ExecutorSettingsSection
        enabled={false}
        onEnabledChange={async (next) => {
          seen.push(next);
        }}
      />,
    );
    await ui.flushAsync();

    expect(ui.text()).toContain("Off.");
    const toggle = ui.query('[role="switch"]') as HTMLElement | null;
    expect(toggle).not.toBeNull();
    toggle!.click();
    await ui.flushAsync();
    expect(seen).toEqual([true]);
  });

  test("renders nothing on a server without the gateway", async () => {
    globalThis.fetch = (async () => new Response("nope", { status: 404 })) as typeof fetch;
    ui.render(<ExecutorSettingsSection enabled onEnabledChange={async () => {}} />);
    await ui.flushAsync();
    expect(ui.text()).not.toContain("Connectors");
  });
});
