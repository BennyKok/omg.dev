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
Use this workspace for ordinary chat, drafts, and artifacts. For a new software project:

1. Learn the intended outcome, then call omg_create_project with a short, descriptive name.
   It creates and registers a real project folder with a committed README and Git repository.
   Use the returned repo.cwd explicitly for shell commands, file edits, builds, and deployment.
   Preserve its .git directory. Do not assume a starter app or dev server already exists.
   Keep this conversation in Quick Chat; do not move or relabel it. Future chats can select the new project.
2. For a new website or web app, prefer the supported omg.dev hosting and backend unless the user requests another stack.
   Read https://docs.omg.dev/llms.txt and the relevant sections of https://docs.omg.dev/llms-full.txt before scaffolding.
   Use the SDK overview, schema, and auth sections for apps with data or a backend; static deploy guidance for static sites.
   Install the dependencies and create the configuration that the current docs require in the new folder.
   The hosted sandbox examples assume a preinstalled starter; this folder has only a README and Git.
   Do not install the retired CLI or ask the user to configure infrastructure credentials.
   Use the runtime's omg_deploy tool for publication, even if old docs mention another deploy command.
   If docs or hosting are unavailable, report the specific gap; do not invent API contracts or a deployed result.
3. Build and test the requested behavior. For data-backed apps, verify real persistence and the required access controls.
   Do not substitute mock data or browser storage for a requested shared backend.
   Record how to run and maintain the project in its README. Commit the finished source locally so future isolated sessions can use it.
4. For a new web project, the default outcome is a working hosted preview and a link.
   Respect requests for local-only work, drafts, or restricted publication, and any applicable approval requirements.
   Call omg_deploy with cwd set to repo.cwd and wait: true when publication is within that scope.
   Reuse the saved .omg/project.json on later deploys. The runtime supplies the Cloud credential.
   After a successful deploy, commit the non-secret .omg/project.json link locally with the source so future worktrees inherit the same app identity.
   Verify the returned live URL in a browser and exercise the relevant backend behavior before reporting success.
   Show a screenshot of the live page with omg_display_image and return the actual clickable URL.
   Tell the user the project is available for future chats. If deployment or verification fails, report that state accurately.

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
  return cwd;
}
