import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

const { MachineSwitcher } = await import("./machine-switcher");
const { MACHINE_STORAGE_KEY } = await import("../lib/machines");

let ui: Mounted;
const originalFetch = globalThis.fetch;

// The storage the component reads: whatever window is global when it runs.
const store = () => (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage;

beforeEach(() => {
  ui = mount();
  store().removeItem(MACHINE_STORAGE_KEY);
});

afterEach(() => {
  ui.cleanup();
  globalThis.fetch = originalFetch;
  store().removeItem(MACHINE_STORAGE_KEY);
});

function respond(routes: Record<string, () => Response>) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    return routes[url]?.() ?? Response.json({ error: "not found" }, { status: 404 });
  }) as typeof fetch;
}

const signedIn = { signedIn: true, email: "ada@example.com", expiresAt: null, kind: "oauth", authUrl: "" };
const computers = {
  computers: [
    { slug: "cloud", name: "Cloud computer", kind: "cloud", online: false, status: "paused", isDefault: false },
    {
      slug: "computer-62494ca7",
      name: "dev-us",
      kind: "connected",
      online: true,
      status: "live",
      isDefault: true,
      bindingId: "62494ca7-db41",
    },
  ],
  defaultComputer: "62494ca7-db41",
};

describe("MachineSwitcher", () => {
  test("renders nothing when signed out or when no machine is reachable", async () => {
    respond({ "/api/cloud/session": () => Response.json({ ...signedIn, signedIn: false }) });
    ui.render(<MachineSwitcher variant="rail" />);
    await ui.flushAsync();
    expect(ui.query("[data-machine-switcher]")).toBeNull();

    ui.cleanup();
    ui = mount();
    respond({
      "/api/cloud/session": () => Response.json(signedIn),
      "/api/cloud/computers": () => Response.json({ computers: [], defaultComputer: "cloud" }),
    });
    ui.render(<MachineSwitcher variant="icon" />);
    await ui.flushAsync();
    expect(ui.query("[data-machine-switcher]")).toBeNull();
  });

  test("the rail row names the current machine and the icon variant carries it as a label", async () => {
    respond({
      "/api/cloud/session": () => Response.json(signedIn),
      "/api/cloud/computers": () => Response.json(computers),
    });
    ui.render(<MachineSwitcher variant="rail" />);
    await ui.flushAsync();
    const rail = ui.query('[data-machine-switcher="rail"]');
    expect(rail?.textContent).toContain("This computer");

    store().setItem(MACHINE_STORAGE_KEY, JSON.stringify({ id: "cloud", name: "Cloud computer" }));
    ui.cleanup();
    ui = mount();
    ui.render(<MachineSwitcher variant="icon" />);
    await ui.flushAsync();
    const icon = ui.query('[data-machine-switcher="icon"]');
    expect(icon?.getAttribute("aria-label")).toBe("Machine: Cloud computer. Change machine");
    expect(icon?.textContent).toBe("");
  });

  test("the box's own account row is not listed a second time", async () => {
    respond({
      "/api/cloud/session": () => Response.json({ ...signedIn, thisBoxId: "62494ca7-db41" }),
      "/api/cloud/computers": () => Response.json(computers),
    });
    // Point the UI at the cloud machine so the rail row reads its name, and
    // the only other reachable machine (dev-us) is this box itself.
    store().setItem(MACHINE_STORAGE_KEY, JSON.stringify({ id: "cloud", name: "Cloud computer" }));
    ui.render(<MachineSwitcher variant="rail" />);
    await ui.flushAsync();
    expect(ui.query('[data-machine-switcher="rail"]')?.textContent).toContain("Cloud computer");

    ui.cleanup();
    ui = mount();
    store().removeItem(MACHINE_STORAGE_KEY);
    respond({
      "/api/cloud/session": () => Response.json({ ...signedIn, thisBoxId: "62494ca7-db41" }),
      "/api/cloud/computers": () =>
        Response.json({ computers: [computers.computers[1]], defaultComputer: "62494ca7-db41" }),
    });
    ui.render(<MachineSwitcher variant="rail" />);
    await ui.flushAsync();
    // dev-us was the only account machine and it is this box: nothing to switch to.
    expect(ui.query("[data-machine-switcher]")).toBeNull();
  });

  test("a collapsed rail row shows the icon alone", async () => {
    respond({
      "/api/cloud/session": () => Response.json(signedIn),
      "/api/cloud/computers": () => Response.json(computers),
    });
    ui.render(<MachineSwitcher variant="rail" collapsed />);
    await ui.flushAsync();
    const rail = ui.query('[data-machine-switcher="rail"]');
    expect(rail?.textContent).toBe("");
    expect(rail?.getAttribute("title")).toBe("This computer");
  });
});
