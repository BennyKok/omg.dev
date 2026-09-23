// omg's own Google Calendar connector: agent tools over the Calendar REST API
// (www.googleapis.com/calendar/v3).
//
// Same reason as ./gmail.ts: Google's Calendar MCP server answers tool calls
// only for Workspace Developer Preview projects, so omg signs in against its
// resource metadata (for the scopes) and calls REST itself.
//
// Times are RFC 3339 (`2026-09-24T15:00:00+08:00`) or, for all-day events, a
// date (`2026-09-24`). Invitations go out only when send_invites is true, so
// an agent drafting a meeting cannot email guests by accident.
import type { NativeCallResult, NativeTool, TokenSource } from "./gmail.ts";
import { type Fetch, GoogleApiError, errorResult, googleJson, optionalString, requireString, textResult } from "./google-api.ts";

const API = "https://www.googleapis.com/calendar/v3";
const MAX_RESULTS = 100;
const DAY_MS = 86_400_000;

const str = { type: "string" } as const;
const time = { type: "string", description: "RFC 3339 date-time (2026-09-24T15:00:00+08:00), or a date (2026-09-24) for all day." } as const;
const calendarId = { type: "string", description: "Calendar id. Default: primary." } as const;

export const CALENDAR_TOOLS: NativeTool[] = [
  {
    name: "list_calendars",
    description: "List the calendars this account can see, with ids, names, time zones and access role.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_events",
    description:
      "List events between two times, soonest first. Defaults to the next 7 days on the primary calendar. `query` matches text in the title, description, location and attendees.",
    inputSchema: {
      type: "object",
      properties: {
        calendar_id: calendarId,
        time_min: { type: "string", description: "RFC 3339 start. Default: now." },
        time_max: { type: "string", description: "RFC 3339 end. Default: 7 days after time_min." },
        query: str,
        max_results: { type: "number", description: `1 to ${MAX_RESULTS}. Default 25.` },
      },
    },
  },
  {
    name: "find_free_time",
    description:
      "Find open slots of at least duration_minutes between time_min and time_max, across one or more calendars. Returns the busy blocks and the free slots.",
    inputSchema: {
      type: "object",
      properties: {
        time_min: { type: "string", description: "RFC 3339 start." },
        time_max: { type: "string", description: "RFC 3339 end." },
        duration_minutes: { type: "number", description: "Shortest useful slot. Default 30." },
        calendar_ids: { type: "array", items: str, description: "Default: [\"primary\"]. Colleagues' emails work when they share free/busy." },
      },
      required: ["time_min", "time_max"],
    },
  },
  {
    name: "create_event",
    description:
      "Create an event. Guests get an email invitation only when send_invites is true. Set add_meet for a Google Meet link.",
    inputSchema: {
      type: "object",
      properties: {
        calendar_id: calendarId,
        summary: { type: "string", description: "Title." },
        start: time,
        end: time,
        time_zone: { type: "string", description: "IANA zone, e.g. Asia/Hong_Kong. Needed when start has no offset." },
        description: str,
        location: str,
        attendees: { type: "array", items: str, description: "Guest email addresses." },
        add_meet: { type: "boolean" },
        send_invites: { type: "boolean", description: "Email the guests. Default false." },
      },
      required: ["summary", "start", "end"],
    },
  },
  {
    name: "update_event",
    description: "Change an event. Only the fields you pass change. attendees replaces the guest list.",
    inputSchema: {
      type: "object",
      properties: {
        calendar_id: calendarId,
        event_id: str,
        summary: str,
        start: time,
        end: time,
        time_zone: str,
        description: str,
        location: str,
        attendees: { type: "array", items: str },
        send_invites: { type: "boolean", description: "Email the guests about the change. Default false." },
      },
      required: ["event_id"],
    },
  },
  {
    name: "delete_event",
    description: "Delete an event. Guests are told only when send_invites is true.",
    inputSchema: {
      type: "object",
      properties: { calendar_id: calendarId, event_id: str, send_invites: { type: "boolean" } },
      required: ["event_id"],
    },
  },
];

