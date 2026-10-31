// Failure this must catch: the change-signal watcher cannot start (for
// example EMFILE once the user's inotify instances are used up). subscribe()
// threw, the first socket open crashed serve, and systemd restarted it 36
// times in five minutes on 2026-10-22. A watcher that cannot start must be
// reported through onError, and in-process changes must still arrive.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createChangeBus, type ChangeTopic } from "./change-topics.ts";

const home = mkdtempSync(join(tmpdir(), "omg-change-bus-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));

test("a watcher that cannot start is reported, and the server keeps running", async () => {
  // A regular file in the path makes the signal directory impossible to create
  // or watch, which fails synchronously like EMFILE does.
  const blocker = join(home, "not-a-directory");
  writeFileSync(blocker, "");
  const bus = createChangeBus(() => join(blocker, "change-signals"));
  const heard: ChangeTopic[] = [];
  const errors: Error[] = [];

  let stop: (() => void) | undefined;
  expect(() => { stop = bus.subscribe((topic) => heard.push(topic), (error) => errors.push(error)); }).not.toThrow();
  await new Promise((r) => setTimeout(r, 0));
  expect(errors).toHaveLength(1);

  bus.announce("pins");
  expect(heard).toEqual(["pins"]);
  stop?.();
});

test("a working signal directory reports no failure", async () => {
  const bus = createChangeBus(() => join(home, "signals"));
  const errors: Error[] = [];
  const stop = bus.subscribe(() => {}, (error) => errors.push(error));
  await new Promise((r) => setTimeout(r, 0));
  expect(errors).toEqual([]);
  stop();
});
