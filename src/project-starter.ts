import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const PROJECT_BUILDER_SKILL = ".agents/skills/omg-app-builder/SKILL.md";
export const PROJECT_GAME_SKILL = ".agents/skills/omg-game-builder/SKILL.md";
export const PROJECT_WEB_GAME_SKILL = ".agents/skills/omg-web-game-builder/SKILL.md";
export const PROJECT_TEMPLATES = ["blank", "expo", "expo-game", "web-game"] as const;
export type ProjectTemplate = (typeof PROJECT_TEMPLATES)[number];

const PROJECT_INSTRUCTIONS = `# omg.dev project

For initial product creation or first deployment, read \`${PROJECT_BUILDER_SKILL}\` completely and follow it.
Keep later maintenance scoped to the user's request. Preserve existing project instructions and deployment identity.
`;

function skillSourcePath(name = "omg-app-builder"): string {
  return join(import.meta.dir, "..", "agents", "skills", name, "SKILL.md");
}

/**
 * Templates that start from another template. The base is copied first, then
 * the overlay replaces and adds files, so the game kit does not fork the Expo
 * configuration, scripts or dependencies.
 */
const TEMPLATE_BASE: Partial<Record<ProjectTemplate, Exclude<ProjectTemplate, "blank">>> = {
  "expo-game": "expo",
};

/** The skill a template installs in the project, beside omg-app-builder. */
const TEMPLATE_SKILL: Partial<Record<ProjectTemplate, { name: string; path: string }>> = {
  "expo-game": { name: "omg-game-builder", path: PROJECT_GAME_SKILL },
  "web-game": { name: "omg-web-game-builder", path: PROJECT_WEB_GAME_SKILL },
};

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
  const replacements = { __OMG_PROJECT_NAME__: name, __OMG_PROJECT_SLUG__: projectSlug(name) };
  const base = TEMPLATE_BASE[template];
  if (base) await copyTemplateTree(templateSourcePath(base), cwd, replacements);
  await copyTemplateTree(templateSourcePath(template), cwd, replacements);
  if (template === "expo-game") {
    // The overlay adds no dependencies; it only needs a test script on top of the base package.json.
    const pkgPath = join(cwd, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { scripts?: Record<string, string> };
    pkg.scripts = { ...pkg.scripts, test: "bun test" };
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  const skill = TEMPLATE_SKILL[template];
  if (skill) {
    await mkdir(join(cwd, dirname(skill.path)), { recursive: true });
    await Bun.write(join(cwd, skill.path), await Bun.file(skillSourcePath(skill.name)).text());
  }
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
