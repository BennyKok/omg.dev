// The native Calendar connector against a fake Calendar REST API. Pins what
// agents rely on: sensible default windows, all-day vs timed events, no guest
// email unless asked, a Meet link on request, and free slots that are right.
import { expect, test } from "bun:test";
import { calendarAccount, callCalendarTool, eventTime, freeSlots } from "./calendar.ts";

type Call = { method: string; url: URL; body: any };

function fakeCalendar(opts: { expireFirst?: boolean } = {}) {
  const calls: Call[] = [];
  let first = true;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (opts.expireFirst && first) {
      first = false;
      return Response.json({ error: { message: "Invalid Credentials" } }, { status: 401 });
    }
    const p = url.pathname.replace("/calendar/v3", "");
    if (p === "/calendars/primary") return Response.json({ id: "benny@example.com" });
    if (p === "/users/me/calendarList") return Response.json({ items: [{ id: "benny@example.com", summary: "Benny", timeZone: "Asia/Hong_Kong", accessRole: "owner", primary: true }] });
    if (p === "/freeBusy") {
      return Response.json({
        calendars: {
          primary: { busy: [{ start: "2026-09-24T02:00:00Z", end: "2026-09-24T03:00:00Z" }] },
          "ann@x.com": { busy: [{ start: "2026-09-24T02:30:00Z", end: "2026-09-24T04:00:00Z" }], errors: [] },
        },
      });
    }
    if (p === "/calendars/primary/events" && (init?.method ?? "GET") === "GET") {
      return Response.json({
        timeZone: "Asia/Hong_Kong",
        items: [
          { id: "e1", summary: "Standup", start: { dateTime: "2026-09-24T09:00:00+08:00" }, end: { dateTime: "2026-09-24T09:15:00+08:00" }, attendees: [{ email: "ann@x.com", responseStatus: "accepted" }] },
          { id: "e2", status: "cancelled" },
        ],
      });
    }
    if (p === "/calendars/primary/events" && init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      return Response.json({ id: "new1", ...body, hangoutLink: body.conferenceData ? "https://meet.google.com/abc" : undefined });
    }
    if (p.startsWith("/calendars/primary/events/") && init?.method === "PATCH") return Response.json({ id: "e1", summary: "Moved", ...JSON.parse(String(init.body)) });
    if (p.startsWith("/calendars/primary/events/") && init?.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json({ error: { message: "Not Found" } }, { status: 404 });
  }) as typeof fetch;
  const token = async (force?: boolean) => (force ? "fresh" : "stale");
  return { calls, fetchImpl, token };
}

const parse = (r: { content: { text: string }[] }) => JSON.parse(r.content[0]!.text);

test("a date is all day; a date-time keeps its zone", () => {
  expect(eventTime("2026-09-24")).toEqual({ date: "2026-09-24" });
  expect(eventTime("2026-09-24T15:00:00", "Asia/Hong_Kong")).toEqual({ dateTime: "2026-09-24T15:00:00", timeZone: "Asia/Hong_Kong" });
});

test("list_events defaults to the next 7 days, expands recurrences, and drops cancelled events", async () => {
  const c = fakeCalendar();
  const res = parse(await callCalendarTool(c.token, "list_events", {}, c.fetchImpl));
  expect(res.events.map((e: { event_id: string }) => e.event_id)).toEqual(["e1"]);
  expect(res.events[0].attendees).toEqual([{ email: "ann@x.com", response: "accepted" }]);
  const q = c.calls[0]!.url.searchParams;
  expect(q.get("singleEvents")).toBe("true");
  expect(Date.parse(q.get("timeMax")!) - Date.parse(q.get("timeMin")!)).toBe(7 * 86_400_000);
});

test("create_event sends no invitations unless asked, and adds Meet on request", async () => {
  const c = fakeCalendar();
  const made = parse(await callCalendarTool(c.token, "create_event", {
    summary: "Call", start: "2026-09-24T15:00:00", end: "2026-09-24T15:30:00", time_zone: "Asia/Hong_Kong",
    attendees: ["ann@x.com", "not-an-email"], add_meet: true,
  }, c.fetchImpl));
  expect(made).toMatchObject({ created: true, invites_sent: false, meet: "https://meet.google.com/abc" });
  const call = c.calls[0]!;
  expect(call.url.searchParams.get("sendUpdates")).toBe("none");
  expect(call.url.searchParams.get("conferenceDataVersion")).toBe("1");
  expect(call.body.attendees).toEqual([{ email: "ann@x.com" }]);
  expect(call.body.start).toEqual({ dateTime: "2026-09-24T15:00:00", timeZone: "Asia/Hong_Kong" });

  await callCalendarTool(c.token, "create_event", { summary: "Offsite", start: "2026-09-25", end: "2026-09-26", send_invites: true }, c.fetchImpl);
  expect(c.calls[1]!.url.searchParams.get("sendUpdates")).toBe("all");
  expect(c.calls[1]!.body.start).toEqual({ date: "2026-09-25" });
});

test("update_event patches only what was passed; delete_event deletes", async () => {
  const c = fakeCalendar();
  await callCalendarTool(c.token, "update_event", { event_id: "e1", start: "2026-09-24T10:00:00+08:00", end: "2026-09-24T10:30:00+08:00" }, c.fetchImpl);
  expect(c.calls[0]!.method).toBe("PATCH");
  expect(Object.keys(c.calls[0]!.body).sort()).toEqual(["end", "start"]);
  const empty = await callCalendarTool(c.token, "update_event", { event_id: "e1" }, c.fetchImpl);
  expect(empty.isError).toBe(true);
  expect(parse(await callCalendarTool(c.token, "delete_event", { event_id: "e1" }, c.fetchImpl))).toEqual({ deleted: true, event_id: "e1" });
});

test("find_free_time merges every calendar's busy blocks", async () => {
  const c = fakeCalendar();
  const res = parse(await callCalendarTool(c.token, "find_free_time", {
    time_min: "2026-09-24T01:00:00Z", time_max: "2026-09-24T06:00:00Z", duration_minutes: 45, calendar_ids: ["primary", "ann@x.com"],
  }, c.fetchImpl));
  expect(res.free).toEqual([
    { start: "2026-09-24T01:00:00.000Z", end: "2026-09-24T02:00:00.000Z", minutes: 60 },
    { start: "2026-09-24T04:00:00.000Z", end: "2026-09-24T06:00:00.000Z", minutes: 120 },
  ]);
  expect((await callCalendarTool(c.token, "find_free_time", { time_min: "x", time_max: "y" }, c.fetchImpl)).isError).toBe(true);
});

test("freeSlots drops gaps shorter than the minimum and handles overlap at the edges", () => {
  const t = (h: number) => Date.UTC(2026, 8, 24, h);
  expect(freeSlots(t(1), t(5), [{ start: t(0), end: t(2) }, { start: t(2) + 600_000, end: t(6) }], 30 * 60_000)).toEqual([]);
});

test("a 401 refreshes once; the account is the primary calendar id", async () => {
  const c = fakeCalendar({ expireFirst: true });
  expect(await calendarAccount(c.token, c.fetchImpl)).toBe("benny@example.com");
});
