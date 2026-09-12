// The mobile client's half of session read state. The server owns the answer
// (src/session-reads.ts); these are the rules the app applies to it, and they
// have to match web/src/lib/session-unread.ts or one question gets two answers.
import { describe, expect, test } from "bun:test";

import {
  clearSessionUnread,
  fetchSessionsForViewer,
  markSessionRead,
  markSessionReadPath,
  sameUnreadSessions,
  sessionListUrlForViewer,
  unreadSessionIds,
} from "../mobile/src/omg/session-unread";

describe("mobile session unread", () => {
  test("asks for the list as a named viewer, encoded", () => {
    expect(sessionListUrlForViewer("a b+c@omg.dev")).toBe(
      "/api/sessions?user=a%20b%2Bc%40omg.dev",
    );
  });

  test("asks without a viewer when nobody is signed in", () => {
    // Better than sending an empty `user`: the box then resolves the identity
    // itself rather than reading the watermark of the empty-string person.
    expect(sessionListUrlForViewer(null)).toBe("/api/sessions");
    expect(sessionListUrlForViewer("")).toBe("/api/sessions");
  });

  test("takes the unread ids out of a list payload", () => {
    const unread = unreadSessionIds([
      { sessionId: "a", unread: true },
      { sessionId: "b", unread: false },
      { sessionId: "c" },
      // A row with no id cannot be pointed at, so it cannot be unread.
      { sessionId: null, unread: true },
    ]);
    expect([...unread]).toEqual(["a"]);
  });

  test("clearing keeps the same set when there was nothing to clear", () => {
    const unread = new Set(["a"]);
    // Same identity, so opening an already-read session does not re-render
    // every row that keys on the set.
    expect(clearSessionUnread(unread, "b")).toBe(unread);
    const cleared = clearSessionUnread(unread, "a");
    expect(cleared).not.toBe(unread);
    expect(cleared.size).toBe(0);
    expect([...unread]).toEqual(["a"]);
  });

  test("two sets are equal when they hold the same ids", () => {
    expect(sameUnreadSessions(new Set(["a", "b"]), new Set(["b", "a"]))).toBe(true);
    expect(sameUnreadSessions(new Set(["a"]), new Set(["a", "b"]))).toBe(false);
    expect(sameUnreadSessions(new Set(["a"]), new Set(["b"]))).toBe(false);
  });

  test("marking read posts the viewer to that session's read route", async () => {
    const calls: { path: string; init?: RequestInit }[] = [];
    const ok = await markSessionRead(
      {
        request: async <T,>(path: string, init?: RequestInit) => {
          calls.push({ path, init });
          return {} as T;
        },
      },
      "session/one",
      "person@omg.dev",
    );
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/api/sessions/session%2Fone/read");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ user: "person@omg.dev" });
  });

  test("a dropped acknowledgement is not an error the person has to see", async () => {
    // The row simply stays unread and the next open tries again.
    const ok = await markSessionRead(
      {
        request: async () => {
          throw new Error("offline");
        },
      },
      "abc",
      "person@omg.dev",
    );
    expect(ok).toBe(false);
  });

  test("the list fetch asks as the viewer and hands back the unread ids", async () => {
    const seen: string[] = [];
    const unread: Set<string>[] = [];
    const rows = await fetchSessionsForViewer({
      transport: {
        request: async <T,>(path: string) => {
          seen.push(path);
          return {
            sessions: [
              { sessionId: "a", unread: true },
              { sessionId: "b", unread: false },
            ],
          } as T;
        },
      },
      viewer: "person@omg.dev",
      stillCurrent: () => true,
      onUnread: (next) => unread.push(next),
    });
    expect(seen).toEqual(["/api/sessions?user=person%40omg.dev"]);
    expect(rows).toHaveLength(2);
    expect(unread).toHaveLength(1);
    expect([...unread[0]]).toEqual(["a"]);
  });

  test("a payload with no sessions array is an empty list, not a crash", async () => {
    const rows = await fetchSessionsForViewer({
      transport: { request: async <T,>() => ({}) as T },
      viewer: null,
      stillCurrent: () => true,
      onUnread: () => {},
    });
    expect(rows).toEqual([]);
  });

  test("an answer that lands after the machine or the person changed sets no dots", async () => {
    // The real failure this guards: switch computers (or sign in as somebody
    // else) while a list request is in flight, and the slow answer arrives
    // carrying the PREVIOUS viewer's read state.
    let current = true;
    const unread: Set<string>[] = [];
    const rows = await fetchSessionsForViewer({
      transport: {
        request: async <T,>() => {
          // The switch happens while the request is in flight.
          current = false;
          return { sessions: [{ sessionId: "a", unread: true }] } as T;
        },
      },
      viewer: "old@omg.dev",
      stillCurrent: () => current,
      onUnread: (next) => unread.push(next),
    });
    // The rows still come back — what the list does with them is the caller's
    // own guard — but nothing touched the badges.
    expect(rows).toHaveLength(1);
    expect(unread).toEqual([]);
  });

  test("the read route is the one the server serves", () => {
    expect(markSessionReadPath("abc")).toBe("/api/sessions/abc/read");
  });
});
