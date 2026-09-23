// The native Sheets connector against a fake Sheets and Drive API. Pins what
// agents rely on: finding sheets by name, A1 ranges passed through encoded,
// values entered as typed, appends that never overwrite, and bad input
// rejected before any request.
import { expect, test } from "bun:test";
import { callSheetsTool, sheetsAccount } from "./sheets.ts";

type Call = { method: string; url: URL; body: any };

function fakeSheets() {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const p = decodeURIComponent(url.pathname);
    if (url.hostname === "www.googleapis.com" && p === "/drive/v3/about") return Response.json({ user: { emailAddress: "benny@example.com" } });
    if (url.hostname === "www.googleapis.com") return Response.json({ files: [{ id: "s1", name: "Leads", webViewLink: "https://sheet/s1" }] });
    if (p === "/v4/spreadsheets" && init?.method === "POST") {
      return Response.json({ spreadsheetId: "new1", spreadsheetUrl: "https://sheet/new1", sheets: [{ properties: { title: "Leads" } }, { properties: { title: "Notes" } }] });
    }
    if (p === "/v4/spreadsheets/s1") {
      return Response.json({ spreadsheetId: "s1", properties: { title: "Leads" }, sheets: [{ properties: { sheetId: 0, title: "Leads", gridProperties: { rowCount: 1000, columnCount: 26 } } }] });
    }
    if (p.endsWith(":append")) return Response.json({ updates: { updatedRange: "Leads!A5:B6", updatedRows: 2 } });
    if (p.startsWith("/v4/spreadsheets/") && p.includes("/values/") && init?.method === "PUT") {
      return Response.json({ updatedRange: "Leads!A1:B2", updatedRows: 2, updatedCells: 4 });
    }
    if (p.includes("/values/")) return Response.json({ range: "Leads!A1:B3", values: [["Name", "Email"], ["Ann", "ann@x.com"]] });
    return Response.json({ error: { message: "Requested entity was not found." } }, { status: 404 });
  }) as typeof fetch;
  return { calls, fetchImpl, token: async () => "t" };
}

const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0]!.text);

test("find_spreadsheets searches Drive for spreadsheets by name, escaped", async () => {
  const s = fakeSheets();
  const res = parse(await callSheetsTool(s.token, "find_spreadsheets", { text: "Ann's leads" }, s.fetchImpl));
  expect(res.spreadsheets).toEqual([{ spreadsheet_id: "s1", title: "Leads", modified: null, link: "https://sheet/s1" }]);
  const q = s.calls[0]!.url.searchParams.get("q")!;
  expect(q).toContain("mimeType = 'application/vnd.google-apps.spreadsheet'");
  expect(q).toContain("name contains 'Ann\\'s leads'");
});

test("get_spreadsheet lists tabs with their size; read_range returns rows", async () => {
  const s = fakeSheets();
  const meta = parse(await callSheetsTool(s.token, "get_spreadsheet", { spreadsheet_id: "s1" }, s.fetchImpl));
  expect(meta.sheets).toEqual([{ sheet_id: 0, title: "Leads", rows: 1000, columns: 26 }]);
  const read = parse(await callSheetsTool(s.token, "read_range", { spreadsheet_id: "s1", range: "Leads!A1:B3" }, s.fetchImpl));
  expect(read).toMatchObject({ rows: 2, values: [["Name", "Email"], ["Ann", "ann@x.com"]] });
  expect(s.calls[1]!.url.pathname).toContain("Leads!A1%3AB3");
});

test("write_range enters values as typed; append_rows inserts after the data", async () => {
  const s = fakeSheets();
  await callSheetsTool(s.token, "write_range", { spreadsheet_id: "s1", range: "Leads!A1", values: [["Total", "=SUM(B2:B9)"]] }, s.fetchImpl);
  expect(s.calls[0]!.method).toBe("PUT");
  expect(s.calls[0]!.url.searchParams.get("valueInputOption")).toBe("USER_ENTERED");
  expect(s.calls[0]!.body.values).toEqual([["Total", "=SUM(B2:B9)"]]);

  const appended = parse(await callSheetsTool(s.token, "append_rows", { spreadsheet_id: "s1", range: "Leads", values: [["Bob", "b@x.com"], ["Cy", "c@x.com"]] }, s.fetchImpl));
  expect(appended).toEqual({ appended_range: "Leads!A5:B6", appended_rows: 2 });
  expect(s.calls[1]!.url.searchParams.get("insertDataOption")).toBe("INSERT_ROWS");
});

test("bad values are rejected before any request", async () => {
  const s = fakeSheets();
  for (const values of [undefined, [], ["not a row"]]) {
    const r = await callSheetsTool(s.token, "append_rows", { spreadsheet_id: "s1", range: "Leads", values }, s.fetchImpl);
    expect(r.isError).toBe(true);
  }
  expect(s.calls).toHaveLength(0);
});

test("create_spreadsheet names the tabs and writes starting rows to the first", async () => {
  const s = fakeSheets();
  const made = parse(await callSheetsTool(s.token, "create_spreadsheet", { title: "CRM", sheet_names: ["Leads", "Notes"], values: [["Name"]] }, s.fetchImpl));
  expect(made).toMatchObject({ created: true, spreadsheet_id: "new1", sheets: ["Leads", "Notes"], rows_written: 2 });
  expect(s.calls[0]!.body).toEqual({ properties: { title: "CRM" }, sheets: [{ properties: { title: "Leads" } }, { properties: { title: "Notes" } }] });
  expect(decodeURIComponent(s.calls[1]!.url.pathname)).toEndWith("/values/'Leads'!A1");
});

test("errors come back as results; the account comes from Drive", async () => {
  const s = fakeSheets();
  const missing = await callSheetsTool(s.token, "get_spreadsheet", { spreadsheet_id: "zz" }, s.fetchImpl);
  expect(missing).toMatchObject({ isError: true });
  expect(missing.content[0]!.text).toBe("Requested entity was not found.");
  expect(await sheetsAccount(s.token, s.fetchImpl)).toBe("benny@example.com");
});
