import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "../config.ts";
import {
  OWNER_ROLE,
  createRole,
  deleteRole,
  evaluateRole,
  getRole,
  isValidPattern,
  listRoles,
  matchPattern,
  roleEgress,
  roleForUser,
  roleSandbox,
  updateRole,
} from "./roles.ts";

let tmp: string;
const originalData = PATHS.data;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "omg-roles-"));
  PATHS.data = tmp;
});

afterEach(() => {
  PATHS.data = originalData;
  rmSync(tmp, { recursive: true, force: true });
});

describe("matchPattern", () => {
  test("mirrors Executor's segment globs", () => {
    expect(matchPattern("*", "executor.execute")).toBe(true);
    expect(matchPattern("executor.*", "executor.execute")).toBe(true);
    expect(matchPattern("executor.*", "omg.ship")).toBe(false);
    expect(matchPattern("omg.ship", "omg.ship")).toBe(true);
    expect(matchPattern("omg.ship", "omg.ship.now")).toBe(false);
    expect(matchPattern("omg.*.now", "omg.ship.now")).toBe(true);
    expect(matchPattern("omg.*.now", "omg.now")).toBe(false);
  });

  test("validates patterns", () => {
    expect(isValidPattern("*")).toBe(true);
    expect(isValidPattern("omg.list_sessions")).toBe(true);
    expect(isValidPattern("")).toBe(false);
    expect(isValidPattern("omg..ship")).toBe(false);
    expect(isValidPattern("omg ship")).toBe(false);
  });
});

describe("evaluateRole", () => {
  test("block beats allow, default fills the gap", () => {
    const role = {
      ...OWNER_ROLE,
      id: "r",
      defaultAction: "block" as const,
      rules: [
        { pattern: "omg.*", action: "allow" as const },
        { pattern: "omg.close_session", action: "block" as const },
      ],
    };
    expect(evaluateRole(role, "omg.ship")).toBe("allow");
    expect(evaluateRole(role, "omg.close_session")).toBe("block");
    expect(evaluateRole(role, "executor.execute")).toBe("block");
    expect(evaluateRole(OWNER_ROLE, "anything.at.all")).toBe("allow");
  });
});

describe("role store", () => {
  test("owner is always present and never stored", () => {
    expect(listRoles().map((r) => r.id)).toEqual(["owner"]);
    expect(updateRole("owner", { name: "x" }).ok).toBe(false);
    expect(deleteRole("owner").ok).toBe(false);
  });

  test("create, read, update, delete", () => {
    const created = createRole({ name: "Marketing", rules: [{ pattern: "executor.*", action: "allow" }] });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.role.id).toBe("marketing");
    expect(created.role.defaultAction).toBe("block");
    expect(getRole("marketing")?.rules).toHaveLength(1);

    const second = createRole({ name: "Marketing" });
    expect(second.ok && second.role.id).toBe("marketing-2");

    const updated = updateRole("marketing", { defaultAction: "allow", rules: [] });
    expect(updated.ok && updated.role.defaultAction).toBe("allow");
    expect(listRoles().map((r) => r.id)).toEqual(["owner", "marketing", "marketing-2"]);

    expect(deleteRole("marketing").ok).toBe(true);
    expect(getRole("marketing")).toBeNull();
  });

  test("sandbox defaults to none and is editable; owner is always none", () => {
    const created = createRole({ name: "Restricted", sandbox: "bwrap" });
    expect(created.ok && created.role.sandbox).toBe("bwrap");
    expect(roleSandbox("restricted")).toBe("bwrap");
    expect(roleSandbox("owner")).toBe("none");
    expect(roleSandbox(undefined)).toBe("none");
    expect(roleSandbox("ghost")).toBe("none");

    const plain = createRole({ name: "Plain" });
    expect(plain.ok && plain.role.sandbox).toBe("none");

    expect(updateRole("restricted", { sandbox: "none" }).ok).toBe(true);
    expect(roleSandbox("restricted")).toBe("none");
    expect(updateRole("restricted", { sandbox: "weird" as never }).ok).toBe(false);
  });

  test("network defaults to shared; allowlist carries validated hosts", () => {
    const created = createRole({
      name: "Net",
      network: "allowlist",
      allowHosts: ["api.internal.example", ".corp.example"],
    });
    expect(created.ok && created.role.network).toBe("allowlist");
    expect(created.ok && created.role.allowHosts).toEqual(["api.internal.example", ".corp.example"]);

    expect(roleEgress("net")).toEqual({ mode: "allowlist", allowHosts: ["api.internal.example", ".corp.example"] });
    expect(roleEgress("owner")).toEqual({ mode: "shared", allowHosts: [] });
    expect(roleEgress("ghost")).toEqual({ mode: "shared", allowHosts: [] });

    expect(createRole({ name: "BadHost", network: "allowlist", allowHosts: ["not a host!"] }).ok).toBe(false);
    expect(updateRole("net", { network: "shared" }).ok).toBe(true);
    expect(roleEgress("net").mode).toBe("shared");
  });

  test("rejects bad input", () => {
    expect(createRole({ name: "  " }).ok).toBe(false);
    expect(createRole({ name: "x", rules: [{ pattern: "bad pattern", action: "allow" }] }).ok).toBe(false);
    expect(createRole({ name: "x", rules: [{ pattern: "*", action: "maybe" as never }] }).ok).toBe(false);
    expect(updateRole("missing", { name: "x" }).ok).toBe(false);
  });
});

describe("views and members", () => {
  test("old role files read as hiding nothing with no members", () => {
    const r = createRole({ name: "Legacy" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.role.views).toEqual({ hide: [], hiddenPages: [] });
    expect(r.role.members).toEqual([]);
  });

  test("validates view toggles and refuses to hide live or settings", () => {
    const bad = createRole({ name: "X", views: { hide: ["showNothing" as never], hiddenPages: [] } });
    expect(bad.ok).toBe(false);
    const locked = createRole({ name: "X", views: { hide: [], hiddenPages: ["settings"] } });
    expect(locked.ok).toBe(false);
    if (!locked.ok) expect(locked.error).toContain("cannot be hidden");
    const ok = createRole({ name: "Viewer", views: { hide: ["showBots", "showBots"], hiddenPages: ["usage", "board"] } });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.role.views).toEqual({ hide: ["showBots"], hiddenPages: ["usage", "board"] });
  });

  test("members resolve a user to one role; a later claim moves the email", () => {
    const a = createRole({ name: "A", members: ["Ann@Example.com"] });
    const b = createRole({ name: "B" });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(roleForUser("ann@example.com").id).toBe("a");
    expect(roleForUser("nobody@example.com").id).toBe(OWNER_ROLE.id);
    expect(roleForUser(undefined).id).toBe(OWNER_ROLE.id);
    const moved = updateRole("b", { members: ["ann@example.com"] });
    expect(moved.ok).toBe(true);
    expect(roleForUser("ann@example.com").id).toBe("b");
    expect(getRole("a")?.members).toEqual([]);
    expect(updateRole("b", { members: ["not-an-email"] }).ok).toBe(false);
  });
});
