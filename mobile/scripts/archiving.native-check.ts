/** A session being archived stays hidden until the machine drops it, and comes back if the close fails. */
import { beforeEach, expect, test } from "bun:test";
import {
  archiveSession,
  archivingSessionIds,
  forgetArchivedSessions,
  resetArchivingForTests,
} from "../src/omg/archiving";

beforeEach(() => resetArchivingForTests());

test("hides the session before the close is answered", async () => {
  let answer!: () => void;
  const pending = archiveSession("s1", () => new Promise<void>((resolve) => (answer = resolve)));
  expect(archivingSessionIds().has("s1")).toBe(true);
  answer();
  await pending;
  // Still hidden: a list fetched before the close can still carry it.
  expect(archivingSessionIds().has("s1")).toBe(true);
});

test("a list that still carries it keeps it hidden; one without it forgets it", async () => {
  await archiveSession("s1", async () => ({}));
  forgetArchivedSessions(["s1", "s2"]);
  expect(archivingSessionIds().has("s1")).toBe(true);
  forgetArchivedSessions(["s2"]);
  expect(archivingSessionIds().has("s1")).toBe(false);
});

test("a refused close puts the session back and rejects", async () => {
  await expect(archiveSession("s1", async () => { throw new Error("409 session is busy"); })).rejects.toThrow("busy");
  expect(archivingSessionIds().has("s1")).toBe(false);
});

test("a session that was already gone counts as archived", async () => {
  await archiveSession("s1", async () => { throw new Error("404 session not found"); });
  expect(archivingSessionIds().has("s1")).toBe(true);
});
