import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNoProjectWorkspace, existingNoProjectWorkspace, noProjectChatsRoot, NO_PROJECT_INSTRUCTIONS } from "./no-project-chat";
import { PROJECT_BUILDER_SKILL } from "./project-starter";

test("finding launches recognize an existing Quick Chat workspace and retain its artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "omg-chat-finding-"));
  try {
    const cwd = await createNoProjectWorkspace("lfg-972003", root);
    await writeFile(join(cwd, "report.txt"), "Signup findings");
    expect(await existingNoProjectWorkspace(` ${cwd}/ `, root)).toBe(cwd);
    expect(await readFile(join(cwd, "report.txt"), "utf8")).toBe("Signup findings");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("chat recognition rejects missing, nested, outside, and symlink escape paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "omg-chat-boundary-"));
  try {
    const chats = join(root, "chats");
    const outside = join(root, "outside");
    await mkdir(join(chats, "lfg-123456", "nested"), { recursive: true });
    await mkdir(outside);
    await symlink(outside, join(chats, "lfg-escape"));
    await writeFile(join(chats, "lfg-file"), "Not a workspace");
    for (const cwd of [undefined, "", chats, outside, join(chats, "missing"),
      join(chats, "lfg-123456", "nested"), join(chats, "lfg-escape"), join(chats, "lfg-file")]) {
      expect(await existingNoProjectWorkspace(cwd, chats)).toBeUndefined();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("each unassigned chat has a persistent workspace and project guidance", async () => {
  const root = await mkdtemp(join(tmpdir(), "omg-chat-"));
  try {
    const first = await createNoProjectWorkspace("first-chat", root);
    const second = await createNoProjectWorkspace("second-chat", root);
    expect(first).not.toBe(second);
    for (const file of ["AGENTS.md", "CLAUDE.md"]) {
      expect(await readFile(join(first, file), "utf8")).toBe(NO_PROJECT_INSTRUCTIONS);
    }
    expect(await readFile(join(first, PROJECT_BUILDER_SKILL), "utf8")).toContain("name: omg-app-builder");
    await writeFile(join(first, "draft.txt"), "Keep this draft");
    await writeFile(join(first, "AGENTS.md"), "User instructions");
    expect(await createNoProjectWorkspace("first-chat", root)).toBe(first);
    expect(await readFile(join(first, "draft.txt"), "utf8")).toBe("Keep this draft");
    expect(await readFile(join(first, "AGENTS.md"), "utf8")).toBe("User instructions");
    await expect(createNoProjectWorkspace("../escape", root)).rejects.toThrow("Invalid chat workspace name");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the default chat root avoids a root-owned runtime directory", async () => {
  const home = await mkdtemp(join(tmpdir(), "omg-chat-home-"));
  try {
    await mkdir(join(home, ".omg"));
    await chmod(join(home, ".omg"), 0o555);
    const root = noProjectChatsRoot(home, "");
    expect(root).toBe(join(home, ".local", "share", "omg", "chats"));
    expect(await createNoProjectWorkspace("new-app", root)).toBe(join(root, "new-app"));
  } finally {
    await chmod(join(home, ".omg"), 0o755).catch(() => {});
    await rm(home, { recursive: true, force: true });
  }
});
