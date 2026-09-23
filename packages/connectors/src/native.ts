// Connectors omg implements itself, instead of proxying a remote MCP server.
//
// A native connector is stored like any other connection (owner bucket,
// approval flag, OAuth tokens), with `kind: "native"` and `native: <id>`. Its
// `endpoint` is the OAuth resource the sign-in discovers scopes from; the
// tools run in-process against the provider's REST API with the stored token.
import { GMAIL_TOOLS, callGmailTool, gmailAccount, type NativeCallResult, type NativeTool, type TokenSource } from "./gmail.ts";
import { DRIVE_TOOLS, callDriveTool, driveAccount } from "./drive.ts";
import { CALENDAR_TOOLS, callCalendarTool, calendarAccount } from "./calendar.ts";
import { SHEETS_TOOLS, callSheetsTool, sheetsAccount } from "./sheets.ts";

export interface NativeConnectorDef {
  id: string;
  /** The pre-registered OAuth client it signs in with (./oauth-apps.ts). */
  oauthApp: string;
  tools: NativeTool[];
  call: (token: TokenSource, tool: string, args: Record<string, unknown>) => Promise<NativeCallResult>;
  /**
   * The OAuth scopes its tools need. The sign-in requests exactly these
   * rather than everything the resource lists, so the consent screen shows
   * as few permission boxes as possible.
   */
  scopes: string[];
  /** The account the token belongs to, shown on the connection. */
  account: (token: TokenSource) => Promise<string>;
}

export const NATIVE_CONNECTORS: Record<string, NativeConnectorDef> = {
  gmail: { id: "gmail", oauthApp: "google", tools: GMAIL_TOOLS, call: callGmailTool, account: gmailAccount,
    // Read, label, trash, draft and send. Not permanent delete.
    scopes: ["https://www.googleapis.com/auth/gmail.modify"] },
  "google-drive": { id: "google-drive", oauthApp: "google", tools: DRIVE_TOOLS, call: callDriveTool, account: driveAccount,
    scopes: ["https://www.googleapis.com/auth/drive"] },
  "google-calendar": { id: "google-calendar", oauthApp: "google", tools: CALENDAR_TOOLS, call: callCalendarTool, account: calendarAccount,
    // Events read/write, plus calendar list and free/busy.
    scopes: ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"] },
  "google-sheets": { id: "google-sheets", oauthApp: "google", tools: SHEETS_TOOLS, call: callSheetsTool, account: sheetsAccount,
    // Cells, plus Drive read for finding spreadsheets and the account.
    scopes: ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive.readonly"] },
};

export function isNativeProvider(id: string): boolean {
  return Object.hasOwn(NATIVE_CONNECTORS, id);
}
