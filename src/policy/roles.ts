// Roles: who a session runs as, and which tools that lets it see and call.
//
// A role is a name plus a rule list. Rules use the same pattern grammar as
// Executor's tool policies (segment globs: `*`, `executor.*`, `omg.ship`), so
// the owner learns one language for the box-level Executor rules and the
// per-role omg rules. Tool ids are `<server>.<tool>` with the server's own
// prefix stripped: `omg.ship`, `computer.screenshot`, `executor.execute`.
//
// Resolution: the most restrictive matching rule wins, and a role with no
// matching rule falls back to its `defaultAction`. `owner` is built in and
// unrestricted; it is never stored. Storage is one JSON file under the data
// dir, the same shape the vibes sync will write into later
// (docs/team-tooling-design.md). This module is the single owner of that file.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../config.ts";

export type RuleAction = "allow" | "block";

export interface RoleRule {
  pattern: string;
  action: RuleAction;
}

export interface Role {
  id: string;
  name: string;
  /** What a tool gets when no rule matches. Restricted roles want `block`. */
  defaultAction: RuleAction;
  rules: RoleRule[];
  createdAt: number;
  updatedAt: number;
}

export const OWNER_ROLE_ID = "owner";

/** The built-in unrestricted role. Not stored, not editable, not deletable. */
export const OWNER_ROLE: Role = Object.freeze({
  id: OWNER_ROLE_ID,
  name: "Owner",
  defaultAction: "allow",
  rules: [],
  createdAt: 0,
  updatedAt: 0,
}) as Role;

const MAX_ROLES = 50;
const MAX_RULES = 200;

function rolesPath(): string {
  return join(PATHS.data, "roles.json");
}

interface RolesFile {
  version: 1;
  roles: Role[];
}

function readFile(): RolesFile {
  try {
    if (!existsSync(rolesPath())) return { version: 1, roles: [] };
    const parsed = JSON.parse(readFileSync(rolesPath(), "utf8")) as Partial<RolesFile>;
    const roles = Array.isArray(parsed.roles) ? parsed.roles.filter(isRole) : [];
    return { version: 1, roles };
  } catch {
    return { version: 1, roles: [] };
  }
}

function writeFile(file: RolesFile): void {
  mkdirSync(PATHS.data, { recursive: true });
  const tmp = `${rolesPath()}.tmp`;
  writeFileSync(tmp, JSON.stringify(file, null, 2));
  renameSync(tmp, rolesPath());
}

function isRole(value: unknown): value is Role {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<Role>;
  return (
    typeof r.id === "string" &&
    typeof r.name === "string" &&
    (r.defaultAction === "allow" || r.defaultAction === "block") &&
    Array.isArray(r.rules)
  );
}

// ---------------------------------------------------------------------------
// Pattern matching. Mirrors Executor's `matchPattern` so a rule reads the same
// on both sides: `*` is always one whole segment, and a trailing `*` matches
// the rest of the id.
// ---------------------------------------------------------------------------

export function matchPattern(pattern: string, toolId: string): boolean {
  if (pattern === "*") return true;
  const p = pattern.split(".");
  const t = toolId.split(".");
  for (let i = 0; i < p.length; i += 1) {
    const seg = p[i]!;
    if (seg === "*") {
      if (i === p.length - 1) return t.length >= i;
      if (t[i] === undefined) return false;
      continue;
    }
    if (t[i] !== seg) return false;
  }
  return p.length === t.length;
}

export function isValidPattern(pattern: string): boolean {
  if (!pattern || pattern.length > 200) return false;
  return pattern.split(".").every((seg) => seg === "*" || /^[a-z0-9_-]+$/i.test(seg));
}

