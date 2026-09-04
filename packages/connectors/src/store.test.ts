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
  getConnector,
  listConnectors,
  publicView,
  updateConnector,
} from "./store.ts";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "omg-conn-"));
  configureConnectors({ dataDir: () => tmp, secret: () => "test-secret", baseUrl: () => "http://127.0.0.1:8766" });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("connector store", () => {
  test("create validates and slugs uniquely per owner", () => {
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

  test("three levels: team, role, own; the most specific wins a slug collision", () => {
    createConnector({ owner: ORG_OWNER, name: "Shared", endpoint: "https://z/mcp" });
    createConnector({ owner: roleOwner("support"), name: "Zendesk", endpoint: "https://r/mcp" });
    createConnector({ owner: roleOwner("support"), name: "GitHub", endpoint: "https://role-gh/mcp" });
    createConnector({ owner: roleOwner("design"), name: "Figma", endpoint: "https://d/mcp" });
    createConnector({ owner: "benny", name: "GitHub", endpoint: "https://own-gh/mcp" });

    const support = connectorsForMember("benny", "support");
    expect(support.map((c) => c.name).sort()).toEqual(["GitHub", "Shared", "Zendesk"]);
    expect(support.find((c) => c.slug === "github")?.endpoint).toBe("https://own-gh/mcp");

    const angelInDesign = connectorsForMember("angel", "design").map((c) => c.name).sort();
    expect(angelInDesign).toEqual(["Figma", "Shared"]);

    // No role, or the owner role, reads only own + team.
    expect(connectorsForMember("angel", null).map((c) => c.name)).toEqual(["Shared"]);
    expect(connectorsForMember("angel", "owner").map((c) => c.name)).toEqual(["Shared"]);

    // The UI list keeps the shadowed role GitHub so it can be managed.
    expect(listConnectors("benny", "support").filter((c) => c.slug === "github")).toHaveLength(2);
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
