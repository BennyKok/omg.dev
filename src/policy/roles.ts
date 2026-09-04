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
import type { SandboxMode } from "../sandbox/bwrap.ts";

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
  /**
   * Filesystem isolation for sessions in this role (src/sandbox/bwrap.ts).
   * `bwrap` runs the harness with an empty home, the omg secrets masked, and
   * only its worktree writable. Owner is always `none`.
   */
  sandbox: SandboxMode;
  /**
   * Outbound network policy (src/sandbox/egress-proxy.ts). `allowlist` points
   * the harness at the egress proxy so it reaches only the model APIs plus
   * `allowHosts`; `shared` leaves the network open. Owner is always `shared`.
   */
  network: NetworkMode;
  /** Extra hostnames the allowlist permits, beyond the built-in model APIs. */
  allowHosts: string[];
  /**
   * What the web UI hides for a viewer in this role. Cosmetic: the box has no
   * auth, so this is a layout decision, not a boundary. Tool rules above are
   * the boundary. Owner hides nothing.
   */
  views: RoleViews;
  /**
   * Roster emails (src/users.ts) that resolve to this role. One email belongs
   * to at most one role; assigning it here removes it elsewhere. Owner has no
   * list: an email in no role is the owner.
   */
  members: string[];
  createdAt: number;
  updatedAt: number;
}

export type NetworkMode = "shared" | "allowlist";

/** The box-wide view switches a role may turn off (src/settings.ts). */
export const VIEW_TOGGLE_KEYS = [
  "showSidebarAgentIcons",
  "showSessionAgentIcons",
  "showComposerModels",
  "showComposerAgents",
  "showBots",
  "showSchedules",
  "showSessionDiffBar",
  "showComposerFastMode",
] as const;
export type ViewToggleKey = (typeof VIEW_TOGGLE_KEYS)[number];

/** Top-level pages a role may hide. Mirrors TAB_VALUES in web/src/lib/app-search.ts. */
export const HIDEABLE_PAGES = [
  "notifications",
  "artifacts",
  "auto",
  "usage",
  "coding-agents",
  "changelog",
  "term",
  "browser",
  "computer",
  "board",
] as const;
/** `live` and `settings` stay visible so a role can never lock itself out. */
export const ALWAYS_VISIBLE_PAGES = ["live", "settings"] as const;

export interface RoleViews {
  /** View toggles this role turns off, on top of the box-wide setting. */
  hide: ViewToggleKey[];
  /** Page ids this role cannot open. Never `live` or `settings`. */
  hiddenPages: string[];
}

export const EMPTY_VIEWS: RoleViews = Object.freeze({ hide: [], hiddenPages: [] }) as RoleViews;

export const OWNER_ROLE_ID = "owner";

/** The built-in unrestricted role. Not stored, not editable, not deletable. */
export const OWNER_ROLE: Role = Object.freeze({
  id: OWNER_ROLE_ID,
  name: "Owner",
  defaultAction: "allow",
  rules: [],
  sandbox: "none",
  network: "shared",
  allowHosts: [],
  views: EMPTY_VIEWS,
  members: [],
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
    const roles = Array.isArray(parsed.roles)
      ? parsed.roles.filter(isRole).map((r) => ({
          ...r,
          sandbox: readSandbox(r.sandbox),
          network: readNetwork((r as Partial<Role>).network),
          allowHosts: readAllowHosts((r as Partial<Role>).allowHosts),
          views: readViews((r as Partial<Role>).views),
          members: readMembers((r as Partial<Role>).members),
        }))
      : [];
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

// A role file from before sandbox existed has no field; treat it as "none".
function readSandbox(value: unknown): SandboxMode {
  return value === "bwrap" ? "bwrap" : "none";
}

function readNetwork(value: unknown): NetworkMode {
  return value === "allowlist" ? "allowlist" : "shared";
}

function readAllowHosts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((h): h is string => typeof h === "string" && h.trim().length > 0).slice(0, 100);
}

// A role file from before views existed has no field; that role hides nothing.
function readViews(value: unknown): RoleViews {
  const v = (value ?? {}) as Partial<RoleViews>;
  const hide = Array.isArray(v.hide) ? v.hide.filter(isViewToggleKey) : [];
  const hiddenPages = Array.isArray(v.hiddenPages) ? v.hiddenPages.filter(isHideablePage) : [];
  return { hide, hiddenPages };
}

function readMembers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((m): m is string => typeof m === "string" && m.trim().length > 0).map(normalizeEmail);
}

function isViewToggleKey(value: unknown): value is ViewToggleKey {
  return typeof value === "string" && (VIEW_TOGGLE_KEYS as readonly string[]).includes(value);
}

function isHideablePage(value: unknown): value is string {
  return typeof value === "string" && (HIDEABLE_PAGES as readonly string[]).includes(value);
}

function validateViews(views: unknown): RoleViews | string {
  if (views === undefined) return { hide: [], hiddenPages: [] };
  if (!views || typeof views !== "object") return "views must be an object";
  const v = views as Partial<RoleViews>;
  const hide: ViewToggleKey[] = [];
  if (v.hide !== undefined) {
    if (!Array.isArray(v.hide)) return "views.hide must be an array";
    for (const key of v.hide) {
      if (!isViewToggleKey(key)) return `unknown view toggle "${String(key)}"`;
      if (!hide.includes(key)) hide.push(key);
    }
  }
  const hiddenPages: string[] = [];
  if (v.hiddenPages !== undefined) {
    if (!Array.isArray(v.hiddenPages)) return "views.hiddenPages must be an array";
    for (const page of v.hiddenPages) {
      if (typeof page === "string" && (ALWAYS_VISIBLE_PAGES as readonly string[]).includes(page)) {
        return `page "${page}" cannot be hidden`;
      }
      if (!isHideablePage(page)) return `unknown page "${String(page)}"`;
      if (!hiddenPages.includes(page)) hiddenPages.push(page);
    }
  }
  return { hide, hiddenPages };
}

