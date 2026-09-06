import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

const { MachineSwitcher } = await import("./machine-switcher");
const { MACHINE_STORAGE_KEY } = await import("../lib/machines");
const { EmbeddedHostOptionsProvider } = await import("../lib/embedded-host-options");

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
  test("offers a machine menu when signed out or when no machine is reachable", async () => {
    respond({ "/api/cloud/session": () => Response.json({ ...signedIn, signedIn: false }) });
    ui.render(<MachineSwitcher variant="rail" />);
    await ui.flushAsync();
    expect(ui.query("[data-machine-switcher]")).not.toBeNull();

    ui.cleanup();
    ui = mount();
    respond({
      "/api/cloud/session": () => Response.json(signedIn),
      "/api/cloud/computers": () => Response.json({ computers: [], defaultComputer: "cloud" }),
    });
    ui.render(<MachineSwitcher variant="icon" />);
    await ui.flushAsync();
    expect(ui.query("[data-machine-switcher]")).not.toBeNull();
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
    expect(ui.query("[data-machine-switcher]")).not.toBeNull();
  });

  // Every assertion above stops at the trigger. The menu CONTENT was never
  // mounted by a test, which is how a Menu.GroupLabel without a Menu.Group
  // around it shipped and threw Base UI #31 on open, taking down the route.
  // Open the menu so the parts inside it are actually rendered.
  test("opening the menu lists the machines under a group label", async () => {
    respond({
      "/api/cloud/session": () => Response.json(signedIn),
      "/api/cloud/computers": () => Response.json(computers),
    });
    ui.render(<MachineSwitcher variant="icon" />);
    await ui.flushAsync();
    const trigger = ui.query('[data-machine-switcher="icon"]') as HTMLElement | null;
    expect(trigger).not.toBeNull();
    await ui.flushAsync(() => {
      trigger!.click();
    });
    // The menu renders through a portal, so it is on the document, not in host.
    const menu = document.querySelector("[data-machine-menu]");
    expect(menu).not.toBeNull();
    expect(menu?.textContent).toContain("Machines");
    expect(menu?.textContent).toContain("This computer");
    expect(menu?.textContent).toContain("Cloud computer");
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

  test("draws the host's list without asking the box, and reports a pick by id", async () => {
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      return Response.json({}, { status: 404 });
    }) as typeof fetch;
    const picked: string[] = [];
    ui.render(
      <EmbeddedHostOptionsProvider
        value={{
          defaultAgent: "aisdk",
          connectionOnboarding: true,
          machines: {
            machines: [
              { id: "cloud", name: "omg cloud", kind: "cloud", online: true },
              { id: "b-1", name: "studio", kind: "connected", online: false, status: "offline" },
            ],
            activeId: "b-1",
            onSelect: (id) => picked.push(id),
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
});

test("refreshes a stale computer dot on foreground", async () => {
  let online = false;
  respond({
    "/api/cloud/session": () => Response.json(signedIn),
    "/api/cloud/computers": () => Response.json({ computers: [{ ...computers.computers[0], online, status: online ? "live" : "paused" }] }),
  });
  store().setItem(MACHINE_STORAGE_KEY, JSON.stringify({ id: "cloud", name: "Cloud computer" }));
  ui.render(<MachineSwitcher variant="icon" />);
  await ui.flushAsync();
  expect(ui.query('[aria-label="Computer offline"]')).not.toBeNull();
  online = true;
  await ui.flushAsync(() => window.dispatchEvent(new Event("focus")));
  expect(ui.query('[aria-label="Computer online"]')).not.toBeNull();
});

test("a live transport confirms the selected computer despite an old account snapshot", async () => {
  const { RuntimeAvailabilityContext } = await import("../lib/runtime-availability");
  respond({
    "/api/cloud/session": () => Response.json(signedIn),
    "/api/cloud/computers": () => Response.json(computers),
  });
  store().setItem(MACHINE_STORAGE_KEY, JSON.stringify({ id: "cloud", name: "Cloud computer" }));
  ui.render(<RuntimeAvailabilityContext.Provider value={{ status: "live", transportLive: true, loading: false, ready: true, error: null, retry: () => {} }}><MachineSwitcher variant="icon" /></RuntimeAvailabilityContext.Provider>);
  await ui.flushAsync();
  expect(ui.query('[aria-label="Computer online"]')).not.toBeNull();
});

test("host machine actions use the host owner and never call the local account", async () => {
  let added = 0, fetched = 0;
  const renamed: string[] = [];
  const selected: string[] = [];
  globalThis.fetch = (async () => { fetched++; throw new Error("unexpected local request"); }) as typeof fetch;
  ui.render(<EmbeddedHostOptionsProvider value={{
    machines: {
      machines: [{ id: "cloud", name: "Builder", kind: "cloud", online: true }, { id: "studio-id", name: "Studio", kind: "connected", online: false }, { id: "shared:owner:box", name: "Shared", kind: "connected", online: true, canRename: false }],
      activeId: "cloud", onSelect: (id) => { selected.push(id); }, onAdd: () => { added++; }, onRename: (id) => { renamed.push(id); },
    },
  }}><MachineSwitcher variant="rail" /></EmbeddedHostOptionsProvider>);
  const open = async () => ui.flushAsync(() => (ui.query("[data-machine-switcher]") as HTMLElement).click());
  await open();
  await ui.flushAsync(() => {
    const item = Array.from(document.querySelectorAll('[role="menuitem"]')).find((el) => el.textContent?.includes("Add machine")) as HTMLElement;
    item.click();
  });
  await open();
  await ui.flushAsync(() => {
    expect(document.querySelector("[data-machine-menu]")?.textContent).not.toContain("Rename cloud machine");
    expect(document.querySelector('[data-machine-edit="shared:owner:box"]')).toBeNull();
    const item = document.querySelector('[data-machine-edit="studio-id"]') as HTMLElement;
    expect(item.getAttribute("aria-label")).toBe("Edit Studio");
    item.click();
  });
  expect(added).toBe(1); expect(renamed).toEqual(["studio-id"]); expect(selected).toEqual([]); expect(fetched).toBe(0);
});

test("edits an unpaired local machine and refreshes its displayed name", async () => {
  let name = "My Mac";
  const picked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/cloud/session") return Response.json({ ...signedIn, signedIn: false, localName: name });
    if (url === "/api/cloud/rename") {
      const body = JSON.parse(String(init?.body));
      expect(body.bindingId).toBe("local");
      name = body.name;
      return Response.json({ name });
    }
    throw new Error(`Unexpected request ${url}`);
  }) as typeof fetch;
  ui.render(<MachineSwitcher variant="rail" onSelect={(choice) => picked.push(choice.id)} />);
  await ui.flushAsync();
  await ui.flushAsync(() => (ui.query("[data-machine-switcher]") as HTMLElement).click());
  await ui.flushAsync(() => (document.querySelector('[data-machine-edit="local"]') as HTMLElement).click());
  expect(document.querySelector('[data-machine-dialog="rename"]')).not.toBeNull();
  const input = document.querySelector<HTMLInputElement>("#machine-name")!;
  expect(input.value).toBe("My Mac");
  await ui.flushAsync(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, "Studio Mac");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await ui.flushAsync(() => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(ui.query("[data-machine-switcher]")?.textContent).toContain("Studio Mac");
  expect(picked).toEqual([]);
});
