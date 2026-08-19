import type { Bot } from "./store.ts";

export type BotRuntimeSession = {
  sessionId?: string | null;
  nativeSessionId?: string | null;
  botId?: string;
  assignedUser?: string | null;
  busy?: boolean;
};

export type BotRuntimeActor = {
  sessionId: string;
  bot: Bot;
  user: string;
};

export class BotSelfManagementError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "BotSelfManagementError";
  }
}

function sameUser(left: string | null | undefined, right: string | null | undefined): boolean {
  return !!left?.trim() && left.trim().toLowerCase() === right?.trim().toLowerCase();
}

/**
 * Resolve both bot and owner from the authenticated runtime session.
 *
 * The caller supplies only its transport identity. Bot ids and user emails are
 * read from server-owned session and bot records, then cross-checked so a stale
 * or forged ownership relationship fails closed.
 */
export function resolveBotRuntimeActor(
  callerSessionId: string | null | undefined,
  sessions: BotRuntimeSession[],
  bots: Bot[],
): BotRuntimeActor {
  const caller = callerSessionId?.trim();
  if (!caller) throw new BotSelfManagementError(401, "authenticated runtime session required");
  const session = sessions.find((row) =>
    row.sessionId === caller || row.nativeSessionId === caller
  );
  if (!session) throw new BotSelfManagementError(403, "runtime session is not active");
  if (!session.botId) throw new BotSelfManagementError(403, "capability is available only to persistent bots");
  const bot = bots.find((row) => row.id === session.botId);
  if (!bot) throw new BotSelfManagementError(403, "runtime bot identity is not registered");
  const user = session.assignedUser?.trim();
  if (!user || !sameUser(user, bot.owner)) {
    throw new BotSelfManagementError(403, "runtime bot ownership does not match its assigned user");
  }
  return { sessionId: caller, bot, user };
}

export type BotPeerStatus = "busy" | "idle" | "offline";

export function ownedBotPeers(
  actor: BotRuntimeActor,
  bots: Bot[],
  sessions: BotRuntimeSession[],
) {
  return bots
    .filter((bot) => bot.id !== actor.bot.id && sameUser(bot.owner, actor.user))
    .map((bot) => {
      const live = sessions.find((session) =>
        session.botId === bot.id ||
        (!!bot.sessionId && (session.sessionId === bot.sessionId || session.nativeSessionId === bot.sessionId))
      );
      const status: BotPeerStatus = live ? (live.busy ? "busy" : "idle") : "offline";
      return {
        id: bot.id,
        name: bot.name,
        description: bot.description ?? "",
        shape: bot.shape,
        colorway: bot.colorway,
        enabled: bot.enabled,
        status,
        capabilities: [...(bot.capabilities ?? [])],
      };
    });
}

export const BOT_SELF_CREATE_FIELDS = new Set([
  "name",
  "persona",
  "description",
  "capabilities",
  "shape",
  "colorway",
  "agent",
  "model",
  "thinkingLevel",
]);

export const BOT_SELF_UPDATE_FIELDS = new Set([
  "name",
  "persona",
  "description",
  "capabilities",
  "shape",
  "colorway",
]);

export function unknownBotFields(
  body: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): string[] {
  return Object.keys(body).filter((key) => !allowed.has(key)).sort();
}

export function readDeclaredCapabilities(value: unknown): string[] | { error: string } {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return { error: "capabilities must be an array of strings" };
  if (value.length > 20) return { error: "capabilities must contain at most 20 items" };
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim() || item.trim().length > 64) {
      return { error: "each capability must be a non-empty string of at most 64 characters" };
    }
    const normalized = item.trim();
    if (!result.includes(normalized)) result.push(normalized);
  }
  return result;
}

const BOT_RUNTIME_PROFILE_FIELDS = new Set([
  "name",
  "persona",
  "description",
  "capabilities",
  "agent",
  "model",
  "thinkingLevel",
  "cwd",
  "user",
]);

export function botPatchRequiresRuntimeRefresh(body: Record<string, unknown>): boolean {
  return Object.keys(body).some((field) => BOT_RUNTIME_PROFILE_FIELDS.has(field));
}

export function botRuntimeRefreshDecision(
  bot: Pick<Bot, "runtimeRefreshPending">,
  live?: Pick<BotRuntimeSession, "busy">,
): "none" | "wait" | "relaunch" {
  if (!bot.runtimeRefreshPending) return "none";
  return live?.busy ? "wait" : "relaunch";
}
