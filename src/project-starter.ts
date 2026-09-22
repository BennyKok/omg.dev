import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const PROJECT_BUILDER_SKILL = ".agents/skills/omg-app-builder/SKILL.md";
export const PROJECT_TEMPLATES = ["blank", "expo"] as const;
export type ProjectTemplate = (typeof PROJECT_TEMPLATES)[number];

const PROJECT_INSTRUCTIONS = `# omg.dev project

For initial product creation or first deployment, read \`${PROJECT_BUILDER_SKILL}\` completely and follow it.
Keep later maintenance scoped to the user's request. Preserve existing project instructions and deployment identity.
`;

function skillSourcePath(): string {
  return join(import.meta.dir, "..", "agents", "skills", "omg-app-builder", "SKILL.md");
}

function templateSourcePath(template: Exclude<ProjectTemplate, "blank">): string {
  return join(import.meta.dir, "..", "agents", "templates", template);
}

function projectSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "expo-app";
}

async function copyTemplateTree(source: string, destination: string, replacements: Record<string, string>): Promise<void> {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) {
      await copyTemplateTree(from, to, replacements);
      continue;
    }
    if (!entry.isFile()) continue;
    await mkdir(dirname(to), { recursive: true });
    if (entry.name.endsWith(".png") || entry.name.endsWith(".jpg") || entry.name.endsWith(".ico")) {
      await copyFile(from, to);
      continue;
    }
    let contents = await readFile(from, "utf8");
    for (const [token, value] of Object.entries(replacements)) contents = contents.replaceAll(token, value);
    await writeFile(to, contents);
  }
}

export function isProjectTemplate(value: unknown): value is ProjectTemplate {
  return typeof value === "string" && PROJECT_TEMPLATES.includes(value as ProjectTemplate);
}

export async function installProjectTemplate(cwd: string, template: ProjectTemplate, name: string): Promise<void> {
  if (template === "blank") {
    await Bun.write(join(cwd, "README.md"), `# ${name}\n`);
    return;
  }
  await copyTemplateTree(templateSourcePath(template), cwd, {
    __OMG_PROJECT_NAME__: name,
    __OMG_PROJECT_SLUG__: projectSlug(name),
  });
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