type EventTime = { dateTime?: string; date?: string; timeZone?: string };
type CalEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: EventTime;
  end?: EventTime;
  htmlLink?: string;
  hangoutLink?: string;
  organizer?: { email?: string };
  attendees?: { email?: string; responseStatus?: string; self?: boolean }[];
};

function view(e: CalEvent) {
  return {
    event_id: e.id,
    summary: e.summary ?? "(no title)",
    start: e.start?.dateTime ?? e.start?.date ?? null,
    end: e.end?.dateTime ?? e.end?.date ?? null,
    all_day: !!e.start?.date,
    location: e.location ?? null,
    meet: e.hangoutLink ?? null,
    organizer: e.organizer?.email ?? null,
    attendees: (e.attendees ?? []).map((a) => ({ email: a.email, response: a.responseStatus })),
    link: e.htmlLink ?? null,
    ...(e.description ? { description: e.description.slice(0, 2_000) } : {}),
  };
}

/** A date alone means all day; anything else is a date-time. */
export function eventTime(value: string, timeZone?: string): EventTime {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { date: value };
  return { dateTime: value, ...(timeZone ? { timeZone } : {}) };
}

function calPath(args: Record<string, unknown>): string {
  return encodeURIComponent(optionalString(args, "calendar_id") ?? "primary");
}

