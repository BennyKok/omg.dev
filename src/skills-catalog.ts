import { readdir } from "node:fs/promises";
import { readFileSync, type Dirent } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PATHS } from "./config.ts";
import type { SkillCatalogItem } from "./agent-catalog.ts";

function parseSkillFrontmatter(text: string): { name?: string; description?: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const fm = m[1];
  const field = (name: string) => {
    const line = fm.match(new RegExp(`^${name}:\\s*(.*)$`, "m"))?.[1]?.trim();
    if (!line) return undefined;
    return line.replace(/^["']|["']$/g, "").trim();
  };
  return { name: field("name"), description: field("description") };
}

function skillDescriptionFallback(text: string): string {
  const body = text.replace(/^---\n[\s\S]*?\n---\s*/, "");
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && !line.startsWith("```"));
  const useLine = lines.find((line) => /^use this skill\b/i.test(line));
  return (useLine || lines[0] || "").replace(/\s+/g, " ").slice(0, 240);
}

function skillSearchKeywords(text: string): string {
  return text
    .replace(/^---\n[\s\S]*?\n---\s*/, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[`*_#[\](){}<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

const SKILL_INDEX_TTL_MS = 60_000;
const SKILL_INDEX_STALE_MS = 5 * 60_000;

type SkillIndex = {
  key: string;
  builtAt: number;
  items: SkillCatalogItem[];
};

const skillIndexes = new Map<string, SkillIndex>();
const skillRefreshes = new Map<string, Promise<SkillCatalogItem[]>>();

type SkillRoot = { root: string; source: SkillCatalogItem["source"] };

function grokCompatibility(home: string, provider: "claude" | "cursor"): boolean {
  const override = process.env[`GROK_${provider.toUpperCase()}_SKILLS_ENABLED`];
  if (override !== undefined) {
    const value = override.trim().toLowerCase();
    if (value === "true" || value === "1") return true;
    if (value === "false" || value === "0") return false;
  }
  try {
    const config = Bun.TOML.parse(readFileSync(join(process.env.GROK_HOME || join(home, ".grok"), "config.toml"), "utf8")) as {
      compat?: { claude?: { skills?: boolean }; cursor?: { skills?: boolean } };
    };
    return config.compat?.[provider]?.skills !== false;
  } catch {
    return true;
  }
}

/** Native discovery roots only; plugin caches are not portable between agents. */
export function skillCatalogRoots(
  repoRoots: string[],
  agent?: string,
  home = homedir(),
  selfRepo = PATHS.root,
): { roots: SkillRoot[]; pluginRoots: SkillRoot[] } {
  const homes = {
    codex: process.env.CODEX_HOME || join(home, ".codex"),
    claude: process.env.CLAUDE_HOME || join(home, ".claude"),
    grok: process.env.GROK_HOME || join(home, ".grok"),
  };
  const projects = agent === undefined ? [selfRepo, ...repoRoots] : repoRoots;
  const roots: SkillRoot[] = [];
  const pluginRoots: SkillRoot[] = [];
  const add = (source: SkillCatalogItem["source"], global: string, local: string) => {
    roots.push({ root: global, source });
    for (const cwd of projects) roots.push({ root: join(cwd, local), source });
  };
  const plugins = (source: "codex" | "claude") => {
    const entry = { root: join(homes[source], "plugins", "cache"), source };
    roots.push(entry);
    pluginRoots.push(entry);
  };
  if (agent === undefined) {
    // Preserve the unscoped API for clients that do not send an agent yet.
    add("codex", join(homes.codex, "skills"), ".codex/skills");
    add("claude", join(homes.claude, "skills"), ".claude/skills");
    plugins("codex");
    plugins("claude");
    for (const cwd of [selfRepo, ...repoRoots]) {
      roots.push({ root: join(cwd, ".agents", "skills"), source: "agent" });
      roots.push({ root: join(cwd, "skills"), source: "agent" });
      roots.push({ root: join(cwd, "packages", "skills", "skills"), source: "agent" });
    }
  } else {
    switch (agent) {
      case "claude":
      case "aisdk":
        add("claude", join(homes.claude, "skills"), ".claude/skills");
        plugins("claude");
        break;
      case "codex":
      case "codex-aisdk":
        add("codex", join(homes.codex, "skills"), ".codex/skills");
        add("agent", join(home, ".agents", "skills"), ".agents/skills");
        plugins("codex");
        break;
      case "grok":
        add("grok", join(homes.grok, "skills"), ".grok/skills");
        add("agent", join(home, ".agents", "skills"), ".agents/skills");
        if (grokCompatibility(home, "claude")) add("claude", join(homes.claude, "skills"), ".claude/skills");
        if (grokCompatibility(home, "cursor")) add("agent", join(home, ".cursor", "skills"), ".cursor/skills");
        break;
      case "opencode":
        add("agent", join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "opencode", "skills"), ".opencode/skills");
        add("claude", join(homes.claude, "skills"), ".claude/skills");
        add("agent", join(home, ".agents", "skills"), ".agents/skills");
        break;
      case "cursor":
        add("agent", join(home, ".cursor", "skills"), ".cursor/skills");
        add("agent", join(home, ".agents", "skills"), ".agents/skills");
        add("claude", join(homes.claude, "skills"), ".claude/skills");
        add("codex", join(homes.codex, "skills"), ".codex/skills");
        break;
      case "pi":
        add("agent", join(home, ".pi", "agent", "skills"), ".pi/skills");
        add("agent", join(home, ".agents", "skills"), ".agents/skills");
        break;
    }
  }
  return { roots, pluginRoots };
}

function cacheKey(repoRoots: string[]): string {
  return [...new Set(repoRoots.map((root) => root.trim()).filter(Boolean))]
    .sort()
    .join("\n");
}

function validSkillItem(item: SkillCatalogItem): boolean {
  return (
    !!item.name.trim() &&
    !!item.trigger.trim() &&
    !/\s/.test(item.trigger) &&
    // SKILL.md for skills, <command>.md for plugin commands.
    item.path.endsWith(".md")
  );
}

async function findSkillFiles(root: string, maxDepth = 6): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth: number) {
    if (depth > maxDepth) return;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name === "SKILL.md")) {
      out.push(join(dir, "SKILL.md"));
      return;
    }
    await Promise.all(
      entries
        .filter((e) => e.isDirectory() && !e.name.startsWith(".git"))
        .map((e) => walk(join(dir, e.name), depth + 1)),
    );
  }
  await walk(root, 0);
  return out;
}

/**
 * Plugin *commands* — `<plugin>/<version>/commands/**\/*.md`. The agent offers
 * these exactly like skills (`/ralph-loop:help`), so omitting them left the
 * app's list disagreeing with what could actually be run. Note some plugins
 * ship commands and no skills at all.
 */
async function findPluginCommandFiles(root: string, maxDepth = 8): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth: number, inCommands: boolean) {
    if (depth > maxDepth) return;
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    await Promise.all(
      entries.map(async (e) => {
        // AppleDouble sidecars (`._foo.md`) sit next to the real file on
        // anything that has touched a Mac volume; they are not commands.
        if (e.name.startsWith("._")) return;
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name.startsWith(".git")) return;
          await walk(full, depth + 1, inCommands || e.name === "commands");
          return;
        }
        if (inCommands && e.isFile() && e.name.toLowerCase().endsWith(".md")) out.push(full);
      }),
    );
  }
  await walk(root, 0, false);
  return out;
}

