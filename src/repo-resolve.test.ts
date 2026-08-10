import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoForRequestedSessionCwd, repoContainingCwd } from "./repo-resolve.ts";
import type { RepoEntry } from "./repo-resolve.ts";

// A real repos root on disk: projectName()/worktreeOwnerCheckout() read .git
// off the filesystem, so these cannot be faked with plain strings.
let root = "";
let repos: RepoEntry[] = [];

const entry = (name: string, project = name): RepoEntry => ({
  name,
  cwd: join(root, name),
  project,
});

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "lfg-repo-resolve-"));
  process.env.LFG_REPOS_ROOT = root;

  // A listed repo, with a nested subdirectory.
  await mkdir(join(root, "vibes", ".git"), { recursive: true });
  await mkdir(join(root, "vibes", "apps", "web"), { recursive: true });

  // A linked worktree of it — the shape the picker drops and the finding
  // sheet posts (auto agent house-computer-e2e lives in exactly this).
  await mkdir(join(root, "vibes-e2e"), { recursive: true });
  await writeFile(
    join(root, "vibes-e2e", ".git"),
    `gitdir: ${join(root, "vibes", ".git", "worktrees", "vibes-e2e")}\n`,
  );

  // A standalone repo that is genuinely absent from the picker.
  await mkdir(join(root, "twcli", ".git"), { recursive: true });

  // A plain directory whose basename collides with a listed project.
  await mkdir(join(root, "decoys", "vibes"), { recursive: true });

  repos = [entry("vibes"), entry("lfg")];
});

afterAll(async () => {
  delete process.env.LFG_REPOS_ROOT;
  await rm(root, { recursive: true, force: true });
});

describe("repoForRequestedSessionCwd", () => {
  test("resolves a listed repo and a path nested inside it", () => {
    expect(repoForRequestedSessionCwd(repos, join(root, "vibes"), undefined)?.name).toBe("vibes");
    expect(
      repoForRequestedSessionCwd(repos, join(root, "vibes", "apps", "web"), undefined)?.name,
    ).toBe("vibes");
  });

  // The regression: a worktree is neither listed nor *inside* a listed repo,
  // so containment alone 400'd it. Every "Execute" on a finding from an auto
  // agent running in a worktree died here.
  test("maps a linked worktree back to the checkout that owns it", () => {
    expect(repoForRequestedSessionCwd(repos, join(root, "vibes-e2e"), undefined)?.name).toBe(
      "vibes",
    );
  });

  test("maps a subdirectory of a linked worktree too", async () => {
    await mkdir(join(root, "vibes-e2e", "tests"), { recursive: true });
    expect(
      repoForRequestedSessionCwd(repos, join(root, "vibes-e2e", "tests"), undefined)?.name,
    ).toBe("vibes");
  });

  // The worktree fallback must not become a name-matching backdoor.
  test("a standalone repo missing from the picker stays unresolved", () => {
    expect(repoForRequestedSessionCwd(repos, join(root, "twcli"), undefined)).toBeUndefined();
  });

  test("a non-repo directory sharing a project's basename stays unresolved", () => {
    expect(
      repoForRequestedSessionCwd(repos, join(root, "decoys", "vibes"), undefined),
    ).toBeUndefined();
  });

  test("an unknown path stays unresolved", () => {
    expect(repoForRequestedSessionCwd(repos, join(root, "nope"), undefined)).toBeUndefined();
  });

  test("a subagent cwd inside the parent's cwd still inherits the parent repo", () => {
    const parent = { cwd: join(root, "vibes"), project: "vibes" };
    expect(
      repoForRequestedSessionCwd(repos, join(root, "vibes", "scratch"), parent)?.name,
    ).toBe("vibes");
  });

  test("a relative cwd resolves against the parent", () => {
    const parent = { cwd: join(root, "vibes"), project: "vibes" };
    expect(repoForRequestedSessionCwd(repos, "apps/web", parent)?.name).toBe("vibes");
  });
});

describe("repoContainingCwd", () => {
  test("prefers the longest matching repo root", () => {
    const nested: RepoEntry[] = [
      { name: "outer", cwd: root, project: "outer" },
      entry("vibes"),
    ];
    expect(repoContainingCwd(nested, join(root, "vibes", "apps"))?.name).toBe("vibes");
  });

  test("ignores an empty cwd", () => {
    expect(repoContainingCwd(repos, "   ")).toBeUndefined();
  });
});
