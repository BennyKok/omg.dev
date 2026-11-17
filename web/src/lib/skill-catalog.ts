import { api } from "./omg-client";

export type SkillCatalogItem = {
  name: string;
  trigger: string;
  description: string;
  keywords?: string;
  source: "codex" | "claude" | "grok" | "agent";
  path: string;
};

export function createSkillCatalog(
  request: (path: string) => Promise<{ skills: SkillCatalogItem[] }> = api,
) {
  const snapshots = new Map<string, { items: SkillCatalogItem[]; loadedAt: number }>();
  const pending = new Map<string, Promise<SkillCatalogItem[]>>();
  const url = (agent: string) => `/api/skills?agent=${encodeURIComponent(agent)}`;
  return {
    list(agent: string): Promise<SkillCatalogItem[]> {
      const snapshot = snapshots.get(agent);
      if (snapshot && Date.now() - snapshot.loadedAt < 30_000) return Promise.resolve(snapshot.items);
      let promise = pending.get(agent);
      if (!promise) {
        promise = request(url(agent))
          .then((r) => {
            const items = Array.isArray(r.skills) ? r.skills : [];
            snapshots.set(agent, { items, loadedAt: Date.now() });
            return items;
          })
          .finally(() => pending.delete(agent));
        pending.set(agent, promise);
      }
      return promise;
    },
    async search(agent: string, query: string): Promise<SkillCatalogItem[]> {
      const r = await request(`${url(agent)}&q=${encodeURIComponent(query)}`);
      return Array.isArray(r.skills) ? r.skills : [];
    },
  };
}

export type SkillCatalog = ReturnType<typeof createSkillCatalog>;
export const skillCatalog = createSkillCatalog();
