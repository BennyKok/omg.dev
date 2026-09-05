import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

const { MachineRail } = await import("./machine-rail");
const { MACHINE_STORAGE_KEY } = await import("../lib/machines");

let ui: Mounted;
const originalFetch = globalThis.fetch;

// The storage the component reads: whatever window is global when it runs.
// Another test file may have swapped the global window, so resolve it late.
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
    { slug: "computer-old", name: "old-box", kind: "connected", online: false, status: "offline", isDefault: false },
  ],
  defaultComputer: "62494ca7-db41",
};

describe("MachineRail", () => {
  test("renders nothing when signed out", async () => {
    respond({ "/api/cloud/session": () => Response.json({ ...signedIn, signedIn: false }) });
    ui.render(<MachineRail />);
    await ui.flushAsync();
    expect(ui.query("[data-machine-rail]")).toBeNull();
  });

  test("lists this computer first, then every machine the box can reach", async () => {
    respond({
      "/api/cloud/session": () => Response.json(signedIn),
      "/api/cloud/computers": () => Response.json(computers),
    });
    ui.render(<MachineRail />);
    await ui.flushAsync();
    const buttons = ui.queryAll("[data-machine-rail] button") as HTMLButtonElement[];
    // old-box has no bindingId on this server, so it cannot be reached.
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "This computer",
      "Cloud computer · Paused",
      "dev-us · Online",
    ]);
    expect(buttons[0]?.getAttribute("aria-current")).toBe("true");
  });

  test("clicking a machine selects it and the stored choice is marked current", async () => {
    respond({
      "/api/cloud/session": () => Response.json(signedIn),
      "/api/cloud/computers": () => Response.json(computers),
    });
    const chosen: Array<{ id: string; name: string }> = [];
    ui.render(<MachineRail onSelect={(choice) => chosen.push(choice)} />);
    await ui.flushAsync();
    const buttons = ui.queryAll("[data-machine-rail] button") as HTMLButtonElement[];
    ui.flush(() => buttons[2]!.click());
    expect(chosen).toEqual([{ id: "62494ca7-db41", name: "dev-us" }]);

    ui.flush(() => buttons[0]!.click());
    expect(chosen).toHaveLength(1);

    store().setItem(MACHINE_STORAGE_KEY, JSON.stringify({ id: "cloud", name: "Cloud computer" }));
    ui.cleanup();
    ui = mount();
    ui.render(<MachineRail />);
    await ui.flushAsync();
    const again = ui.queryAll("[data-machine-rail] button") as HTMLButtonElement[];
    expect(again[1]?.getAttribute("aria-current")).toBe("true");
    expect(again[0]?.getAttribute("aria-current")).toBeNull();
  });
});