/** The action a role gives one tool id. Block beats allow when both match. */
export function evaluateRole(role: Role, toolId: string): RuleAction {
  let matched: RuleAction | null = null;
  for (const rule of role.rules) {
    if (!matchPattern(rule.pattern, toolId)) continue;
    if (rule.action === "block") return "block";
    matched = "allow";
  }
  return matched ?? role.defaultAction;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export function listRoles(): Role[] {
  return [OWNER_ROLE, ...readFile().roles];
}

export function getRole(id: string): Role | null {
  if (id === OWNER_ROLE_ID) return OWNER_ROLE;
  return readFile().roles.find((r) => r.id === id) ?? null;
}

function slug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

export type RoleInput = {
  name: string;
  defaultAction?: RuleAction;
  rules?: RoleRule[];
};

export type RoleResult = { ok: true; role: Role } | { ok: false; error: string };

function validateRules(rules: unknown): RoleRule[] | string {
  if (rules === undefined) return [];
  if (!Array.isArray(rules)) return "rules must be an array";
  if (rules.length > MAX_RULES) return `rules must have at most ${MAX_RULES} entries`;
  const out: RoleRule[] = [];
  for (const rule of rules) {
    const r = rule as Partial<RoleRule>;
    if (typeof r?.pattern !== "string" || !isValidPattern(r.pattern)) {
      return `invalid pattern "${String(r?.pattern ?? "")}"`;
    }
    if (r.action !== "allow" && r.action !== "block") return `invalid action for "${r.pattern}"`;
    out.push({ pattern: r.pattern, action: r.action });
  }
  return out;
}

export function createRole(input: RoleInput): RoleResult {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 60) : "";
  if (!name) return { ok: false, error: "name is required" };
  const rules = validateRules(input.rules);
  if (typeof rules === "string") return { ok: false, error: rules };
  const defaultAction = input.defaultAction ?? "block";
  if (defaultAction !== "allow" && defaultAction !== "block") {
    return { ok: false, error: "defaultAction must be allow or block" };
  }
  const file = readFile();
  if (file.roles.length >= MAX_ROLES) return { ok: false, error: `at most ${MAX_ROLES} roles` };
  let id = slug(name) || "role";
  if (id === OWNER_ROLE_ID) id = "role-owner";
  const taken = new Set(file.roles.map((r) => r.id));
  let candidate = id;
  for (let n = 2; taken.has(candidate); n += 1) candidate = `${id}-${n}`;
  const now = Date.now();
  const role: Role = { id: candidate, name, defaultAction, rules, createdAt: now, updatedAt: now };
  file.roles.push(role);
  writeFile(file);
  return { ok: true, role };
}

export function updateRole(id: string, patch: Partial<RoleInput>): RoleResult {
  if (id === OWNER_ROLE_ID) return { ok: false, error: "the owner role cannot be edited" };
  const file = readFile();
  const role = file.roles.find((r) => r.id === id);
  if (!role) return { ok: false, error: "role not found" };
  if (patch.name !== undefined) {
    const name = typeof patch.name === "string" ? patch.name.trim().slice(0, 60) : "";
    if (!name) return { ok: false, error: "name is required" };
    role.name = name;
  }
  if (patch.defaultAction !== undefined) {
    if (patch.defaultAction !== "allow" && patch.defaultAction !== "block") {
      return { ok: false, error: "defaultAction must be allow or block" };
    }
    role.defaultAction = patch.defaultAction;
  }
  if (patch.rules !== undefined) {
    const rules = validateRules(patch.rules);
    if (typeof rules === "string") return { ok: false, error: rules };
    role.rules = rules;
  }
  role.updatedAt = Date.now();
  writeFile(file);
  return { ok: true, role };
}

export function deleteRole(id: string): { ok: true } | { ok: false; error: string } {
  if (id === OWNER_ROLE_ID) return { ok: false, error: "the owner role cannot be deleted" };
  const file = readFile();
  const next = file.roles.filter((r) => r.id !== id);
  if (next.length === file.roles.length) return { ok: false, error: "role not found" };
  writeFile({ version: 1, roles: next });
  return { ok: true };
}
