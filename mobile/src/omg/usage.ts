/**
 * How much of each provider's rate-limit window is spent.
 *
 * The machine already computes this for the web composer's activity rings
 * (`/api/usage/providers` for the directory, `/api/usage/<id>` for one
 * provider's windows), so the phone asks the same two endpoints rather than
 * inventing a second notion of "usage" that could disagree with the surface
 * people check first.
 *
 * Two things worth knowing about the data:
 *
 *  - A provider can be UNAVAILABLE. An account that has not reported yet, or a
 *    CLI that cannot be asked, comes back `available: false` — which is not 0%,
 *    and must not be drawn as an empty ring implying plenty of headroom.
 *  - A provider has SEVERAL windows (five-hourly, weekly). The ring shows the
 *    fullest one, because the binding limit is the one about to stop you.
 */

import { useCallback, useEffect, useState } from "react";

import { useOmg } from "./provider";

export type UsageWindow = { label: string; pct: number | null; resetsAt?: number | null };

export type ProviderUsage = {
  id: string;
  kind: string;
  label: string;
  accountLabel?: string | null;
  available: boolean;
  plan?: string | null;
  windows?: UsageWindow[];
};

/** The fullest window, which is the one that will bite first. */
export function peakPct(provider: ProviderUsage): number | null {
  const values = (provider.windows ?? [])
    .map((w) => w.pct)
    .filter((pct): pct is number => typeof pct === "number");
  if (!values.length) return null;
  return Math.max(...values);
}

export function useUsage(): { providers: ProviderUsage[]; refresh: () => void } {
  const { client } = useOmg();
  const [providers, setProviders] = useState<ProviderUsage[]>([]);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;

    void (async () => {
      try {
        const directory = await client.transport.request<{
          providers?: { id: string }[];
        }>("/api/usage/providers");
        const ids = (directory.providers ?? []).map((p) => p.id);
        // Each provider is its own request on the machine, and one slow CLI
        // must not hold up the rest of the row.
        const results = await Promise.all(
          ids.map((id) =>
            client.transport
              .request<{ provider: ProviderUsage }>(`/api/usage/${encodeURIComponent(id)}`)
              .then((payload) => payload.provider)
              .catch(() => null),
          ),
        );
        if (cancelled) return;
        setProviders(results.filter((p): p is ProviderUsage => !!p));
      } catch {
        // A machine that cannot answer leaves the row empty rather than
        // showing rings full of nothing.
        if (!cancelled) setProviders([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, tick]);

  // Rate-limit windows move in minutes, not seconds. Anything faster is noise
  // and a request per provider every time.
  useEffect(() => {
    const timer = setInterval(refresh, 90_000);
    return () => clearInterval(timer);
  }, [refresh]);

  return { providers, refresh };
}

/**
 * Which usage provider an agent draws from.
 *
 * The provider directory speaks in FAMILIES (`claude`, `codex`) while the agent
 * roster speaks in harnesses — `aisdk` is Claude Code driven through the AI
 * SDK, `codex-aisdk` is Codex the same way — so the two names disagree for
 * exactly the entries people use most. Anything not listed shares its own name
 * with its provider, which is true for grok, cursor, copilot and the rest.
 */
export function providerKindForAgent(agent: string | null | undefined): string {
  switch ((agent ?? "").trim().toLowerCase()) {
    case "aisdk":
    case "claude":
      return "claude";
    case "codex":
    case "codex-aisdk":
      return "codex";
    default:
      return (agent ?? "").trim().toLowerCase();
  }
}
