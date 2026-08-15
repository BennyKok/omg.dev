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
  /** Merged view only: how many of this agent's logins actually reported. */
  accounts?: number;
  /** Merged view only: "2 of 3 accounts", when some did not answer. */
  note?: string | null;
};

/**
 * ONE ENTRY PER AGENT, not per account.
 *
 * A box with three Claude logins reports three providers, and drawing one ring
 * each turned the composer into a row of near-identical circles that answered
 * a question nobody asked ("how is account 2 doing?"). The web folds them with
 * `mergeProviderUsage`: windows are matched BY LABEL and averaged, the soonest
 * reset wins, and an account that has not reported is left out of the mean
 * rather than counted as zero — which would read as headroom that does not
 * exist.
 *
 * THE MACHINE DOES THIS NOW (`GET /api/usage/summary`). This copy is the
 * fallback for a box that has not been updated yet, and it is deliberately the
 * same rule rather than a simpler one — a phone that disagreed with the web
 * about how full an account is would be worse than a phone showing nothing.
 * Delete it once no reachable machine 404s that endpoint.
 */
export function mergeByKind(providers: ProviderUsage[]): ProviderUsage[] {
  const byKind = new Map<string, ProviderUsage[]>();
  for (const provider of providers) {
    const list = byKind.get(provider.kind) ?? [];
    list.push(provider);
    byKind.set(provider.kind, list);
  }

  return [...byKind.entries()].map(([kind, members]) => {
    const live = members.filter((m) => m.available && (m.windows?.length ?? 0) > 0);
    const base = members[0];
    if (!live.length) return { ...base, id: kind, available: false, windows: [] };

    const slots = new Map<string, { sum: number; n: number; resetsAt: number | null }>();
    const order: string[] = [];
    for (const member of live) {
      for (const window of member.windows ?? []) {
        let slot = slots.get(window.label);
        if (!slot) {
          slot = { sum: 0, n: 0, resetsAt: null };
          slots.set(window.label, slot);
          order.push(window.label);
        }
        if (typeof window.pct === "number" && Number.isFinite(window.pct)) {
          // Clamped per account before folding, as the server ranks them: one
          // over-100 reading must not drag the whole mean up.
          slot.sum += Math.max(0, Math.min(100, window.pct));
          slot.n += 1;
        }
        if (window.resetsAt != null && (slot.resetsAt == null || window.resetsAt < slot.resetsAt)) {
          slot.resetsAt = window.resetsAt;
        }
      }
    }

    return {
      ...base,
      id: kind,
      available: true,
      windows: order.map((label) => {
        const slot = slots.get(label)!;
        return { label, pct: slot.n ? slot.sum / slot.n : null, resetsAt: slot.resetsAt };
      }),
    };
  });
}

/**
 * Weekly outermost, then the five-hour window, then anything else — the order
 * the web draws them in, so the same agent's rings read the same on both.
 */
export function orderWindows(windows: UsageWindow[]): UsageWindow[] {
  const rank = (label: string) => {
    const l = label.toLowerCase();
    if (l.includes("week") || l.includes("7 day")) return 0;
    if (l.includes("5") && (l.includes("hr") || l.includes("hour"))) return 1;
    return 2;
  };
  return [...windows].sort((a, b) => rank(a.label) - rank(b.label));
}

/** The fullest window, which is the one that will bite first. */
export function peakPct(provider: ProviderUsage): number | null {
  const values = (provider.windows ?? [])
    .map((w) => w.pct)
    .filter((pct): pct is number => typeof pct === "number");
  if (!values.length) return null;
  return Math.max(...values);
}

/**
 * ONE REQUEST WHEN THE MACHINE CAN DO IT, N+1 ONLY WHEN IT CANNOT.
 *
 * The old shape was a directory read plus a request PER LOGIN, and then the
 * phone folded them itself. Three Claude accounts meant four round trips over
 * whatever cell connection you happen to be on, to draw two circles — and the
 * folding rule lived in two places (here and web/src/lib/usage.ts), which is
 * the kind of duplication that ends with two surfaces disagreeing about how
 * full the same account is.
 *
 * `/api/usage/summary` is that rule, on the machine, next to the data it
 * describes. The old path stays as a fallback because a phone updates through
 * TestFlight and a machine updates when its owner pulls: the two are never in
 * step, and a ring that vanishes for a week is a regression to the person
 * looking at it.
 */
export function useUsage(): {
  providers: ProviderUsage[];
  /**
   * A read is in flight and nothing has arrived yet.
   *
   * Worth its own flag rather than being inferred from an empty list, because
   * empty means two different things: "still asking" and "this machine has no
   * usage to report". The composer draws a spinner for the first and nothing
   * for the second, and inferring it would have shown a spinner forever on a
   * box with no providers.
   */
  loading: boolean;
  refresh: () => void;
} {
  const { client } = useOmg();
  const [providers, setProviders] = useState<ProviderUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    setLoading(true);

    void (async () => {
      try {
        const merged = await client.transport.request<{ providers?: ProviderUsage[] }>(
          "/api/usage/summary",
        );
        if (cancelled) return;
        setProviders(merged.providers ?? []);
        setLoading(false);
        return;
      } catch {
        // Falls through to the per-account walk below. Any failure counts:
        // an old machine 404s, and one that is mid-restart can 502.
      }

      try {
        const directory = await client.transport.request<{
          providers?: { id: string }[];
        }>("/api/usage/providers");
        const ids = (directory.providers ?? []).map((p) => p.id);
        /**
         * EACH ACCOUNT PAINTS AS IT LANDS, rather than the row waiting for the
         * slowest of them.
         *
         * This was a `Promise.all` that set state once, and on a box with five
         * providers the composer showed no rings AT ALL for the better part of
         * a minute — every account was ready except one CLI that reports
         * nothing and takes its time saying so. Measured on device: the row
         * was empty long enough to read as "this feature does not work".
         *
         * Merging what has arrived so far is correct at every step, because
         * the fold already excludes accounts that have not reported; a slow one
         * joins the mean when it answers.
         */
        const landed: ProviderUsage[] = [];
        await Promise.all(
          ids.map((id) =>
            client.transport
              .request<{ provider: ProviderUsage }>(`/api/usage/${encodeURIComponent(id)}`)
              .then((payload) => {
                if (cancelled || !payload.provider) return;
                landed.push(payload.provider);
                setProviders(mergeByKind(landed));
              })
              .catch(() => null),
          ),
        );
      } catch {
        // A machine that cannot answer leaves the row empty rather than
        // showing rings full of nothing.
        if (!cancelled) setProviders([]);
      } finally {
        if (!cancelled) setLoading(false);
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

  return { providers, loading, refresh };
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