/**
 * "<plugin>:<command>" for a plugin command path, mirroring how the agent
 * addresses it. Nested command dirs namespace with ":" the same way the agent
 * does (commands/tasks/build.md -> notion:tasks:build).
 */
function pluginCommandTrigger(commandPath: string): string | null {
  const parts = commandPath.split(/[\\/]+/);
  const cacheIdx = parts.lastIndexOf("cache");
  const cmdIdx = parts.indexOf("commands", cacheIdx >= 0 ? cacheIdx : 0);
  if (cacheIdx < 0 || cmdIdx < 0 || cacheIdx + 3 > cmdIdx) return null;
  const plugin = parts[cacheIdx + 2];
  const name = parts
    .slice(cmdIdx + 1)
    .join(":")
    .replace(/\.md$/i, "");
  if (!plugin || !name) return null;
  return name.startsWith(`${plugin}:`) ? name : `${plugin}:${name}`;
}

function pluginSkillTrigger(skillPath: string, name: string): string {
  const parts = skillPath.split(/[\\/]+/);
  const skillsIdx = parts.lastIndexOf("skills");
  const cacheIdx = parts.lastIndexOf("cache");
  if (skillsIdx > 1 && cacheIdx >= 0 && cacheIdx + 3 < skillsIdx) {
    const plugin = parts[cacheIdx + 2];
    if (plugin && !name.startsWith(`${plugin}:`)) return `${plugin}:${name}`;
  }
  return name;
}

