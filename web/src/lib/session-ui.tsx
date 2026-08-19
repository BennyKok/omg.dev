// Small pieces shared between App.tsx and the route-level views that load from
// their own chunks.
//
// They live here rather than travelling into a lazy view because App.tsx needs
// them too: a static import back into App from a lazy module would pull that
// module's whole graph into the entry chunk, which is exactly how a code split
// ends up saving nothing.
import { createContext, useContext, useMemo } from "react";
import type { ClaudeAccountInfo, CodingAgentInfo, PersistentBot, Session } from "../App";
import { omgAssetUrl } from "./omg-client";
import { cn } from "./utils";

// Bump whenever an agent mark in web/public changes: versioned icon URLs are
// served `immutable, max-age=1y`, so a redrawn SVG at the same `?v=` keeps
// serving the old art out of the browser cache forever.
export const AGENT_ICON_VERSION = "20260819a";

/**
 * The session-card / picker icon for an agent kind. Codex variants share the
 * codex mark; claude variants (including aisdk) share the claude mark.
 */
export function agentIconSrc(agent?: string): string {
  const v = `?v=${AGENT_ICON_VERSION}`;
  if (agent === "codex" || agent === "codex-aisdk") return omgAssetUrl(`/agent-codex.svg${v}`);
  if (agent === "grok") return omgAssetUrl(`/agent-grok.svg${v}`);
  if (agent === "cursor") return omgAssetUrl(`/agent-cursor.svg${v}`);
  if (agent === "fx") return omgAssetUrl(`/agent-fx.svg${v}`);
  if (agent === "hermes") return omgAssetUrl(`/agent-hermes.svg${v}`);
  if (agent === "opencode") return omgAssetUrl(`/agent-opencode.svg${v}`);
  if (agent === "jcode") return omgAssetUrl(`/agent-jcode.svg${v}`);
  if (agent === "pi") return omgAssetUrl(`/agent-pi.svg${v}`);
  if (agent === "copilot") return omgAssetUrl(`/agent-copilot.svg${v}`);
  return omgAssetUrl(`/agent-claude.svg${v}`);
}

export function agentIconAlt(agent?: string): string {
  if (agent === "codex" || agent === "codex-aisdk") return "Codex";
  if (agent === "grok") return "Grok";
  if (agent === "cursor") return "Cursor";
  if (agent === "fx") return "fx";
  if (agent === "hermes") return "Hermes";
  if (agent === "opencode") return "OpenCode";
  if (agent === "jcode") return "Jcode";
  if (agent === "pi") return "pi";
  if (agent === "copilot") return "Copilot";
  return "Claude";
}

export function timeAgo(value?: number | null): string {
  if (!value) return "unknown";
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * Opening an artifact never leaves the app or pops a window: cards push onto a
 * full-screen in-app page with a Back header.
 */
export type ViewerArtifact = {
  url: string;
  kind: "image" | "video" | "html";
  title?: string;
  caption?: string;
  name?: string;
  version?: number;
  // Changes on every successful content write, including data-only refreshes.
  // Kept separate from the user-facing authored revision.
  cacheKey?: number;
};

export const ArtifactViewerContext = createContext<(artifact: ViewerArtifact) => void>(() => {});

/** Page sizes for the shipped feed and the artifact gallery. */
export const FEED_PAGE = 15;
export const GALLERY_PAGE = 24;

/** The name a session shows in every surface that has to label one. */
export function titleForSession(session: Session): string {
  return (
    session.title ||
    session.lastUserText ||
    session.tmuxName ||
    session.project ||
    session.sessionId?.slice(0, 8) ||
    "session"
  );
}

/**
 * Which face a session's header should wear. A bot-backed session wears the
 * bot's own creature once the bot directory has resolved it; while it hasn't
 * (fetch in flight, race on mount) it gets a neutral loading creature rather
 * than the harness's agent mark, which would claim a harness that isn't
 * actually running the session. A session with no bot at all gets the
 * harness's agent icon — the safe fallback, never the default.
 *
 * Pulled out as a pure function (rather than duplicated JSX per surface) so
 * the card header and the mobile session sheet header both derive from the
 * one BotDirectoryContext lookup instead of each tracking its own copy of
 * "which bot is this".
 */
export type SessionHeaderIdentity =
  | { kind: "bot"; bot: PersistentBot }
  | { kind: "bot-loading" }
  | { kind: "agent" };

export function resolveSessionHeaderIdentity(
  session: Pick<Session, "botId">,
  botDirectory: Map<string, PersistentBot>,
): SessionHeaderIdentity {
  if (!session.botId) return { kind: "agent" };
  const bot = botDirectory.get(session.botId);
  return bot ? { kind: "bot", bot } : { kind: "bot-loading" };
}

/**
 * Agent kinds whose CLI login can be driven from the browser, and the account
 * each one signs into (see authProviderFor in src/coding-agents.ts). Everything
 * else is terminal-only.
 *
 * The provider name lives HERE, beside the kind, because the sign-in tab has to
 * name it BEFORE the server answers — the tab opens inside the click, the
 * server's `provider` arrives a round trip later, and a tab that cannot say
 * what it is opening is the blank tab this map exists to prevent. Keeping it in
 * one table means a new browser-loginable agent cannot be added to the login
 * path while leaving its tab unlabelled.
 */
export const BROWSER_AUTH_PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude",
  aisdk: "Claude",
  codex: "Codex",
  "codex-aisdk": "Codex",
  grok: "Grok",
  // `fx login` is itself the Vercel device flow — there is no --device-auth
  // variant to pick, so the browser path is the only sensible one.
  fx: "Vercel",
};

