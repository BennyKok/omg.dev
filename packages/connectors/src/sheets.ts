// omg's own Google Sheets connector: agent tools over the Sheets REST API
// (sheets.googleapis.com/v4), plus a Drive search for spreadsheets.
//
// Same reason as ./gmail.ts: Google's Sheets MCP server answers tool calls
// only for Workspace Developer Preview projects, so omg signs in against its
// resource metadata (scopes: spreadsheets and drive) and calls REST itself.
//
// Ranges are A1 notation (`Leads!A1:D20`, or a bare sheet name). Values are
// written as a person would type them (USER_ENTERED), so `=SUM(A1:A3)` is a
// formula and `2026-09-24` is a date.
import type { NativeCallResult, NativeTool, TokenSource } from "./gmail.ts";
import { driveLiteral } from "./drive.ts";
import { type Fetch, GoogleApiError, driveAboutEmail, errorResult, googleJson, optionalString, requireString, textResult } from "./google-api.ts";

const API = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE = "https://www.googleapis.com/drive/v3/files";
const MAX_CELLS = 20_000;

const str = { type: "string" } as const;
const spreadsheetId = { type: "string", description: "The id in the sheet's URL: docs.google.com/spreadsheets/d/<id>/edit." } as const;
const rows = {
  type: "array",
  items: { type: "array", items: { type: ["string", "number", "boolean", "null"] } },
  description: "Rows of cells, e.g. [[\"Name\", \"Email\"], [\"Ann\", \"ann@x.com\"]].",
} as const;

export const SHEETS_TOOLS: NativeTool[] = [
  {
    name: "find_spreadsheets",
    description: "Find spreadsheets by name. Without text, lists the most recently modified ones.",
    inputSchema: { type: "object", properties: { text: str, max_results: { type: "number", description: "1 to 50. Default 20." } } },
  },
  {
    name: "get_spreadsheet",
    description: "A spreadsheet's title, link, and each sheet (tab) with its size.",
    inputSchema: { type: "object", properties: { spreadsheet_id: spreadsheetId }, required: ["spreadsheet_id"] },
  },
  {
    name: "read_range",
    description: "Read cells in A1 notation, e.g. `Leads!A1:D50`, or a sheet name for the whole tab. Returns rows of displayed values.",
    inputSchema: { type: "object", properties: { spreadsheet_id: spreadsheetId, range: str }, required: ["spreadsheet_id", "range"] },
  },
  {
    name: "write_range",
    description: "Overwrite cells starting at the range's top-left cell. Values are entered as typed, so formulas work.",
    inputSchema: { type: "object", properties: { spreadsheet_id: spreadsheetId, range: str, values: rows }, required: ["spreadsheet_id", "range", "values"] },
  },
  {
    name: "append_rows",
    description: "Add rows after the last row of data in a sheet (or a table range). Nothing existing is overwritten.",
    inputSchema: {
      type: "object",
      properties: { spreadsheet_id: spreadsheetId, range: { type: "string", description: "Sheet name or table range, e.g. Leads or Leads!A:D." }, values: rows },
      required: ["spreadsheet_id", "range", "values"],
    },
  },
  {
    name: "create_spreadsheet",
    description: "Create a spreadsheet, optionally with named tabs and starting rows in the first tab.",
    inputSchema: {
      type: "object",
      properties: { title: str, sheet_names: { type: "array", items: str }, values: rows },
      required: ["title"],
    },
  },
];

function cellsOf(values: unknown): unknown[][] {
  if (!Array.isArray(values) || values.length === 0 || !values.every(Array.isArray)) {
    throw new GoogleApiError("values must be a non-empty list of rows, each a list of cells");
  }
  const count = (values as unknown[][]).reduce((n, r) => n + r.length, 0);
  if (count > MAX_CELLS) throw new GoogleApiError(`at most ${MAX_CELLS} cells per call`);
  return values as unknown[][];
}

type Updated = { updatedRange?: string; updatedRows?: number; updatedColumns?: number; updatedCells?: number };

