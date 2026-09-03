// Host-injected context for the connector package.
//
// The connector core (store, hub, MCP endpoint, OAuth) is runtime-agnostic:
// it needs only a place to store data, a secret to encrypt tokens with, and
// the base URL of the host it runs in. Each host — omg's local `omg serve`
// and the hosted omg.dev sandbox — calls `configureConnectors()` once at
// startup with its own values, so the same package serves both.
import { join } from "node:path";

export interface ConnectorsContext {
  /** Directory the connector JSON/enc files live in. */
  dataDir: () => string;
  /** Secret material for deriving the token-encryption key. */
  secret: () => string;
  /** Base URL of this host, used as the OAuth redirect placeholder for calls. */
  baseUrl: () => string;
}

let ctx: ConnectorsContext = {
  dataDir: () => join(process.cwd(), ".connectors"),
  secret: () => "connectors-insecure-default",
  baseUrl: () => "http://127.0.0.1:8766",
};

export function configureConnectors(partial: Partial<ConnectorsContext>): void {
  ctx = { ...ctx, ...partial };
}

export const connectorDataDir = (): string => ctx.dataDir();
export const connectorSecret = (): string => ctx.secret();
export const connectorBaseUrl = (): string => ctx.baseUrl();
