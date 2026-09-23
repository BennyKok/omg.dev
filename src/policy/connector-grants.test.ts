import { describe, expect, test } from "bun:test";
import { withConnectorGrants } from "./connector-grants.ts";
import { evaluateRole, OWNER_ROLE, type Role } from "./roles.ts";

const GROWTH: Role = {
  id: "growth",
  name: "Growth",
  defaultAction: "block",
  rules: [],
  sandbox: "none",
  network: "shared",
  allowHosts: [],
  views: { hide: [], hiddenPages: [] },
  members: [],
  createdAt: 0,
  updatedAt: 0,
};

describe("withConnectorGrants", () => {
  test("a connection given to the role is allowed although the role blocks by default", () => {
    const role = withConnectorGrants(GROWTH, [{ owner: "role:growth", slug: "gmail" }]);
    expect(evaluateRole(role, "connectors.gmail.search_threads")).toBe("allow");
    // Nothing else is opened up.
    expect(evaluateRole(role, "connectors.linear.create_issue")).toBe("block");
    expect(evaluateRole(role, "omg.ship")).toBe("block");
  });

  test("team connections count, personal and other roles' do not", () => {
    const role = withConnectorGrants(GROWTH, [
      { owner: "*org*", slug: "notion" },
      { owner: "benny", slug: "exa" },
      { owner: "role:pm", slug: "linear" },
    ]);
    expect(evaluateRole(role, "connectors.notion.search")).toBe("allow");
    expect(evaluateRole(role, "connectors.exa.web_search_exa")).toBe("block");
    expect(evaluateRole(role, "connectors.linear.create_issue")).toBe("block");
  });

  test("an explicit block the owner wrote still wins", () => {
    const strict = { ...GROWTH, rules: [{ pattern: "connectors.gmail.send_email", action: "block" as const }] };
    const role = withConnectorGrants(strict, [{ owner: "role:growth", slug: "gmail" }]);
    expect(evaluateRole(role, "connectors.gmail.send_email")).toBe("block");
    expect(evaluateRole(role, "connectors.gmail.get_thread")).toBe("allow");
  });

  test("the owner role and a role with no grants come back unchanged", () => {
    expect(withConnectorGrants(OWNER_ROLE, [{ owner: "role:owner", slug: "x" }])).toBe(OWNER_ROLE);
    expect(withConnectorGrants(GROWTH, [])).toBe(GROWTH);
  });
});
