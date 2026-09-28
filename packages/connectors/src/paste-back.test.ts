// The Meta Ads stopgap must stay off unless the box opts in, and when on it
// must register with the allowlisted name and the fixed loopback return.
import { afterEach, expect, test } from "bun:test";
import { ConnectorOAuthProvider } from "./oauth-provider.ts";
import { META_ADS_ENDPOINT, pasteBackClient } from "./paste-back.ts";
import type { Connector } from "./store.ts";

const connector = (endpoint: string) =>
  ({ id: "c1", owner: "owner", name: "Meta Ads", slug: "meta-ads", kind: "http", endpoint, headers: {}, oauth: true, requireApproval: false, createdAt: 0, updatedAt: 0 }) as Connector;

afterEach(() => {
  delete process.env.OMG_CONNECTOR_META_ADS;
});

test("off by default: Meta Ads signs in like any other server", () => {
  expect(pasteBackClient(META_ADS_ENDPOINT)).toBeUndefined();
  const p = new ConnectorOAuthProvider(connector(META_ADS_ENDPOINT), "http://127.0.0.1:8766");
  expect(p.redirectUrl).toBe("http://127.0.0.1:8766/api/connectors/oauth/callback");
  expect(p.clientMetadata.client_name).toBe("omg (Meta Ads)");
});

test("on: Meta Ads registers as a public client returning to the loopback address", () => {
  process.env.OMG_CONNECTOR_META_ADS = "1";
  const p = new ConnectorOAuthProvider(connector(`${META_ADS_ENDPOINT}/`), "http://127.0.0.1:8766");
  expect(p.redirectUrl).toBe("http://127.0.0.1:53682/callback");
  expect(p.clientMetadata.client_name).toContain("Claude");
  expect(p.clientMetadata.token_endpoint_auth_method).toBe("none");
});

test("on: other servers are unchanged", () => {
  process.env.OMG_CONNECTOR_META_ADS = "1";
  const p = new ConnectorOAuthProvider(connector("https://mcp.exa.ai/mcp"), "http://127.0.0.1:8766");
  expect(p.redirectUrl).toBe("http://127.0.0.1:8766/api/connectors/oauth/callback");
  expect(p.clientMetadata.client_name).toBe("omg (Meta Ads)");
});