export const BROWSER_AUTH_KINDS = new Set<string>(
  Object.keys(BROWSER_AUTH_PROVIDER_LABELS),
);

export const CodingAgentsContext = createContext<CodingAgentInfo[] | undefined>(undefined);

/** Every connected Claude account, numbered — empty when there is only one to tell apart. */
export function useNumberedClaudeAccounts(): ClaudeAccountInfo[] {
  const codingAgents = useContext(CodingAgentsContext);
  return useMemo(() => {
    const accounts = codingAgents
      ?.find((agent) => agent.key === "aisdk")
      ?.status.accounts?.filter((account) => account.connected);
    return accounts && accounts.length > 1 ? accounts : [];
  }, [codingAgents]);
}

/** The account number to stamp on a Claude mark, or null when there is nothing to disambiguate. */
export function useClaudeAccountNumber(
  agent: string | undefined,
  claudeAccountId: string | null | undefined,
): number | null {
  const accounts = useNumberedClaudeAccounts();
  if (!claudeAccountId) return null;
  // Only the Claude marks are ambiguous; every other agent has one identity.
  if (agent && agent !== "aisdk" && agent !== "claude") return null;
  return accounts.find((account) => account.id === claudeAccountId)?.number ?? null;
}

/**
 * The account number worn by a Claude icon, so a fleet split across several
 * logins is readable without opening anything. Always bottom-right — the same
 * corner the agent pickers and the usage campfire use.
 */
export function ClaudeAccountBadge({
  number,
  size = "md",
  className,
}: {
  number: number | null;
  size?: "sm" | "md";
  className?: string;
}) {
  if (number == null) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-foreground font-bold leading-none text-background ring-1 ring-background",
        size === "sm" ? "size-3 text-[7px]" : "size-3.5 text-[8px]",
        className,
      )}
    >
      {number}
    </span>
  );
}

/** A session's agent mark, wearing its Claude account number when it has one. */
export function SessionAgentIcon({
  session,
  className,
  size,
  wrapperClassName,
}: {
  session: Pick<Session, "agent" | "agentLabel" | "claudeAccountId">;
  className?: string;
  size?: "sm" | "md";
  wrapperClassName?: string;
}) {
  const number = useClaudeAccountNumber(session.agent, session.claudeAccountId);
  const label = session.agentLabel || agentIconAlt(session.agent);
  const img = (
    <img
      src={agentIconSrc(session.agent)}
      alt={number == null ? label : `${label} ${number}`}
      title={session.agentLabel || undefined}
      className={className}
    />
  );
  // Without a number there is nothing to position against, so the extra
  // wrapper element is skipped entirely.
  if (number == null && !wrapperClassName) return img;
  return (
    <span className={cn("relative inline-flex shrink-0", wrapperClassName)}>
      {img}
      <ClaudeAccountBadge number={number} size={size} />
    </span>
  );
}
