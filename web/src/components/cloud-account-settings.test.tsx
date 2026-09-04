import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

const { CloudAccountSettingsSection } = await import("./cloud-account-settings");

let ui: Mounted;
const originalFetch = globalThis.fetch;
const originalAssign = window.location.assign;

beforeEach(() => {
  ui = mount();
});

afterEach(() => {
  ui.cleanup();
  globalThis.fetch = originalFetch;
  window.location.assign = originalAssign;
});

type Route = (init?: RequestInit) => Response | Promise<Response>;

function respond(routes: Record<string, Route>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, init });
    const route = routes[url];
    return route ? route(init) : Response.json({ error: "not found" }, { status: 404 });
  }) as typeof fetch;
  return calls;
}

const signedOut = { signedIn: false, email: null, expiresAt: null, kind: null, authUrl: "https://auth.omg.dev" };
const signedIn = { ...signedOut, signedIn: true, email: "ada@example.com", kind: "oauth" };

describe("CloudAccountSettingsSection", () => {
  test("hides itself on a server without the cloud routes", async () => {
    respond({});
    ui.render(<CloudAccountSettingsSection />);
    await ui.flushAsync();
    expect(ui.text()).not.toContain("omg Cloud");
  });

  test("offers sign-in and sends the browser to the authorization URL", async () => {
    const calls = respond({
      "/api/cloud/session": () => Response.json(signedOut),
      "/api/cloud/login": () => Response.json({ authorizeUrl: "https://auth.omg.dev/api/auth/oauth2/authorize?x=1" }),
    });
    let assigned: string | null = null;
    window.location.assign = ((url: string) => {
      assigned = url;
    }) as typeof window.location.assign;

    ui.render(<CloudAccountSettingsSection />);
    await ui.flushAsync();
    expect(ui.text()).toContain("Not signed in");

    ui.flush(() => (ui.query("button") as HTMLButtonElement).click());
    await ui.flushAsync();

    const login = calls.find((c) => c.url === "/api/cloud/login");
    expect(login?.init?.method).toBe("POST");
    expect(JSON.parse(String(login?.init?.body))).toEqual({ returnTo: "/" });
    expect(assigned).toBe("https://auth.omg.dev/api/auth/oauth2/authorize?x=1");
  });

  test("lists the account's computers when signed in", async () => {
    respond({
      "/api/cloud/session": () => Response.json(signedIn),
      "/api/cloud/computers": () =>
        Response.json({
          computers: [
            { slug: "cloud", name: "Cloud computer", kind: "cloud", online: false, status: "paused", isDefault: true },
            { slug: "studio", name: "studio", kind: "connected", online: true, status: "live", isDefault: false },
          ],
          defaultComputer: "cloud",
        }),
    });

    ui.render(<CloudAccountSettingsSection />);
    await ui.flushAsync();

    expect(ui.text()).toContain("ada@example.com");
    expect(ui.text()).toContain("Cloud computer");
    expect(ui.text()).toContain("Paused");
    expect(ui.text()).toContain("Default");
    expect(ui.text()).toContain("studio");
    expect(ui.text()).toContain("Online");
    expect(ui.queryAll("[data-cloud-computer]")).toHaveLength(2);
  });

  test("shows the list error and signs out through the server", async () => {
    let session = signedIn;
    const calls = respond({
      "/api/cloud/session": () => Response.json(session),
      "/api/cloud/computers": () => Response.json({ error: "Computer list failed (502)" }, { status: 502 }),
      "/api/cloud/logout": () => {
        session = signedOut;
        return Response.json({ ok: true });
      },
    });

    ui.render(<CloudAccountSettingsSection />);
    await ui.flushAsync();
    expect(ui.text()).toContain("Computer list failed (502)");

    ui.flush(() => (ui.query("button") as HTMLButtonElement).click());
    await ui.flushAsync();
    expect(calls.some((c) => c.url === "/api/cloud/logout" && c.init?.method === "POST")).toBe(true);
    expect(ui.text()).toContain("Not signed in");
  });
});
