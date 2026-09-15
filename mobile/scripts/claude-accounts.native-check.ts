/**
 * The box can hold several Claude logins. Only the web could ever see them, so
 * with two accounts there was no way to tell which one a session would bill to.
 */
import { expect, test } from "bun:test";

/** Mirrors the labelling rule in session-options.ts's accountOptions. */
function labelsFor(accounts: { label: string; profile?: { label: string; detail?: string };
  connected: boolean; needsReconnect?: boolean }[]) {
  const seen = new Map<string, number>();
  for (const a of accounts) if (a.profile?.label) seen.set(a.profile.label, (seen.get(a.profile.label) ?? 0) + 1);
  return accounts.map((a) => {
    const email = a.profile?.label;
    const who = !email ? a.label : (seen.get(email) ?? 0) > 1 ? `${a.label} · ${email}` : email;
    const note = a.needsReconnect ? "needs reconnecting" : !a.connected ? "not connected" : a.profile?.detail;
    return note ? `${who} · ${note}` : who;
  });
}

const connected = (label: string, email: string, detail = "Max") =>
  ({ label, profile: { label: email, detail }, connected: true });

test("a login is named by who it is, not by its ordinal", () => {
  expect(labelsFor([
    connected("Claude 1", "itechbenny@gmail.com"),
    connected("Claude 2", "myomgdev@gmail.com"),
  ])).toEqual(["itechbenny@gmail.com · Max", "myomgdev@gmail.com · Max"]);
});

/**
 * Seen on Benny's box: a second row for the same email, never connected. Named
 * by email alone both rows read identically, which is the ambiguity the
 * synthetic label exists to resolve.
 */
test("two rows carrying the same login stay tellable apart", () => {
  const labels = labelsFor([
    connected("Claude 1", "itechbenny@gmail.com"),
    connected("Claude 2", "myomgdev@gmail.com"),
    { label: "Claude 3", profile: { label: "itechbenny@gmail.com" }, connected: false },
  ]);
  expect(new Set(labels).size).toBe(labels.length);
  expect(labels[0]).toContain("Claude 1");
  expect(labels[2]).toContain("Claude 3");
});

test("a login that cannot serve says why, rather than going missing", () => {
  expect(labelsFor([{ label: "Claude 2", profile: { label: "a@b.com" }, connected: false, needsReconnect: true }]))
    .toEqual(["a@b.com · needs reconnecting"]);
  expect(labelsFor([{ label: "Claude 2", profile: { label: "a@b.com" }, connected: false }]))
    .toEqual(["a@b.com · not connected"]);
});

test("a login with no profile falls back to its ordinal rather than blank", () => {
  expect(labelsFor([{ label: "Claude 2", connected: true }])).toEqual(["Claude 2"]);
});
