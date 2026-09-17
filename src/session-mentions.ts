/**
 * Ranking for the composer's `#` session picker.
 *
 * Pure so the endpoint in `serve.ts` stays a thin shell: it gathers the live
 * fleet and this module orders it. Closed and archived sessions are not
 * mentionable. Order: sessions in the caller's folder first, then everything
 * else, each group newest first. Every row must match every keyword term the
 * same way `resume-cache.ts` matches (substring of title, last prompt, or
 * project).
 */

export type MentionableSessionRow = {
  sessionId: string;
  title: string;
  cwd: string | null;
  project: string;
  lastUserText: string | null;
  lastActivityAt: number | null;
  agent: string;
  live: boolean;
  sameFolder: boolean;
};

type Candidate = {
  sessionId: string | null;
  title: string;
  cwd: string | null;
  project: string;
  lastUserText: string | null;
  lastActivityAt: number | null;
  agent: string;
};

export type RankSessionMentionsInput = {
  live: readonly Candidate[];
  cwd?: string | null;
  query?: string;
  excludeId?: string | null;
  limit?: number;
};

export function sessionMentionTerms(query: string | undefined): string[] {
  return (query ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
}

function matchesTerms(candidate: Candidate, terms: string[]): boolean {
  if (!terms.length) return true;
  const haystack = [candidate.title, candidate.lastUserText ?? "", candidate.project]
    .join("\n")
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

function normaliseCwd(cwd: string | null | undefined): string {
  return (cwd ?? "").replace(/\/+$/, "");
}

export function rankSessionMentions(input: RankSessionMentionsInput): MentionableSessionRow[] {
  const terms = sessionMentionTerms(input.query);
  const here = normaliseCwd(input.cwd);
  const limit = Math.max(1, Math.min(100, input.limit ?? 20));
  const seen = new Set<string>();
  const rows: MentionableSessionRow[] = [];
  for (const candidate of input.live) {
    const sessionId = candidate.sessionId;
    if (!sessionId || seen.has(sessionId)) continue;
    if (input.excludeId && sessionId === input.excludeId) continue;
    if (!matchesTerms(candidate, terms)) continue;
    seen.add(sessionId);
    rows.push({
      sessionId,
      title: candidate.title,
      cwd: candidate.cwd,
      project: candidate.project,
      lastUserText: candidate.lastUserText,
      lastActivityAt: candidate.lastActivityAt,
      agent: candidate.agent,
      live: true,
      sameFolder: here.length > 0 && normaliseCwd(candidate.cwd) === here,
    });
  }

  rows.sort((a, b) => {
    if (a.sameFolder !== b.sameFolder) return a.sameFolder ? -1 : 1;
    return (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0);
  });
  return rows.slice(0, limit);
}