export async function callSheetsTool(
  token: TokenSource,
  name: string,
  args: Record<string, unknown>,
  fetchImpl: Fetch = fetch,
): Promise<NativeCallResult> {
  const call = (url: string, init: RequestInit) => googleJson(token, url, init, fetchImpl, "Sheets");
  try {
    switch (name) {
      case "find_spreadsheets": {
        const parts = ["mimeType = 'application/vnd.google-apps.spreadsheet'", "trashed = false"];
        const text = optionalString(args, "text");
        if (text) parts.push(`name contains ${driveLiteral(text)}`);
        const params = new URLSearchParams({
          q: parts.join(" and "),
          pageSize: String(Math.min(Math.max(Number(args.max_results) || 20, 1), 50)),
          orderBy: "modifiedTime desc",
          fields: "files(id,name,modifiedTime,webViewLink)",
          supportsAllDrives: "true",
          includeItemsFromAllDrives: "true",
        });
        const res = (await call(`${DRIVE}?${params}`, { method: "GET" })) as {
          files?: { id: string; name: string; modifiedTime?: string; webViewLink?: string }[];
        };
        return textResult({
          spreadsheets: (res.files ?? []).map((f) => ({ spreadsheet_id: f.id, title: f.name, modified: f.modifiedTime ?? null, link: f.webViewLink ?? null })),
        });
      }
      case "get_spreadsheet": {
        const id = requireString(args, "spreadsheet_id");
        const fields = "spreadsheetId,spreadsheetUrl,properties(title,timeZone),sheets(properties(sheetId,title,index,gridProperties(rowCount,columnCount)))";
        const s = (await call(`${API}/${encodeURIComponent(id)}?${new URLSearchParams({ fields })}`, { method: "GET" })) as {
          spreadsheetId: string;
          spreadsheetUrl?: string;
          properties?: { title?: string; timeZone?: string };
          sheets?: { properties?: { sheetId?: number; title?: string; gridProperties?: { rowCount?: number; columnCount?: number } } }[];
        };
        return textResult({
          spreadsheet_id: s.spreadsheetId,
          title: s.properties?.title ?? null,
          time_zone: s.properties?.timeZone ?? null,
          link: s.spreadsheetUrl ?? null,
          sheets: (s.sheets ?? []).map((sh) => ({
            sheet_id: sh.properties?.sheetId,
            title: sh.properties?.title,
            rows: sh.properties?.gridProperties?.rowCount,
            columns: sh.properties?.gridProperties?.columnCount,
          })),
        });
      }
      case "read_range": {
        const id = requireString(args, "spreadsheet_id");
        const range = requireString(args, "range");
        const res = (await call(`${API}/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}`, { method: "GET" })) as {
          range?: string;
          values?: unknown[][];
        };
        const values = res.values ?? [];
        let cells = 0;
        const clipped: unknown[][] = [];
        for (const row of values) {
          if (cells + row.length > MAX_CELLS) break;
          clipped.push(row);
          cells += row.length;
        }
        return textResult({ range: res.range ?? range, rows: clipped.length, values: clipped, ...(clipped.length < values.length ? { truncated: true } : {}) });
      }
      case "write_range": {
        const id = requireString(args, "spreadsheet_id");
        const range = requireString(args, "range");
        const values = cellsOf(args.values);
        const res = (await call(
          `${API}/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
          { method: "PUT", body: JSON.stringify({ range, majorDimension: "ROWS", values }) },
        )) as Updated;
        return textResult({ updated_range: res.updatedRange, updated_rows: res.updatedRows ?? 0, updated_cells: res.updatedCells ?? 0 });
      }
      case "append_rows": {
        const id = requireString(args, "spreadsheet_id");
        const range = requireString(args, "range");
        const values = cellsOf(args.values);
        const params = new URLSearchParams({ valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS" });
        const res = (await call(`${API}/${encodeURIComponent(id)}/values/${encodeURIComponent(range)}:append?${params}`, {
          method: "POST",
          body: JSON.stringify({ majorDimension: "ROWS", values }),
        })) as { updates?: Updated };
        return textResult({ appended_range: res.updates?.updatedRange, appended_rows: res.updates?.updatedRows ?? 0 });
      }
      case "create_spreadsheet": {
        const title = requireString(args, "title");
        const names = Array.isArray(args.sheet_names) ? args.sheet_names.filter((n): n is string => typeof n === "string" && !!n.trim()) : [];
        const created = (await call(API, {
          method: "POST",
          body: JSON.stringify({
            properties: { title },
            ...(names.length ? { sheets: names.map((n) => ({ properties: { title: n.trim() } })) } : {}),
          }),
        })) as { spreadsheetId: string; spreadsheetUrl?: string; sheets?: { properties?: { title?: string } }[] };
        const first = created.sheets?.[0]?.properties?.title;
        let written = 0;
        if (args.values !== undefined && first) {
          const values = cellsOf(args.values);
          const res = (await call(
            `${API}/${encodeURIComponent(created.spreadsheetId)}/values/${encodeURIComponent(`'${first.replace(/'/g, "''")}'!A1`)}?valueInputOption=USER_ENTERED`,
            { method: "PUT", body: JSON.stringify({ majorDimension: "ROWS", values }) },
          )) as Updated;
          written = res.updatedRows ?? 0;
        }
        return textResult({
          created: true,
          spreadsheet_id: created.spreadsheetId,
          link: created.spreadsheetUrl ?? null,
          sheets: (created.sheets ?? []).map((s) => s.properties?.title),
          rows_written: written,
        });
      }
      default:
        return { content: [{ type: "text", text: `unknown Sheets tool "${name}"` }], isError: true };
    }
  } catch (e) {
    return errorResult(e);
  }
}

/** The signed-in account, from Drive's `about` (the Sheets sign-in includes a Drive scope). */
export async function sheetsAccount(token: TokenSource, fetchImpl: Fetch = fetch): Promise<string> {
  return driveAboutEmail(token, fetchImpl);
}
