// Unlinking a project.
//
// The picker is built by scanning a directory, so for most projects there was
// nothing to un-add: `removeCustomRepo` filtered a pin list the scanned repo
// was never in, matched nothing, wrote nothing, and returned normally. The UI
// reported "Project removed" over a list that still contained it. These tests
// pin the behaviour that makes removal mean something.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import {
  addCustomRepo,
  hideRepo,
  listCustomRepos,
  listHiddenRepos,
  unhideRepo,
  unlinkRepo,
} from "./repos-store.ts";

function gitRepo(parent: string, name: string): string {
  const cwd = join(parent, name);
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, "README.md"), `# ${name}\n`);
  const init = Bun.spawnSync(["git", "-C", cwd, "init", "-b", "main"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(init.exitCode, init.stderr.toString()).toBe(0);
  return cwd;
}

describe("hidden projects", () => {
  const originalData = PATHS.data;
  const roots: string[] = [];

  function sandbox(): string {
    // realpath the sandbox: the store canonicalises what it records, and on
    // macOS $TMPDIR is a symlink into /private, so comparing against the raw
    // mkdtemp path would fail there for reasons unrelated to the behaviour.
    const root = realpathSync(mkdtempSync(join(tmpdir(), "lfg-hidden-")));
    roots.push(root);
    PATHS.data = join(root, "data");
    return root;
  }

  afterEach(() => {
    PATHS.data = originalData;
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  test("records a hide for a path that was never pinned", async () => {
    const root = sandbox();
    const repo = gitRepo(root, "scanned");

    await unlinkRepo(repo);

    // The whole point: nothing was pinned, so the pin list is untouched, yet
    // the unlink still left a durable record for listRepos() to filter on.
    expect(await listCustomRepos()).toEqual([]);
    expect(await listHiddenRepos()).toEqual([repo]);
  });

  test("unlinking a pinned path both unpins and hides it", async () => {
    const root = sandbox();
    const repo = gitRepo(root, "pinned");
    await addCustomRepo(repo);
    expect(await listCustomRepos()).toHaveLength(1);

    await unlinkRepo(repo);

    // Unpinning alone would not be enough when the same path is ALSO reachable
    // by the scan — it would reappear on the next request.
    expect(await listCustomRepos()).toEqual([]);
    expect(await listHiddenRepos()).toEqual([repo]);
  });

  test("re-adding a folder clears its hide", async () => {
    const root = sandbox();
    const repo = gitRepo(root, "comeback");
    await unlinkRepo(repo);
    expect(await listHiddenRepos()).toEqual([repo]);

    await addCustomRepo(repo);

    // Without this, Browse → "Use this folder" writes the pin, reports success,
    // and the project still never shows up.
    expect(await listHiddenRepos()).toEqual([]);
    expect((await listCustomRepos()).map((r) => r.cwd)).toEqual([repo]);
  });

  test("hides a path that no longer exists on disk", async () => {
    const root = sandbox();
    const gone = join(root, "deleted-out-from-under-us");

    await hideRepo(gone);

    // A folder renamed or removed behind the picker's back must still be
    // removable, or the stale row is permanent.
    expect(await listHiddenRepos()).toEqual([gone]);
  });

  test("hiding is idempotent and unhiding an unknown path is a no-op", async () => {
    const root = sandbox();
    const repo = gitRepo(root, "twice");

    await hideRepo(repo);
    await hideRepo(repo);
    expect(await listHiddenRepos()).toEqual([repo]);

    await unhideRepo(join(root, "never-hidden"));
    expect(await listHiddenRepos()).toEqual([repo]);

    await unhideRepo(repo);
    expect(await listHiddenRepos()).toEqual([]);
  });

  test("tolerates a corrupt hidden-repos file", async () => {
    const root = sandbox();
    mkdirSync(PATHS.data, { recursive: true });
    writeFileSync(join(PATHS.data, "hidden-repos.json"), "{not json");

    expect(await listHiddenRepos()).toEqual([]);

    const repo = gitRepo(root, "after-corruption");
    await hideRepo(repo);
    expect(await listHiddenRepos()).toEqual([repo]);
  });
});
