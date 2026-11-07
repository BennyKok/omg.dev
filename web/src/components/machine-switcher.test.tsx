import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

const { MachineSwitcher } = await import("./machine-switcher");
const { EmbeddedHostOptionsProvider } = await import("../lib/embedded-host-options");

let ui: Mounted;
const originalFetch = globalThis.fetch;
let fetches = 0;

beforeEach(() => {
  ui = mount();
  fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    return Response.json({}, { status: 404 });
  }) as typeof fetch;
});

afterEach(() => {
  ui.cleanup();
  globalThis.fetch = originalFetch;
});

// omg.dev is local software: on its own it runs on this computer only, so
// there is no machine to switch to and no account to ask.
test("a local install shows no switcher and asks no server", async () => {
  ui.render(<MachineSwitcher variant="rail" />);
  await ui.flushAsync();
  expect(ui.query("[data-machine-switcher]")).toBeNull();
  expect(fetches).toBe(0);
});

test("a host page's machine list is drawn without asking the box", async () => {
  ui.render(
    <EmbeddedHostOptionsProvider
      value={{
        defaultAgent: "aisdk",
        connectionOnboarding: true,
        machines: {
          machines: [
            { id: "local", name: "This laptop", kind: "local" },
            { id: "b-1", name: "studio", kind: "connected", online: false, status: "offline" },
          ],
          activeId: "b-1",
          onSelect: () => {},
        },
      }}
    >
      <MachineSwitcher variant="rail" />
    </EmbeddedHostOptionsProvider>,
  );
  await ui.flushAsync();
  expect(fetches).toBe(0);
  const rail = ui.query('[data-machine-switcher="rail"]');
  expect(rail?.textContent).toContain("studio");
  expect(rail?.getAttribute("aria-label")).toBe("Machine: studio. Change machine");
});
