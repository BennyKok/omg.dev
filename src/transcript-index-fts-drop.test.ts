// The fts5 mirror was meant to be dropped by migration 12. An earlier build
// stamped user_version 12 before the drop step ran, so installs exist at 12
// that still carry the mirror (1.1 GB on one box). These pin that opening the
// index drops it whatever the version says, and that a fresh index ends at 12.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import { indexSessionMessagesDirect, resetTranscriptIndexConnectionForTests } from "./transcript-index.ts";

const originalData = PATHS.data;
let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "lfg-fts-drop-"));
  PATHS.data = join(root, "data");
  mkdirSync(PATHS.data, { recursive: true });
  resetTranscriptIndexConnectionForTests();
});

afterEach(() => {
  resetTranscriptIndexConnectionForTests();
  PATHS.data = originalData;
  rmSync(root, { recursive: true, force: true });
});

const dbFile = () => join(PATHS.data, "transcript-index.sqlite");
const tables = (db: Database) =>
  db.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE name LIKE 'transcript_messages_fts%'").all();
const version = (db: Database) => db.query<{ user_version: number }, []>("PRAGMA user_version").get()!.user_version;

function openIndex() {
  indexSessionMessagesDirect("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", [
    { id: "u1", role: "user", kind: "text", text: "hello", ts: 1_000 },
  ]);
  resetTranscriptIndexConnectionForTests();
}

test("a fresh index ends at version 12 with no mirror", () => {
  openIndex();
  const db = new Database(dbFile(), { readonly: true });
  expect(version(db)).toBe(12);
  expect(tables(db)).toEqual([]);
  db.close();
});

test("an index stamped 12 that still holds the mirror loses it on open", () => {
  openIndex();
  const seeded = new Database(dbFile());
  seeded.exec("CREATE VIRTUAL TABLE transcript_messages_fts USING fts5(text)");
  seeded.exec("INSERT INTO transcript_messages_fts(text) VALUES ('old mirror row')");
  expect(tables(seeded).length).toBeGreaterThan(1);
  expect(version(seeded)).toBe(12);
  seeded.close();

  openIndex();
  const db = new Database(dbFile(), { readonly: true });
  expect(tables(db)).toEqual([]);
  expect(version(db)).toBe(12);
  expect(db.query("SELECT count(*) AS n FROM transcript_messages").get()).toEqual({ n: 1 });
  db.close();
});
