// Stopgap sign-in for MCP servers whose dynamic client registration accepts
// only an allowlist of client names and a fixed loopback return address.
//
// Meta's Ads MCP (https://mcp.facebook.com/ads) rejects `omg.dev` at its
// registration endpoint ("Dynamic registration is not available for this
// client") and accepts names containing "Claude", pinning the redirect to
// http://127.0.0.1:53682/callback. The browser cannot load that address, so the
// member copies the URL it lands on and pastes it back; the page posts the
// code and state to /api/connectors/oauth/callback.
//
// This registers under Claude's allowlisted name. It is off unless
// OMG_CONNECTOR_META_ADS=1, and is to be replaced once Meta approves omg.dev.
export interface PasteBackClient {
  /** client_name sent to dynamic registration. */
  clientName: string;
  /** The only return address the server accepts for that client. */
  redirectUrl: string;
}

export const META_ADS_ENDPOINT = "https://mcp.facebook.com/ads";

const PASTE_BACK_CLIENTS: Record<string, PasteBackClient> = {
  [META_ADS_ENDPOINT]: { clientName: "Claude Code (omg)", redirectUrl: "http://127.0.0.1:53682/callback" },
};

export function metaAdsStopgapEnabled(): boolean {
  return process.env.OMG_CONNECTOR_META_ADS?.trim() === "1";
}

/** The paste-back client for a connector's endpoint, when the stopgap is on. */
export function pasteBackClient(endpoint: string): PasteBackClient | undefined {
  if (!metaAdsStopgapEnabled()) return undefined;
  return PASTE_BACK_CLIENTS[endpoint.replace(/\/+$/, "")];
}
