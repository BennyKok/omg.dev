import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const PROJECT_BUILDER_SKILL = ".agents/skills/omg-app-builder/SKILL.md";

const PROJECT_INSTRUCTIONS = `# omg.dev project

For initial product creation or first deployment, read \`${PROJECT_BUILDER_SKILL}\` completely and follow it.
Keep later maintenance scoped to the user's request. Preserve existing project instructions and deployment identity.
`;

function skillSourcePath(): string {
  return join(import.meta.dir, "..", "agents", "skills", "omg-app-builder", "SKILL.md");
}

export async function installProjectBuilderSkill(cwd: string): Promise<void> {
  const destination = join(cwd, PROJECT_BUILDER_SKILL);
  await mkdir(join(cwd, ".agents", "skills", "omg-app-builder"), { recursive: true });
  await Bun.write(destination, await Bun.file(skillSourcePath()).text());
}

export async function writeProjectAgentInstructions(cwd: string): Promise<void> {
  for (const file of ["AGENTS.md", "CLAUDE.md"]) {
    await writeFile(join(cwd, file), PROJECT_INSTRUCTIONS, { flag: "wx" });
  }
}
