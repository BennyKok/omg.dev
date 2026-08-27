import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import {
  ensureSessionReadBaseline,
  markSessionRead,
  sessionUnread,
  sessionUnreadMap,
} from "./session-reads.ts";
import {
  indexSessionMessagesDirect,
  latestIndexedAssistantRowids,
  maxIndexedMessageRowid,
} from "./transcript-index.ts";

const originalData = PATHS.data;
let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "omg-session-reads-"));
  PATHS.data = root;
});

afterEach(() => {
  PATHS.data = originalData;
  rmSync(root, { recursive: true, force: true });
});

const assistant = (id: string, text = id) => ({
  id,
  role: "assistant" as const,
  kind: "text" as const,
  text,
  ts: Date.now(),
});
const human = (id: string, text = id) => ({
  id,
  role: "user" as const,
  kind: "text" as const,
  text,
  ts: Date.now(),
});

const VIEWER = "owner@example.com";

describe("session read watermarks", () => {
  test("a turn that lands after the baseline is unread until it is marked", () => {
    ensureSessionReadBaseline(VIEWER);
    indexSessionMessagesDirect("session-a", [assistant("reply")]);

    expect(sessionUnread(VIEWER, "session-a")).toBe(true);
    markSessionRead(VIEWER, "session-a");
    expect(sessionUnread(VIEWER, "session-a")).toBe(false);
  });

  test("your own prompt is not unread activity", () => {
    ensureSessionReadBaseline(VIEWER);
    indexSessionMessagesDirect("session-b", [human("mine")]);

    expect(sessionUnread(VIEWER, "session-b")).toBe(false);
  });

  test("a reply that arrives after you read stays unread again", () => {
    ensureSessionReadBaseline(VIEWER);
    indexSessionMessagesDirect("session-c", [assistant("first")]);
    markSessionRead(VIEWER, "session-c");
    expect(sessionUnread(VIEWER, "session-c")).toBe(false);

    indexSessionMessagesDirect("session-c", [assistant("second")]);
    expect(sessionUnread(VIEWER, "session-c")).toBe(true);
  });

  test("history indexed before the baseline never becomes unread", () => {
    // The archive exists first, exactly as it does on a box that upgrades into
    // this feature. Nothing already written may light up.
    indexSessionMessagesDirect("session-old", [assistant("last march")]);
    ensureSessionReadBaseline(VIEWER);

    expect(sessionUnread(VIEWER, "session-old")).toBe(false);
  });

  test("the baseline is written once and does not move on later reads", () => {
    const first = ensureSessionReadBaseline(VIEWER);
    indexSessionMessagesDirect("session-d", [assistant("reply")]);
    expect(maxIndexedMessageRowid()).toBeGreaterThan(first);
    expect(ensureSessionReadBaseline(VIEWER)).toBe(first);
    expect(sessionUnread(VIEWER, "session-d")).toBe(true);
  });

  test("read state is per person", () => {
    ensureSessionReadBaseline(VIEWER);
    ensureSessionReadBaseline("other@example.com");
    indexSessionMessagesDirect("session-e", [assistant("reply")]);
    markSessionRead(VIEWER, "session-e");

    expect(sessionUnread(VIEWER, "session-e")).toBe(false);
    expect(sessionUnread("other@example.com", "session-e")).toBe(true);
  });

  test("a roster is answered in one pass, and an unseen session is absent from the cursors", () => {
    ensureSessionReadBaseline(VIEWER);
    indexSessionMessagesDirect("session-f", [assistant("reply")]);
    indexSessionMessagesDirect("session-g", [human("mine")]);

    const map = sessionUnreadMap(VIEWER, ["session-f", "session-g", "session-never-indexed"]);
    expect(map.get("session-f")).toBe(true);
    expect(map.get("session-g")).toBe(false);
    expect(map.get("session-never-indexed")).toBe(false);

    const cursors = latestIndexedAssistantRowids(["session-f", "session-g"]);
    expect(cursors.has("session-f")).toBe(true);
    expect(cursors.has("session-g")).toBe(false);
  });

  test("an empty roster asks the index nothing", () => {
    expect(sessionUnreadMap(VIEWER, []).size).toBe(0);
    expect(latestIndexedAssistantRowids([]).size).toBe(0);
  });
});
