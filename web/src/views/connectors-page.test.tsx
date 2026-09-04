import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

const { ConnectorsPage, RolesPanel } = await import("./connectors-page");

let ui: Mounted;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  ui = mount();
});

afterEach(() => {
  ui.cleanup();
  globalThis.fetch = originalFetch;
});

type Call = { url: string; method: string; body: unknown };

function fakeServer(initialRoles: { id: string; name: string; defaultAction: string; rules: { pattern: string; action: string }[]; sandbox?: string; network?: string; allowHosts?: string[]; views?: { hide: string[]; hiddenPages: string[] }; members?: string[] }[]) {
  const calls: Call[] = [];
  let roles = initialRoles;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method, body });
    if (url.endsWith("/api/users")) return Response.json({ users: [{ email: "ann@example.com", name: "Ann" }, { email: "bob@example.com" }] });
    if (url.endsWith("/api/roles") && method === "GET") return Response.json({ roles });
    if (url.endsWith("/api/roles") && method === "POST") {
      const role = { id: body.name.toLowerCase(), name: body.name, defaultAction: "block", rules: [], sandbox: "none", network: "shared", allowHosts: [], createdAt: 1, updatedAt: 1 };
      roles = [...roles, role];
      return Response.json({ role });
    }
    const m = url.match(/\/api\/roles\/([a-z0-9-]+)$/);
    if (m && method === "PATCH") {
      roles = roles.map((r) => (r.id === m[1] ? { ...r, ...body } : r));
      return Response.json({ role: roles.find((r) => r.id === m[1]) });
    }
    if (m && method === "DELETE") {
      roles = roles.filter((r) => r.id !== m[1]);
      return Response.json({ ok: true });
    }
    if (url.includes("/api/connectors/catalog")) return Response.json({ total: 0, results: [] });
    if (url.includes("/api/connectors")) return Response.json({ connectors: [] });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { calls };
}

const OWNER = { id: "owner", name: "Owner", defaultAction: "allow", rules: [], sandbox: "none", network: "shared", allowHosts: [] };

describe("RolesPanel", () => {
  test("lists owner and the stored roles with their rules", async () => {
    fakeServer([
      OWNER,
      { id: "marketing", name: "Marketing", defaultAction: "block", rules: [{ pattern: "executor.*", action: "allow" }], sandbox: "bwrap", network: "allowlist", allowHosts: ["github.com"] },
    ]);
    ui.render(<RolesPanel />);
    await ui.flushAsync();
    expect(ui.text()).toContain("Owner");
    expect(ui.text()).toContain("Marketing");
    expect(ui.text()).toContain("executor.*");
    expect(ui.text()).toContain("Allow");
    const sandbox = ui.query('select[aria-label="Sandbox for Marketing"]') as HTMLSelectElement | null;
    expect(sandbox?.value).toBe("bwrap");
    const network = ui.query('select[aria-label="Network for Marketing"]') as HTMLSelectElement | null;
    expect(network?.value).toBe("allowlist");
    expect(ui.text()).toContain("github.com");
  });

  test("creates a role and adds a rule to it", async () => {
    const { calls } = fakeServer([OWNER]);
    ui.render(<RolesPanel />);
    await ui.flushAsync();

    const name = ui.query('input[aria-label="New role name"]') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    await ui.flushAsync(async () => {
      setValue.call(name, "Design");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await ui.flushAsync(async () => {
      (name.closest("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/api/roles"))).toBe(true);
    expect(ui.text()).toContain("Design");

    const pattern = ui.query('input[aria-label="New rule pattern for Design"]') as HTMLInputElement;
    await ui.flushAsync(async () => {
      setValue.call(pattern, "omg.ship");
      pattern.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await ui.flushAsync(async () => {
      (pattern.closest("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const patch = calls.find((c) => c.method === "PATCH");
    expect(patch?.url.endsWith("/api/roles/design")).toBe(true);
    expect(patch?.body).toEqual({ rules: [{ pattern: "omg.ship", action: "allow" }] });
    expect(ui.text()).toContain("omg.ship");
  });
});

describe("RoleCard views and members", () => {
  test("a hidden view unchecks, a page toggle patches views, a roster user becomes a member", async () => {
    const { calls } = fakeServer([
      OWNER,
      { id: "viewer", name: "Viewer", defaultAction: "block", rules: [], views: { hide: ["showBots"], hiddenPages: ["usage"] }, members: ["ann@example.com"] },
    ]);
    ui.render(<RolesPanel />);
    await ui.flushAsync();
    const bots = ui.query('input[aria-label="Bots for Viewer"]') as HTMLInputElement;
    expect(bots.checked).toBe(false);
    const usage = ui.query('input[aria-label="Provider limits page for Viewer"]') as HTMLInputElement;
    expect(usage.checked).toBe(false);
    expect(ui.text()).toContain("Ann");

    await ui.flushAsync(async () => usage.click());
    const viewsPatch = calls.find((c) => c.method === "PATCH");
    expect(viewsPatch?.body).toEqual({ views: { hide: ["showBots"], hiddenPages: [] } });

    // Ann is a member already, so only Bob is offered.
    const pick = ui.query('select[aria-label="Add member to Viewer"]') as HTMLSelectElement;
    expect(Array.from(pick.options).map((o) => o.value)).toEqual(["", "bob@example.com"]);
    const setValue = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")!.set!;
    await ui.flushAsync(async () => {
      setValue.call(pick, "bob@example.com");
      pick.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await ui.flushAsync(async () => {
      (pick.closest("form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const membersPatch = calls.filter((c) => c.method === "PATCH").at(-1);
    expect(membersPatch?.body).toEqual({ members: ["ann@example.com", "bob@example.com"] });
  });
});

describe("ConnectorsPage", () => {
  test("has Roles and Connectors tabs; no iframe, no Executor", async () => {
    fakeServer([OWNER]);
    ui.render(<ConnectorsPage />);
    await ui.flushAsync();
    expect(ui.text()).toContain("Built in."); // Roles tab, owner

    await ui.flushAsync(async () => (ui.queryAll('[role="tab"]')[1] as HTMLElement).click());
    // Native connectors panel: no iframe, reads /api/connectors, not Executor.
    expect(ui.query("iframe")).toBeNull();
    expect(ui.text()).toContain("MCP servers you add");
  });
});
