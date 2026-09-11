/**
 * The skill catalog behind the composer's "/" popup.
 *
 * Mirrors the web (App.tsx: loadSkillCatalog, slashSkillAt, pickSkill): the
 * same `/api/skills` endpoint, the same trigger grammar, the same
 * replacement text, so a skill invoked from the phone reads exactly as one
 * invoked from the browser and the box needs no second contract.
 */
import type { OmgClient } from "@omg-dev/client";

export type SkillCatalogItem = {
  name: string;
  trigger: string;
  description: string;
  keywords?: string;
  source: "codex" | "claude" | "agent";
  path: string;
};

export type SlashSkillState = {
  start: number;
  end: number;
  query: string;
};

const TTL_MS = 30_000;
let snapshot: SkillCatalogItem[] = [];
let loadedAt = 0;
let inflight: Promise<SkillCatalogItem[]> | null = null;

export function loadSkillCatalog(client: OmgClient): Promise<SkillCatalogItem[]> {
  if (snapshot.length && Date.now() - loadedAt < TTL_MS) return Promise.resolve(snapshot);
  if (!inflight) {
    inflight = client.transport
      .request<{ skills?: SkillCatalogItem[] }>("/api/skills")
      .then((r) => {
        snapshot = Array.isArray(r.skills) ? r.skills : [];
        loadedAt = Date.now();
        return snapshot;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export function searchSkillCatalog(client: OmgClient, q: string): Promise<SkillCatalogItem[]> {
  return client.transport
    .request<{ skills?: SkillCatalogItem[] }>(`/api/skills?q=${encodeURIComponent(q)}`)
    .then((r) => (Array.isArray(r.skills) ? r.skills : []));
}

/** The "/word" under the caret, or null when the caret is not on one. */
export function slashSkillAt(value: string, cursor: number | null | undefined): SlashSkillState | null {
  if (cursor == null) return null;
  const before = value.slice(0, cursor);
  const match = before.match(/(^|\s)\/([A-Za-z0-9_:-]{0,80})$/);
  if (!match) return null;
  return { start: cursor - match[2].length - 1, end: cursor, query: match[2].toLowerCase() };
}

/** The text after choosing `skill` for the "/word" described by `active`. */
export function applySkill(value: string, active: SlashSkillState, skill: SkillCatalogItem): string {
  return `${value.slice(0, active.start)}$${skill.trigger} ${value.slice(active.end)}`;
}

export function matchSkills(
  active: SlashSkillState,
  local: SkillCatalogItem[],
  deeper: SkillCatalogItem[],
): SkillCatalogItem[] {
  const q = active.query;
  const near = local.filter((skill) => {
    const haystack = `${skill.trigger} ${skill.name} ${skill.description}`.toLowerCase();
    return !q || haystack.includes(q);
  });
  if (!q) return near;
  // Name matches first, then body-only matches, so ranking stays stable as
  // the deeper results land underneath what is already on screen.
  const seen = new Set(near.map((skill) => `${skill.source}:${skill.trigger}`));
  return [...near, ...deeper.filter((skill) => !seen.has(`${skill.source}:${skill.trigger}`))];
}
