import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureConnectors } from "./context.ts";
import {
  ORG_OWNER,
  connectorsForMember,
  connectorsForOwner,
  roleOwner,
  createConnector,
  deleteConnector,
  deleteConnectorsForOwner,
  getConnector,
  listConnectors,
  listConnectorsForAdmin,
  publicView,
  setConnectorOAuth,
  updateConnector,
} from "./store.ts";
import { onConnectorsChanged } from "./changes.ts";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "omg-conn-"));
  configureConnectors({ dataDir: () => tmp, secret: () => "test-secret", baseUrl: () => "http://127.0.0.1:8766" });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("connector store", () => {
  test("create validates and slugs uniquely", () => {
    const bad = createConnector({ owner: "benny", name: "", endpoint: "https://x" });
    expect(bad.ok).toBe(false);
    expect(createConnector({ owner: "benny", name: "X", endpoint: "not a url" }).ok).toBe(false);

    const a = createConnector({ owner: "benny", name: "GitHub", endpoint: "https://mcp.github/mcp" });
    const b = createConnector({ owner: "benny", name: "GitHub", endpoint: "https://mcp.github/mcp" });
    expect(a.ok && a.connector.slug).toBe("github");
    expect(b.ok && b.connector.slug).toBe("github-2");
  });

  test("scoping: an owner sees their own plus org-shared, never another member's", () => {
    createConnector({ owner: "benny", name: "Benny GH", endpoint: "https://x/mcp" });
    createConnector({ owner: "angel", name: "Angel GH", endpoint: "https://y/mcp" });
    createConnector({ owner: ORG_OWNER, name: "Shared", endpoint: "https://z/mcp" });

    const forBenny = connectorsForOwner("benny").map((c) => c.name).sort();
    expect(forBenny).toEqual(["Benny GH", "Shared"]);
    const forAngel = connectorsForOwner("angel").map((c) => c.name).sort();
    expect(forAngel).toEqual(["Angel GH", "Shared"]);
  });

  test("three levels: team, role, own; same-name connections in two buckets both stay reachable", () => {
    createConnector({ owner: ORG_OWNER, name: "Shared", endpoint: "https://z/mcp" });
    createConnector({ owner: roleOwner("support"), name: "Zendesk", endpoint: "https://r/mcp" });
    createConnector({ owner: roleOwner("support"), name: "GitHub", endpoint: "https://role-gh/mcp" });
    createConnector({ owner: roleOwner("design"), name: "Figma", endpoint: "https://d/mcp" });
    createConnector({ owner: "benny", name: "GitHub", endpoint: "https://own-gh/mcp" });

    // Slugs are unique across the box, so a personal GitHub no longer hides
    // the role's GitHub: both reach the member's agents, as two tool sets.
    const support = connectorsForMember("benny", "support");
    expect(support.map((c) => c.name).sort()).toEqual(["GitHub", "GitHub", "Shared", "Zendesk"]);
    expect(support.find((c) => c.slug === "github")?.endpoint).toBe("https://role-gh/mcp");
    expect(support.find((c) => c.slug === "github-2")?.endpoint).toBe("https://own-gh/mcp");

    const angelInDesign = connectorsForMember("angel", "design").map((c) => c.name).sort();
    expect(angelInDesign).toEqual(["Figma", "Shared"]);

    // No role, or the owner role, reads only own + team.
    expect(connectorsForMember("angel", null).map((c) => c.name)).toEqual(["Shared"]);
    expect(connectorsForMember("angel", "owner").map((c) => c.name)).toEqual(["Shared"]);

    expect(listConnectors("benny", "support").filter((c) => c.name === "GitHub")).toHaveLength(2);
  });

  test("the owner's list holds their own, the team's and every role's, not other members'", () => {
    createConnector({ owner: "benny", name: "Mine", endpoint: "https://a/mcp" });
    createConnector({ owner: "angel", name: "Angel's", endpoint: "https://b/mcp" });
    createConnector({ owner: roleOwner("growth"), name: "Gmail", endpoint: "https://c/mcp" });
    createConnector({ owner: ORG_OWNER, name: "Shared", endpoint: "https://d/mcp" });
    expect(listConnectorsForAdmin("benny").map((c) => c.name).sort()).toEqual(["Gmail", "Mine", "Shared"]);
  });

  test("every write tells listeners the tool sets may have changed", () => {
    let changes = 0;
    const off = onConnectorsChanged(() => (changes += 1));
    const made = createConnector({ owner: "benny", name: "X", endpoint: "https://x/mcp" });
    expect(changes).toBe(1);
    if (made.ok) deleteConnector(made.connector.id);
    expect(changes).toBe(2);
    off();
    createConnector({ owner: "benny", name: "Y", endpoint: "https://y/mcp" });
    expect(changes).toBe(2);
  });

  test("deleting a role bucket removes only that role's connectors", () => {
    createConnector({ owner: roleOwner("support"), name: "Desk", endpoint: "https://r/mcp" });
    createConnector({ owner: roleOwner("support"), name: "Zendesk", endpoint: "https://r2/mcp" });
    createConnector({ owner: roleOwner("design"), name: "Figma", endpoint: "https://d/mcp" });
    createConnector({ owner: "benny", name: "Own", endpoint: "https://o/mcp" });

    const removed = deleteConnectorsForOwner(roleOwner("support"));
    expect(removed.map((c) => c.name).sort()).toEqual(["Desk", "Zendesk"]);
    expect(listConnectors().map((c) => c.name).sort()).toEqual(["Figma", "Own"]);
    expect(deleteConnectorsForOwner(roleOwner("support"))).toEqual([]);
  });

  test("public view strips header secrets", () => {
    const created = createConnector({
      owner: "benny",
      name: "Keyed",
      endpoint: "https://x/mcp",
      headers: { Authorization: "Bearer super-secret" },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const pub = publicView(created.connector) as Record<string, unknown>;
    expect(pub.headers).toBeUndefined();
    expect(pub.headerNames).toEqual(["Authorization"]);
    expect(JSON.stringify(pub)).not.toContain("super-secret");
  });

  test("update and delete", () => {
    const created = createConnector({ owner: "benny", name: "X", endpoint: "https://x/mcp" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.connector.id;
    expect(updateConnector(id, { requireApproval: true }).ok).toBe(true);
    expect(getConnector(id)?.requireApproval).toBe(true);
    expect(updateConnector(id, { endpoint: "bad" }).ok).toBe(false);
    expect(deleteConnector(id).ok).toBe(true);
    expect(getConnector(id)).toBeNull();
    expect(listConnectors().length).toBe(0);
  });
});

describe("oauth flag", () => {
  test("setConnectorOAuth records a sign-in requirement found at runtime", () => {
    const created = createConnector({ owner: "benny", name: "Probe", endpoint: "https://example.com/mcp" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.connector.oauth).toBe(false);

    const flagged = setConnectorOAuth(created.connector.id, true);
    expect(flagged?.oauth).toBe(true);
    expect(getConnector(created.connector.id)?.oauth).toBe(true);

    // A second write with the same value is a no-op, so a repeated probe does
    // not rewrite the file.
    expect(setConnectorOAuth(created.connector.id, true)).toBeNull();
    expect(setConnectorOAuth("nope", true)).toBeNull();
  });
});
