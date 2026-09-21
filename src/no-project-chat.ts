import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Empty project is intentional, unlike undefined on older session records. */
export const NO_PROJECT = "";

export const NO_PROJECT_INSTRUCTIONS = `# Chat without a project

This conversation has no selected project. This folder is its persistent scratch workspace.
Follow the normal runtime instructions and answer ordinary questions directly.
Do not assume the user wants to build a project, or choose an existing repository for them.
When the user wants to create something, help clarify the outcome in the conversation.
Ask only for details needed to proceed; a website, app, API, or image is a starting point, not a full specification.
Use this workspace for drafts and artifacts until the user selects or creates a project.
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
  return cwd;
}
