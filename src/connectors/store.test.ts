import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "../config.ts";
import {
  ORG_OWNER,
  connectorsForOwner,
  createConnector,
  deleteConnector,
  getConnector,
  listConnectors,
  publicView,
  updateConnector,
} from "./store.ts";

let tmp: string;
const originalData = PATHS.data;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "omg-conn-"));
  PATHS.data = tmp;
});

afterEach(() => {
  PATHS.data = originalData;
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
