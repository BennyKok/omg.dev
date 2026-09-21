import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNoProjectWorkspace, NO_PROJECT_INSTRUCTIONS } from "./no-project-chat";
import { PROJECT_BUILDER_SKILL } from "./project-starter";

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
