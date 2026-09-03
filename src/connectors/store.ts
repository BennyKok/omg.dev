// Per-member connector store: the native replacement for Executor's connection
// catalog. A connection is one remote MCP server a member has added (from the
// integrations.sh catalog or by hand), with the credential omg holds and
// injects host-side — the agent never sees it.
//
// Scoping is the whole point: every connection has an `owner` (an omg member,
// or the shared sentinel ORG_OWNER). A session runs as a member, and the hub
// (./hub.ts) exposes that member's own connections plus the org-shared ones,
// so all of a member's agents share their connections and cannot see another
// member's. This is what Executor could not do — its ownership is a single
// org|user bucket, not one per team member.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { PATHS } from "../config.ts";

/** Connections everyone in the team may use. */
export const ORG_OWNER = "*org*";

export type ConnectorKind = "mcp";

export interface Connector {
  id: string;
  /** omg member id, or ORG_OWNER for a team-shared connection. */
  owner: string;
  /** Human label and the id agents see as the tool namespace. */
  name: string;
  slug: string;
  kind: ConnectorKind;
  /** Remote MCP endpoint. */
  endpoint: string;
  /** Header credentials injected host-side. Secret; never sent to an agent. */
  headers: Record<string, string>;
  /** Catalog slug this came from, when added from integrations.sh. */
  catalogSlug?: string;
  /** Logo URL, kept when added from the catalog. */
  icon?: string;
  /** Calls to this connector's tools pause for owner approval in chat. */
  requireApproval: boolean;
  createdAt: number;
  updatedAt: number;
}

/** A connection with its secrets stripped, safe to render or hand to a client. */
export type PublicConnector = Omit<Connector, "headers"> & { headerNames: string[] };

const MAX = 500;

function filePath(): string {
  return join(PATHS.data, "connectors.json");
}

interface FileShape {
  version: 1;
  connectors: Connector[];
}

function read(): FileShape {
  try {
    if (!existsSync(filePath())) return { version: 1, connectors: [] };
    const parsed = JSON.parse(readFileSync(filePath(), "utf8")) as Partial<FileShape>;
    const connectors = Array.isArray(parsed.connectors) ? parsed.connectors.filter(isConnector) : [];
    return { version: 1, connectors };
  } catch {
    return { version: 1, connectors: [] };
  }
}

function write(file: FileShape): void {
  mkdirSync(PATHS.data, { recursive: true });
  const tmp = `${filePath()}.tmp`;
  writeFileSync(tmp, JSON.stringify(file, null, 2));
  renameSync(tmp, filePath());
}

function isConnector(v: unknown): v is Connector {
  if (!v || typeof v !== "object") return false;
  const c = v as Partial<Connector>;
  return (
    typeof c.id === "string" &&
    typeof c.owner === "string" &&
    typeof c.name === "string" &&
    typeof c.endpoint === "string" &&
    c.kind === "mcp"
  );
}

export function publicView(c: Connector): PublicConnector {
  const { headers, ...rest } = c;
  return { ...rest, headerNames: Object.keys(headers) };
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

/**
 * The owner bucket for a session's member. An assigned user is that member;
 * an unassigned session falls back to the box owner bucket, so a solo box
 * keeps working with one implicit member.
 */
export const BOX_OWNER = "owner";

export function ownerForUser(user: string | null | undefined): string {
  const u = user?.trim();
  return u ? u : BOX_OWNER;
}

/** Every connection an owner may use: their own plus the org-shared ones. */
export function connectorsForOwner(owner: string): Connector[] {
  return read().connectors.filter((c) => c.owner === owner || c.owner === ORG_OWNER);
}

export function listConnectors(owner?: string): Connector[] {
  const all = read().connectors;
  return owner ? all.filter((c) => c.owner === owner || c.owner === ORG_OWNER) : all;
}

export function getConnector(id: string): Connector | null {
  return read().connectors.find((c) => c.id === id) ?? null;
}

export type ConnectorInput = {
  owner: string;
  name: string;
  endpoint: string;
  headers?: Record<string, string>;
  catalogSlug?: string;
  icon?: string;
  requireApproval?: boolean;
};

export type ConnectorResult = { ok: true; connector: Connector } | { ok: false; error: string };

function validEndpoint(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function createConnector(input: ConnectorInput): ConnectorResult {
  const name = input.name?.trim().slice(0, 80) ?? "";
  if (!name) return { ok: false, error: "name is required" };
  if (!validEndpoint(input.endpoint)) return { ok: false, error: "endpoint must be an http(s) URL" };
  if (!input.owner) return { ok: false, error: "owner is required" };
  const file = read();
  if (file.connectors.length >= MAX) return { ok: false, error: `at most ${MAX} connectors` };
  const now = Date.now();
  const base = slugify(name) || "connector";
  const taken = new Set(file.connectors.filter((c) => c.owner === input.owner).map((c) => c.slug));
  let slug = base;
  for (let n = 2; taken.has(slug); n += 1) slug = `${base}-${n}`;
  const connector: Connector = {
    id: randomBytes(8).toString("hex"),
    owner: input.owner,
    name,
    slug,
    kind: "mcp",
    endpoint: input.endpoint.trim(),
    headers: sanitizeHeaders(input.headers),
    catalogSlug: input.catalogSlug,
    icon: typeof input.icon === "string" ? input.icon : undefined,
    requireApproval: input.requireApproval === true,
    createdAt: now,
    updatedAt: now,
  };
  file.connectors.push(connector);
  write(file);
  return { ok: true, connector };
}

function sanitizeHeaders(headers: Record<string, string> | undefined): Record<string, string> {
  if (!headers) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (typeof k === "string" && typeof v === "string" && k.trim()) out[k.trim()] = v;
  }
  return out;
}

export function updateConnector(
  id: string,
  patch: Partial<Pick<ConnectorInput, "name" | "endpoint" | "headers" | "requireApproval">>,
): ConnectorResult {
  const file = read();
  const c = file.connectors.find((x) => x.id === id);
  if (!c) return { ok: false, error: "connector not found" };
  if (patch.name !== undefined) {
    const name = patch.name.trim().slice(0, 80);
    if (!name) return { ok: false, error: "name is required" };
    c.name = name;
  }
  if (patch.endpoint !== undefined) {
    if (!validEndpoint(patch.endpoint)) return { ok: false, error: "endpoint must be an http(s) URL" };
    c.endpoint = patch.endpoint.trim();
  }
  if (patch.headers !== undefined) c.headers = sanitizeHeaders(patch.headers);
  if (patch.requireApproval !== undefined) c.requireApproval = patch.requireApproval === true;
  c.updatedAt = Date.now();
  write(file);
  return { ok: true, connector: c };
}

export function deleteConnector(id: string): { ok: true } | { ok: false; error: string } {
  const file = read();
  const next = file.connectors.filter((c) => c.id !== id);
  if (next.length === file.connectors.length) return { ok: false, error: "connector not found" };
  write({ version: 1, connectors: next });
  return { ok: true };
}
