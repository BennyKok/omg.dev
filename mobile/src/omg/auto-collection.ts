import { liveCollection, type OmgClient, type OmgLiveCollection } from "@omg-dev/client";
import type { AutoAgent, AutoFinding } from "./auto-agents";

/**
 * 30s, when the Computer does not announce changes (an older Computer). A
 * finding is a live fact: dismissed on another device, or graduated into a
 * session from the web. So this cannot be resumable.ts's fetch-once.
 *
 * A current Computer sends a `changed` frame for "auto" on the live socket the
 * moment a schedule or finding is written. The list is then re-read at once
 * and this poll drops to a 5-minute backstop (liveCollection in
 * @omg-dev/client). Every screen that shows it shares one collection per
 * client, so three screens cost one read.
 */
const AUTO_POLL_MS = 30_000;

export type AutoSnapshot = {
  agents: AutoAgent[];
  findings: AutoFinding[];
  tz: string | null;
  findingsError: string | null;
};

const collections = new WeakMap<OmgClient, OmgLiveCollection<AutoSnapshot>>();

export function autoCollection(client: OmgClient): OmgLiveCollection<AutoSnapshot> {
  const existing = collections.get(client);
  if (existing) return existing;
  const collection: OmgLiveCollection<AutoSnapshot> = liveCollection<AutoSnapshot>(
    client.live,
    "auto",
    async (): Promise<AutoSnapshot> => {
      // Two independent requests: the two endpoints can fail apart (findings
      // is newer than agents), and one failure must not discard the other.
      const [agentsRead, findingsRead] = await Promise.allSettled([
        client.transport.request<{ agents?: AutoAgent[]; tz?: string }>("/api/auto/agents"),
        client.transport.request<{ findings?: AutoFinding[] }>("/api/auto/findings?status=open"),
      ]);
      const previous: AutoSnapshot | undefined = collection.peek();
      return {
        agents: agentsRead.status === "fulfilled" ? agentsRead.value.agents ?? [] : [],
        tz: agentsRead.status === "fulfilled" ? agentsRead.value.tz ?? previous?.tz ?? null : previous?.tz ?? null,
        findings: findingsRead.status === "fulfilled" ? findingsRead.value.findings ?? [] : previous?.findings ?? [],
        findingsError: findingsRead.status === "fulfilled" ? null : "Could not load findings. Please try again.",
      };
    },
    { pollMs: AUTO_POLL_MS },
  );
  collections.set(client, collection);
  return collection;
}