export async function buildSkillCatalog({ roots, pluginRoots }: {
  roots: SkillRoot[];
  pluginRoots: SkillRoot[];
}): Promise<SkillCatalogItem[]> {
  const pluginCacheRoots = pluginRoots.map((r) => r.root);
  const skillFiles = (
    await Promise.all(
      [...new Map(roots.map((r) => [`${r.source}:${r.root}`, r])).values()].map(async (r) =>
        (await findSkillFiles(r.root)).map((path) => ({ ...r, path, command: false })),
      ),
    )
  ).flat();
  // Commands come second so a plugin that ships both a skill and a command of
  // the same name keeps the skill — it carries the richer frontmatter.
  const commandFiles = (
    await Promise.all(
      pluginRoots.map(async (r) =>
        (await findPluginCommandFiles(r.root)).map((path) => ({ ...r, path, command: true })),
      ),
    )
  ).flat();
  const files = [...skillFiles, ...commandFiles];
  const seen = new Set<string>();
  const items: SkillCatalogItem[] = [];
  for (const file of files) {
    let raw = "";
    try {
      raw = readFileSync(file.path, "utf8");
    } catch {
      continue;
    }
    const fm = parseSkillFrontmatter(raw);
    let name: string;
    let trigger: string;
    if (file.command) {
      // A command's identity is its path — the frontmatter carries only a
      // description, never a name.
      const commandTrigger = pluginCommandTrigger(file.path);
      if (!commandTrigger) continue;
      trigger = commandTrigger;
      name = commandTrigger.slice(commandTrigger.indexOf(":") + 1);
    } else {
      name = fm.name || file.path.split(/[\\/]+/).at(-2) || "skill";
      // Namespace every plugin-provided skill as "plugin:name", whichever
      // agent's cache it came from. Beyond matching how the agent addresses
      // them, this is what keeps two plugins that ship the same skill name from
      // colliding on `key` below and having one silently dropped.
      trigger = pluginCacheRoots.some((root) => file.path.startsWith(root))
        ? pluginSkillTrigger(file.path, name)
        : name;
    }
    // Dedup also collapses a plugin installed at two versions (the cache keeps
    // the old directory around), which would otherwise list the same command twice.
    const key = `${file.source}:${trigger}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const item: SkillCatalogItem = {
      name,
      trigger,
      description: fm.description || skillDescriptionFallback(raw),
      keywords: skillSearchKeywords(raw),
      source: file.source,
      path: file.path,
    };
    if (validSkillItem(item)) items.push(item);
  }
  return items.sort((a, b) => a.trigger.localeCompare(b.trigger));
}

export async function listSkillCatalog(repoRoots: string[] = [], agent?: string): Promise<SkillCatalogItem[]> {
  const scope = agent ?? "";
  const key = cacheKey(repoRoots);
  const index = skillIndexes.get(scope);
  const age = index ? Date.now() - index.builtAt : Infinity;
  if (index?.key === key && age < SKILL_INDEX_TTL_MS) return index.items;
  const refreshKey = JSON.stringify([scope, key]);
  let refresh = skillRefreshes.get(refreshKey);
  if (!refresh) {
    refresh = buildSkillCatalog(skillCatalogRoots(repoRoots, agent))
      .then((items) => {
        skillIndexes.set(scope, { key, builtAt: Date.now(), items });
        return items;
      })
      .finally(() => skillRefreshes.delete(refreshKey));
    skillRefreshes.set(refreshKey, refresh);
  }
  if (index?.key === key && age < SKILL_INDEX_STALE_MS) {
    void refresh.catch(() => {});
    return index.items;
  }
  return refresh;
}

/** Drop the server-only body text so a catalog can be sent to a client. */
export function withoutSkillKeywords(items: SkillCatalogItem[]): SkillCatalogItem[] {
  return items.map(({ keywords: _keywords, ...rest }) => rest);
}

/**
 * Full-text skill search, run where the text already lives.
 *
 * The catalog index holds up to 4000 characters of each skill's body so a
 * query can match prose rather than just names. That text is 87% of the
 * catalog's bytes, so it stays here: the client sends `q`, this matches
 * against the same haystack the browser used to build itself, and only the
 * hits go back — without the body.
 *
 * Matching is deliberately identical to the old client-side filter (lowercased
 * substring over trigger + name + description + body) so moving it across the
 * wire changes where the work happens and nothing about which skills match.
 */
export async function searchSkillCatalog(
  repoRoots: string[] = [],
  query: string,
  limit = 50,
  agent?: string,
): Promise<SkillCatalogItem[]> {
  const items = await listSkillCatalog(repoRoots, agent);
  const q = query.trim().toLowerCase();
  if (!q) return withoutSkillKeywords(items).slice(0, limit);
  const hits = items.filter((skill) =>
    `${skill.trigger} ${skill.name} ${skill.description} ${skill.keywords || ""}`
      .toLowerCase()
      .includes(q),
  );
  return withoutSkillKeywords(hits).slice(0, limit);
}