function eventBody(args: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const tz = optionalString(args, "time_zone");
  for (const key of ["summary", "description", "location"] as const) {
    if (typeof args[key] === "string") body[key] = args[key];
  }
  if (typeof args.start === "string" && args.start.trim()) body.start = eventTime(args.start.trim(), tz);
  if (typeof args.end === "string" && args.end.trim()) body.end = eventTime(args.end.trim(), tz);
  if (Array.isArray(args.attendees)) {
    body.attendees = args.attendees.filter((a): a is string => typeof a === "string" && a.includes("@")).map((email) => ({ email }));
  }
  return body;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Free slots of at least `minMs` inside [from, to), given busy blocks. */
export function freeSlots(from: number, to: number, busy: { start: number; end: number }[], minMs: number) {
  const sorted = [...busy].sort((a, b) => a.start - b.start);
  const slots: { start: string; end: string; minutes: number }[] = [];
  let cursor = from;
  for (const b of sorted) {
    if (b.start > cursor && b.start - cursor >= minMs) {
      slots.push({ start: iso(cursor), end: iso(Math.min(b.start, to)), minutes: Math.round((Math.min(b.start, to) - cursor) / 60_000) });
    }
    cursor = Math.max(cursor, b.end);
    if (cursor >= to) break;
  }
  if (to - cursor >= minMs) slots.push({ start: iso(cursor), end: iso(to), minutes: Math.round((to - cursor) / 60_000) });
  return slots;
}

export async function callCalendarTool(
  token: TokenSource,
  name: string,
  args: Record<string, unknown>,
  fetchImpl: Fetch = fetch,
): Promise<NativeCallResult> {
  const call = (path: string, init: RequestInit) => googleJson(token, `${API}${path}`, init, fetchImpl, "Calendar");
  try {
    switch (name) {
      case "list_calendars": {
        const res = (await call("/users/me/calendarList", { method: "GET" })) as {
          items?: { id: string; summary?: string; timeZone?: string; accessRole?: string; primary?: boolean }[];
        };
        return textResult({
          calendars: (res.items ?? []).map((c) => ({ calendar_id: c.id, name: c.summary, time_zone: c.timeZone, access: c.accessRole, primary: c.primary === true })),
        });
      }
      case "list_events": {
        const min = optionalString(args, "time_min") ?? iso(Date.now());
        const max = optionalString(args, "time_max") ?? iso(Date.parse(min) + 7 * DAY_MS);
        const params = new URLSearchParams({
          timeMin: min,
          timeMax: max,
          singleEvents: "true",
          orderBy: "startTime",
          maxResults: String(Math.min(Math.max(Number(args.max_results) || 25, 1), MAX_RESULTS)),
        });
        const q = optionalString(args, "query");
        if (q) params.set("q", q);
        const res = (await call(`/calendars/${calPath(args)}/events?${params}`, { method: "GET" })) as { items?: CalEvent[]; timeZone?: string };
        return textResult({ time_zone: res.timeZone ?? null, events: (res.items ?? []).filter((e) => e.status !== "cancelled").map(view) });
      }
      case "find_free_time": {
        const min = requireString(args, "time_min");
        const max = requireString(args, "time_max");
        const from = Date.parse(min);
        const to = Date.parse(max);
        if (Number.isNaN(from) || Number.isNaN(to) || to <= from) throw new GoogleApiError("time_min and time_max must be RFC 3339 times, with time_max later");
        const ids = Array.isArray(args.calendar_ids) && args.calendar_ids.length
          ? args.calendar_ids.filter((x): x is string => typeof x === "string")
          : ["primary"];
        const res = (await call("/freeBusy", {
          method: "POST",
          body: JSON.stringify({ timeMin: iso(from), timeMax: iso(to), items: ids.map((id) => ({ id })) }),
        })) as { calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason?: string }[] }> };
        const busy: { start: number; end: number }[] = [];
        const errors: Record<string, string> = {};
        for (const [id, cal] of Object.entries(res.calendars ?? {})) {
          if (cal.errors?.length) errors[id] = cal.errors.map((e) => e.reason).join(", ");
          for (const b of cal.busy ?? []) busy.push({ start: Date.parse(b.start), end: Date.parse(b.end) });
        }
        const minutes = Math.max(Number(args.duration_minutes) || 30, 1);
        return textResult({
          busy: busy.sort((a, b) => a.start - b.start).map((b) => ({ start: iso(b.start), end: iso(b.end) })),
          free: freeSlots(from, to, busy, minutes * 60_000),
          ...(Object.keys(errors).length ? { calendar_errors: errors } : {}),
        });
      }
      case "create_event": {
        requireString(args, "summary");
        requireString(args, "start");
        requireString(args, "end");
        const body = eventBody(args);
        const params = new URLSearchParams({ sendUpdates: args.send_invites === true ? "all" : "none" });
        if (args.add_meet === true) {
          body.conferenceData = { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } };
          params.set("conferenceDataVersion", "1");
        }
        const e = (await call(`/calendars/${calPath(args)}/events?${params}`, { method: "POST", body: JSON.stringify(body) })) as CalEvent;
        return textResult({ created: true, invites_sent: args.send_invites === true, ...view(e) });
      }
      case "update_event": {
        const id = requireString(args, "event_id");
        const body = eventBody(args);
        if (Object.keys(body).length === 0) throw new GoogleApiError("pass at least one field to change");
        const params = new URLSearchParams({ sendUpdates: args.send_invites === true ? "all" : "none" });
        const e = (await call(`/calendars/${calPath(args)}/events/${encodeURIComponent(id)}?${params}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        })) as CalEvent;
        return textResult({ updated: true, ...view(e) });
      }
      case "delete_event": {
        const id = requireString(args, "event_id");
        const params = new URLSearchParams({ sendUpdates: args.send_invites === true ? "all" : "none" });
        await call(`/calendars/${calPath(args)}/events/${encodeURIComponent(id)}?${params}`, { method: "DELETE" });
        return textResult({ deleted: true, event_id: id });
      }
      default:
        return { content: [{ type: "text", text: `unknown Calendar tool "${name}"` }], isError: true };
    }
  } catch (e) {
    return errorResult(e);
  }
}

/** The account's address: the primary calendar's id is the signed-in email. */
export async function calendarAccount(token: TokenSource, fetchImpl: Fetch = fetch): Promise<string> {
  const cal = (await googleJson(token, `${API}/calendars/primary`, { method: "GET" }, fetchImpl, "Calendar")) as { id?: string };
  return cal.id ?? "";
}
