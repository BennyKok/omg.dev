// Connectors omg implements itself, instead of proxying a remote MCP server.
//
// A native connector is stored like any other connection (owner bucket,
// approval flag, OAuth tokens), with `kind: "native"` and `native: <id>`. Its
// `endpoint` is the OAuth resource the sign-in discovers scopes from; the
// tools run in-process against the provider's REST API with the stored token.
import { GMAIL_TOOLS, callGmailTool, gmailAccount, type NativeCallResult, type NativeTool, type TokenSource } from "./gmail.ts";

export interface NativeConnectorDef {
  id: string;
  /** The pre-registered OAuth client it signs in with (./oauth-apps.ts). */
  oauthApp: string;
  tools: NativeTool[];
  call: (token: TokenSource, tool: string, args: Record<string, unknown>) => Promise<NativeCallResult>;
  /** The account the token belongs to, shown on the connection. */
  account: (token: TokenSource) => Promise<string>;
}

export const NATIVE_CONNECTORS: Record<string, NativeConnectorDef> = {
  gmail: { id: "gmail", oauthApp: "google", tools: GMAIL_TOOLS, call: callGmailTool, account: gmailAccount },
};

export function isNativeProvider(id: string): boolean {
  return Object.hasOwn(NATIVE_CONNECTORS, id);
}
