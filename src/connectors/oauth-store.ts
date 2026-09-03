// OAuth state and tokens for a connector, encrypted at rest.
//
// The MCP OAuth flow (src/connectors/oauth-provider.ts) needs to persist, per
// connector: the dynamically-registered client information, the PKCE code
// verifier for an in-flight authorization, and the resulting tokens. Tokens
// and the verifier are secrets, so the file is encrypted with a key derived
// from the box secret (the same secret the session tokens use). A pending
// authorization is also indexed by its `state` parameter, so the callback can
// find which connector a redirect belongs to.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS } from "../config.ts";
import { boxSecretMaterial } from "../policy/session-token.ts";

export interface OAuthClientInfo {
  client_id: string;
  client_secret?: string;
  [k: string]: unknown;
}

export interface OAuthTokenSet {
  access_token: string;
  token_type: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  [k: string]: unknown;
}

export interface ConnectorOAuthState {
  connectorId: string;
  clientInformation?: OAuthClientInfo;
  tokens?: OAuthTokenSet;
  /** PKCE verifier for an in-flight authorization, keyed by state below. */
  pending?: { state: string; codeVerifier: string; redirectUri: string; createdAt: number };
}

interface FileShape {
  version: 1;
  byConnector: Record<string, ConnectorOAuthState>;
}

function filePath(): string {
  return join(PATHS.data, "connector-oauth.enc");
}

function key(): Buffer {
  // A stable 32-byte key from the box secret. createHash gives determinism
  // across restarts so previously-stored tokens stay decryptable.
  return createHash("sha256").update(`connector-oauth:${boxSecretMaterial()}`).digest();
}

function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`;
}

function decrypt(blob: string): string | null {
  try {
    const [ivB, tagB, dataB] = blob.split(".");
    if (!ivB || !tagB || !dataB) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64"));
    decipher.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function read(): FileShape {
  try {
    if (!existsSync(filePath())) return { version: 1, byConnector: {} };
    const dec = decrypt(readFileSync(filePath(), "utf8"));
    if (!dec) return { version: 1, byConnector: {} };
    const parsed = JSON.parse(dec) as Partial<FileShape>;
    return { version: 1, byConnector: parsed.byConnector ?? {} };
  } catch {
    return { version: 1, byConnector: {} };
  }
}

function write(file: FileShape): void {
  mkdirSync(PATHS.data, { recursive: true });
  const tmp = `${filePath()}.tmp`;
  writeFileSync(tmp, encrypt(JSON.stringify(file)), { mode: 0o600 });
  renameSync(tmp, filePath());
}

export function getOAuthState(connectorId: string): ConnectorOAuthState | undefined {
  return read().byConnector[connectorId];
}

export function saveClientInformation(connectorId: string, info: OAuthClientInfo): void {
  const file = read();
  const cur = file.byConnector[connectorId] ?? { connectorId };
  file.byConnector[connectorId] = { ...cur, clientInformation: info };
  write(file);
}

export function saveTokens(connectorId: string, tokens: OAuthTokenSet): void {
  const file = read();
  const cur = file.byConnector[connectorId] ?? { connectorId };
  // A completed authorization clears the pending PKCE material.
  file.byConnector[connectorId] = { ...cur, tokens, pending: undefined };
  write(file);
}

export function savePending(connectorId: string, pending: { state: string; codeVerifier: string; redirectUri: string }): void {
  const file = read();
  const cur = file.byConnector[connectorId] ?? { connectorId };
  file.byConnector[connectorId] = { ...cur, pending: { ...pending, createdAt: Date.now() } };
  write(file);
}

/** Resolve a callback's `state` back to the connector waiting on it. */
export function connectorByState(state: string): ConnectorOAuthState | undefined {
  return Object.values(read().byConnector).find((s) => s.pending?.state === state);
}

export function clearOAuth(connectorId: string): void {
  const file = read();
  delete file.byConnector[connectorId];
  write(file);
}

export function hasTokens(connectorId: string): boolean {
  return !!read().byConnector[connectorId]?.tokens?.access_token;
}
