import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FolderDeleteError,
  deleteFolder,
  isDirEmpty,
  planFolderDelete,
  type FolderDeleteGuards,
} from "./folder-delete.ts";

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  return result.stdout.toString().trim();
}

function initRepo(cwd: string) {
  git(cwd, "init", "-b", "main");
  git(cwd, "config", "user.email", "test@localhost");
  git(cwd, "config", "user.name", "Test");
}

function commitAll(cwd: string, message: string) {
  git(cwd, "add", "-A");
  git(cwd, "commit", "-m", message);
}

describe("folder delete", () => {
  const roots: string[] = [];

  function makeHome(): { home: string; guards: FolderDeleteGuards } {
    // realpath so macOS /var -> /private/var does not make every containment
    // check fail against the canonicalised target.
    const home = realpathSync(mkdtempSync(join(tmpdir(), "lfg-folder-delete-")));
    roots.push(home);
    const guards: FolderDeleteGuards = {
      home,
      reposRoot: join(home, "repos"),
      worktreeRoot: join(home, "lfg-worktrees"),
      selfRepo: join(home, "repos", "lfg"),
      dataDir: join(home, "repos", "lfg", "data"),
    };
    mkdirSync(guards.dataDir, { recursive: true });
    mkdirSync(guards.worktreeRoot, { recursive: true });
    return { home, guards };
  }

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  test("reports an empty folder as unused and deletes it", async () => {
    const { guards } = makeHome();
    const target = join(guards.reposRoot, "stray");
    mkdirSync(target);

    const plan = await planFolderDelete(target, guards);
    expect(plan.empty).toBe(true);
    expect(plan.entryCount).toBe(0);
    expect(plan.looksUnused).toBe(true);
    expect(plan.warnings).toEqual([]);

    await deleteFolder(target, guards);
    expect(existsSync(target)).toBe(false);
  });

  // The folders this feature exists to clean up are scaffolded, not empty.
  test("treats a scaffolded starter project as unused", async () => {
    const { guards } = makeHome();
    const target = join(guards.reposRoot, "abandoned");
    mkdirSync(target);
    writeFileSync(join(target, "README.md"), "# abandoned\n");
    initRepo(target);
    commitAll(target, "Initial commit");

    const plan = await planFolderDelete(target, guards);
    expect(plan.empty).toBe(false);
    expect(plan.isGitRepo).toBe(true);
    expect(plan.looksUnused).toBe(true);
    expect(plan.warnings).toEqual([]);
  });

  // "Contains 2 items" printed next to a list of three names reads as a bug and
  // undermines the warning it appears in.
  test("the item count matches the names it is shown beside, and hides .git", async () => {
    const { guards } = makeHome();
    const target = join(guards.reposRoot, "counted");
    mkdirSync(target);
    writeFileSync(join(target, "README.md"), "# counted\n");
    writeFileSync(join(target, "index.ts"), "export const a = 1;\n");
    writeFileSync(join(target, "notes.md"), "keep\n");
    initRepo(target);
    commitAll(target, "Initial commit");

    const plan = await planFolderDelete(target, guards);
    expect(plan.entries).not.toContain(".git");
    expect(plan.entryCount).toBe(plan.entries.length);
    expect(plan.warnings.join(" ")).toContain(`${plan.entryCount} items`);
  });

  test("warns about real contents and does not call them unused", async () => {
    const { guards } = makeHome();
    const target = join(guards.reposRoot, "real");
    mkdirSync(target);
    writeFileSync(join(target, "index.ts"), "export const a = 1;\n");
    writeFileSync(join(target, "notes.md"), "keep me\n");

    const plan = await planFolderDelete(target, guards);
    expect(plan.looksUnused).toBe(false);
    expect(plan.entryCount).toBe(2);
    expect(plan.entries.sort()).toEqual(["index.ts", "notes.md"]);
    expect(plan.warnings.join(" ")).toContain("2 items");
  });

  test("warns about uncommitted changes", async () => {
    const { guards } = makeHome();
    const target = join(guards.reposRoot, "dirty");
    mkdirSync(target);
    writeFileSync(join(target, "README.md"), "# dirty\n");
    initRepo(target);
    commitAll(target, "Initial commit");
    writeFileSync(join(target, "README.md"), "# dirty edited\n");

    const plan = await planFolderDelete(target, guards);
    expect(plan.gitDirty).toBe(true);
    expect(plan.looksUnused).toBe(false);
    expect(plan.warnings[0]).toContain("uncommitted");
  });

  test("warns when unbacked-up history would be lost", async () => {
    const { guards } = makeHome();
    const target = join(guards.reposRoot, "history");
    mkdirSync(target);
    writeFileSync(join(target, "README.md"), "# history\n");
    initRepo(target);
    commitAll(target, "one");
    writeFileSync(join(target, "README.md"), "# history 2\n");
    commitAll(target, "two");

    const plan = await planFolderDelete(target, guards);
    expect(plan.looksUnused).toBe(false);
    expect(plan.warnings.join(" ")).toContain("not backed up");
  });

  describe("guards", () => {
    async function refusal(path: string, guards: FolderDeleteGuards) {
      return await planFolderDelete(path, guards).then(
        () => null,
        (e: unknown) => e as FolderDeleteError,
      );
    }

    test("refuses the home folder itself", async () => {
      const { home, guards } = makeHome();
      const e = await refusal(home, guards);
      expect(e?.status).toBe(400);
      expect(e?.message).toContain("home folder");
    });

    test("refuses the repos root itself but not a project inside it", async () => {
      const { guards } = makeHome();
      const inside = join(guards.reposRoot, "ok");
      mkdirSync(inside);

      expect((await refusal(guards.reposRoot, guards))?.message).toContain("projects folder");
      expect(await refusal(inside, guards)).toBeNull();
    });

    test("refuses LFG's own installation and the worktree root", async () => {
      const { guards } = makeHome();
      expect((await refusal(guards.selfRepo, guards))?.message).toContain("installation");
      expect((await refusal(guards.worktreeRoot, guards))?.message).toContain("worktree");
    });

    // Deleting an ancestor takes the guarded path with it, so "is it a guarded
    // path" is not a sufficient test on its own.
    test("refuses a folder that contains a guarded path", async () => {
      const { guards } = makeHome();
      const e = await refusal(join(guards.reposRoot, ".."), guards);
      expect(e?.message).toContain("home folder");
    });

    test("refuses paths outside the home folder", async () => {
      const { guards } = makeHome();
      const outside = realpathSync(mkdtempSync(join(tmpdir(), "lfg-outside-")));
      roots.push(outside);
      const e = await refusal(outside, guards);
      expect(e?.status).toBe(403);
    });

    test("refuses a missing path and a file", async () => {
      const { guards } = makeHome();
      expect((await refusal(join(guards.reposRoot, "nope"), guards))?.status).toBe(400);
      const file = join(guards.reposRoot, "a-file");
      mkdirSync(guards.reposRoot, { recursive: true });
      writeFileSync(file, "x");
      expect((await refusal(file, guards))?.message).toBe("not a folder");
    });

    // The plan is advisory, not an authorization token: confirming does not
    // widen what may be removed.
    test("re-checks guards on delete, not just on plan", async () => {
      const { home, guards } = makeHome();
      await expect(deleteFolder(home, guards)).rejects.toThrow("home folder");
      expect(existsSync(home)).toBe(true);
    });
  });

  test("removes a linked worktree through git so no stale registration is left", async () => {
    const { guards } = makeHome();
    const repo = join(guards.reposRoot, "owner");
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, "README.md"), "# owner\n");
    initRepo(repo);
    commitAll(repo, "Initial commit");

    const wt = join(guards.worktreeRoot, "session_x");
    git(repo, "worktree", "add", "-b", "session_x", wt);
    expect(existsSync(wt)).toBe(true);

    await deleteFolder(wt, guards);

    expect(existsSync(wt)).toBe(false);
    expect(git(repo, "worktree", "list")).not.toContain(wt);
  });

  test("isDirEmpty sees dotfiles", async () => {
    const { guards } = makeHome();
    const target = join(guards.reposRoot, "dotted");
    mkdirSync(target, { recursive: true });
    expect(await isDirEmpty(target)).toBe(true);
    writeFileSync(join(target, ".hidden"), "x");
    expect(await isDirEmpty(target)).toBe(false);
  });
});
