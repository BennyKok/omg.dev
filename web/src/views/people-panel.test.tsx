import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { createSameOriginTransport } from "@omg-dev/client";
import { configureOmgTransport } from "../lib/omg-client";
import type { PeopleAnswer } from "./people-panel";

const { PeoplePanel, personDetail, roleEdits } = await import("./people-panel");

const originalFetch = globalThis.fetch;
let ui: Mounted;
let answer: PeopleAnswer;
let roles: { id: string; name: string; members: string[] }[];
let patches: { path: string; members: string[] }[];

beforeEach(() => {
  ui = mount();
  patches = [];
  roles = [{ id: "guest", name: "Guest", members: ["angel@example.com"] }, { id: "dev", name: "Developer", members: [] }];
  const person = (email: string, name: string, roleId: string, tailscale: PeopleAnswer["people"][number]["tailscale"]) => ({
    email, name, avatar: "/api/avatars/x.png", role: { id: roleId, name: roleId === "owner" ? "Owner" : "Guest" }, tailscale,
  });
  answer = {
    identityMode: "tailscale",
    viewer: { login: "benny@example.com", name: "Benny", verified: true },
    people: [person("benny@example.com", "Benny", "owner", null), person("angel@example.com", "Angel", "guest", { name: "Angel L", lastSeenAt: 1 })],
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input instanceof Request ? input.url : input), "http://local").pathname;
    if (init?.method === "PATCH") {
      const members = (JSON.parse(String(init.body)) as { members: string[] }).members;
      patches.push({ path, members });
      const role = roles.find((r) => path.endsWith(`/${r.id}`))!;
      role.members = members;
      for (const p of answer.people) if (members.includes(p.email)) p.role = { id: role.id, name: role.name };
      return Response.json({ role });
    }
    if (path === "/api/people") return Response.json(answer);
    if (path === "/api/roles") return Response.json({ roles });
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  // The transport keeps the fetch it was made with.
  configureOmgTransport(createSameOriginTransport());
});
afterEach(() => { ui.cleanup(); globalThis.fetch = originalFetch; configureOmgTransport(createSameOriginTransport()); });

/** The panel reads two endpoints; let both answers land. */
async function settle() {
  for (let i = 0; i < 6; i++) await ui.flushAsync(async () => { await new Promise((done) => setTimeout(done, 0)); });
}

test("lists each person with their Tailscale name and their role", async () => {
  ui.render(<PeoplePanel />);
  await settle();
  expect(ui.queryAll("[data-person]").map((row) => row.getAttribute("data-person"))).toEqual(["benny@example.com", "angel@example.com"]);
  expect(ui.text()).toContain("angel@example.com · Tailscale: Angel L");
  // The viewer is known by this request, though the server has no saved name yet.
  expect(ui.text()).toContain("benny@example.com · Tailscale: you");
  expect((ui.query('select[aria-label="Role of Angel"]') as HTMLSelectElement).value).toBe("guest");
  expect((ui.query('select[aria-label="Role of Benny"]') as HTMLSelectElement).value).toBe("owner");
  expect(ui.text()).toContain("Only these people can open this computer from the tailnet.");
});

test("picking a role edits that role's member list, the one owner of the mapping", async () => {
  ui.render(<PeoplePanel />);
  await settle();
  const select = ui.query('select[aria-label="Role of Benny"]') as HTMLSelectElement;
  await ui.flushAsync(() => {
    select.value = "dev";
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
  await settle();
  expect(patches).toEqual([{ path: "/api/roles/dev", members: ["benny@example.com"] }]);
});

test("Owner means in no role: the address leaves the role it is in", () => {
  expect(roleEdits(roles, "Angel@Example.com", "owner")).toEqual([{ id: "guest", members: [] }]);
  expect(roleEdits(roles, "benny@example.com", "owner")).toEqual([]);
  expect(roleEdits(roles, "angel@example.com", "guest")).toEqual([]);
  expect(roleEdits(roles, "angel@example.com", "no-such-role")).toEqual([]);
});

test("a Tailscale login seen on the main address is marked as not checked", () => {
  const me = answer.people[0];
  expect(personDetail(me, { login: "benny@example.com", name: null, verified: false })).toBe("benny@example.com · Tailscale: you (not checked on this address)");
  expect(personDetail(me, null)).toBe("benny@example.com");
});

test("without Tailscale identity the list has no note under it", async () => {
  answer.identityMode = "profile";
  answer.viewer = null;
  ui.render(<PeoplePanel />);
  await settle();
  expect(ui.queryAll("[data-person]")).toHaveLength(2);
  expect(ui.text()).not.toContain("tailnet");
});
