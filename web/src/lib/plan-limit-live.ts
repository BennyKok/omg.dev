import { isBotConversation, type ConversationSessionIdentity } from "./conversation-ui";
import { NO_PROJECT_FILTER, sessionMatchesProjectFilter } from "./project-filter";
import { sessionMatchesUserFilter } from "./user-filter";

/** One live chat that counts against the hosted plan's agent limit. */
export interface PlanLimitLiveAgent {
  sessionId: string;
  /** What the chat list calls it. */
  title: string;
  /** Project key, or "" for a chat with no project. */
  project: string;
}

type LiveSession = ConversationSessionIdentity & {
  title?: string | null;
  lastUserText?: string | null;
  project?: string;
  spawnedBy?: string | null;
};

/**
 * The live chats a hosted plan counts when it refuses a new one.
 *
 * Home shows one project at a time, so at "3 of 3 live" it can show a single
 * chat and leave the other two out of sight (walkthrough 2026-09-29). The
 * host lists these on its limit sheet so the person can open or close one.
 *
 * Mirrors the server's interactive pool (src/commands/serve.ts): scheduled
 * runs have their own limit, and bot conversations are not counted.
 */
export function planLimitLiveAgents(sessions: readonly LiveSession[]): PlanLimitLiveAgent[] {
  const out: PlanLimitLiveAgent[] = [];
  const seen = new Set<string>();
  for (const session of sessions) {
    const sessionId = session.sessionId;
    if (!sessionId || seen.has(sessionId)) continue;
    if (session.spawnedBy === "schedule" || isBotConversation(session)) continue;
    seen.add(sessionId);
    out.push({
      sessionId,
      title: session.title?.trim() || session.lastUserText?.trim() || sessionId.slice(0, 8),
      project: session.project ?? "",
    });
  }
  return out;
}

/** What the app shell lends the plan-limit hand-off: the list, and how to act on it. */
export interface LiveAgentsControl {
  list: () => PlanLimitLiveAgent[];
  open: (sessionId: string) => void;
  close: (sessionId: string) => Promise<void>;
}

let control: LiveAgentsControl | null = null;

/** The shell registers here; the composer that hits the limit reads it. */
export function registerLiveAgents(next: LiveAgentsControl | null): void {
  control = next;
}

export function liveAgentsControl(): LiveAgentsControl | null {
  return control;
}

/**
 * The filter changes that make a chat visible before the limit sheet opens it.
 *
 * Home shows one project (and one person) at a time, and the session page only
 * renders a chat that the current filters list. Opening a chat from another
 * project changed the URL and showed nothing, which is the one case the sheet
 * exists for. Same rule as a `?session=` deep link: clear a person filter that
 * hides it, and scope to the chat's own project.
 */
export function filtersToShowSession(
  session: { project?: string | null; assignedUser?: string | null },
  current: { userFilter: string; projectFilter: string },
): { userFilter?: string; projectFilter?: string } {
  const next: { userFilter?: string; projectFilter?: string } = {};
  if (!sessionMatchesUserFilter(session, current.userFilter)) next.userFilter = "__all";
  if (!sessionMatchesProjectFilter(session, current.projectFilter)) {
    next.projectFilter = session.project ? session.project : NO_PROJECT_FILTER;
  }
  return next;
}