const MAX_MEMBERS = 500;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function validateMembers(members: unknown): string[] | string {
  if (members === undefined) return [];
  if (!Array.isArray(members)) return "members must be an array";
  if (members.length > MAX_MEMBERS) return `members must have at most ${MAX_MEMBERS} entries`;
  const out: string[] = [];
  for (const raw of members) {
    if (typeof raw !== "string") return "each member must be a string";
    const email = normalizeEmail(raw);
    if (!email) continue;
    if (email.length > 254 || !email.includes("@")) return `invalid member "${raw}"`;
    if (!out.includes(email)) out.push(email);
  }
  return out;
}

/** One email belongs to at most one role. Drop it from every other role. */
function claimMembers(file: RolesFile, roleId: string, members: string[]): void {
  if (members.length === 0) return;
  const taken = new Set(members);
  for (const other of file.roles) {
    if (other.id === roleId) continue;
    const kept = other.members.filter((m) => !taken.has(m));
    if (kept.length !== other.members.length) {
      other.members = kept;
      other.updatedAt = Date.now();
    }
  }
}

const MAX_HOST_LEN = 253;

function validateAllowHosts(hosts: unknown): string[] | string {
  if (hosts === undefined) return [];
  if (!Array.isArray(hosts)) return "allowHosts must be an array";
  const out: string[] = [];
  for (const raw of hosts) {
    if (typeof raw !== "string") return "each allowHost must be a string";
    const host = raw.trim().toLowerCase();
    if (!host) continue;
    if (host.length > MAX_HOST_LEN || !/^\.?[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(host)) {
      return `invalid host "${raw}"`;
    }
    out.push(host);
  }
  return out;
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

/** The sandbox mode for a session's role. Owner and unknown roles are `none`. */
export function roleSandbox(roleId: string | undefined | null): SandboxMode {
  if (!roleId || roleId === OWNER_ROLE_ID) return "none";
  return getRole(roleId)?.sandbox ?? "none";
}

/**
 * The egress policy for a session's role. Owner and unknown roles are shared
 * (no proxy). For an allowlist role the allowed hosts are its own `allowHosts`
 * plus the built-in model APIs, resolved by the proxy.
 */
export function roleEgress(roleId: string | undefined | null): { mode: NetworkMode; allowHosts: string[] } {
  if (!roleId || roleId === OWNER_ROLE_ID) return { mode: "shared", allowHosts: [] };
  const role = getRole(roleId);
  if (!role) return { mode: "shared", allowHosts: [] };
  return { mode: role.network, allowHosts: role.allowHosts };
}

/** The role a roster email resolves to. Unknown or unlisted emails are the owner. */
export function roleForUser(email: string | undefined | null): Role {
  if (!email) return OWNER_ROLE;
  const wanted = normalizeEmail(email);
  if (!wanted) return OWNER_ROLE;
  return readFile().roles.find((r) => r.members.includes(wanted)) ?? OWNER_ROLE;
}

function slug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

export type RoleInput = {
  name: string;
  defaultAction?: RuleAction;
  rules?: RoleRule[];
  sandbox?: SandboxMode;
  network?: NetworkMode;
  allowHosts?: string[];
  views?: RoleViews;
  members?: string[];
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
  const sandbox: SandboxMode = input.sandbox === "bwrap" ? "bwrap" : "none";
  const network: NetworkMode = input.network === "allowlist" ? "allowlist" : "shared";
  const allowHosts = validateAllowHosts(input.allowHosts);
  if (typeof allowHosts === "string") return { ok: false, error: allowHosts };
  const views = validateViews(input.views);
  if (typeof views === "string") return { ok: false, error: views };
  const members = validateMembers(input.members);
  if (typeof members === "string") return { ok: false, error: members };
  const role: Role = {
    id: candidate,
    name,
    defaultAction,
    rules,
    sandbox,
    network,
    allowHosts,
    views,
    members,
    createdAt: now,
    updatedAt: now,
  };
  claimMembers(file, candidate, members);
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
  if (patch.sandbox !== undefined) {
    if (patch.sandbox !== "none" && patch.sandbox !== "bwrap") {
      return { ok: false, error: "sandbox must be none or bwrap" };
    }
    role.sandbox = patch.sandbox;
  }
  if (patch.network !== undefined) {
    if (patch.network !== "shared" && patch.network !== "allowlist") {
      return { ok: false, error: "network must be shared or allowlist" };
    }
    role.network = patch.network;
  }
  if (patch.allowHosts !== undefined) {
    const hosts = validateAllowHosts(patch.allowHosts);
    if (typeof hosts === "string") return { ok: false, error: hosts };
    role.allowHosts = hosts;
  }
  if (patch.views !== undefined) {
    const views = validateViews(patch.views);
    if (typeof views === "string") return { ok: false, error: views };
    role.views = views;
  }
  if (patch.members !== undefined) {
    const members = validateMembers(patch.members);
    if (typeof members === "string") return { ok: false, error: members };
    role.members = members;
    claimMembers(file, id, members);
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
