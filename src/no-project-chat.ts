import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { installProjectBuilderSkill, PROJECT_BUILDER_SKILL } from "./project-starter.ts";

/** Empty project is intentional, unlike undefined on older session records. */
export const NO_PROJECT = "";

export const NO_PROJECT_INSTRUCTIONS = `# Chat without a project

This conversation has no selected project. This folder is its persistent scratch workspace.
Follow the normal runtime instructions and answer ordinary questions directly.
Do not assume the user wants to build a project, or choose an existing repository for them.
When the user wants to create something, help clarify the outcome in the conversation.
Ask only for details needed to proceed; a website, app, API, or image is a starting point, not a full specification.
Use this workspace for ordinary chat, drafts, and artifacts. For a new software project:

1. Read ${PROJECT_BUILDER_SKILL} completely. Learn the intended outcome, then call omg_create_project with a short, descriptive name.
   It creates and registers a real project folder with Git, a committed README, and the same app-builder skill.
   Use the returned repo.cwd explicitly for shell commands, file edits, builds, and deployment.
   Keep this conversation in Quick Chat; do not move or relabel it. Future chats can select the new project.
2. Follow that skill through implementation, verification, the requested delivery, and the final report.

Keep setup details in agent work. Ask the user about product decisions only when needed to proceed.
Do not change unrelated repositories. Do not claim a project was registered in omg.dev unless it was.
`;

/** One workspace per conversation, outside repository instruction ancestry. */
export async function createNoProjectWorkspace(
  name: string,
  root = join(homedir(), ".omg", "chats"),
): Promise<string> {
  if (!/^[a-zA-Z0-9-]+$/.test(name)) throw new Error("Invalid chat workspace name");
  const cwd = join(root, name);
  await mkdir(cwd, { recursive: true });
  // Do not overwrite user edits when an idempotent request is retried.
  for (const file of ["AGENTS.md", "CLAUDE.md"]) {
    await writeFile(join(cwd, file), NO_PROJECT_INSTRUCTIONS, { flag: "wx" }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
  }
  await installProjectBuilderSkill(cwd);
  return cwd;
}
