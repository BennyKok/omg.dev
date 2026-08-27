import { join } from "node:path";
import { PATHS } from "../config.ts";
import {
  createReadWatermarkStore,
  readWatermarkUser,
  type ReadWatermark,
} from "../read-watermarks.ts";
import type { Bot } from "./store.ts";

export type BotConversationOwnerRow = {
  sessionId?: string | null;
  botId?: string | null;
  assignedUser?: string | null;
};

export type BotConversationRead = ReadWatermark;

const store = createReadWatermarkStore(() => join(PATHS.data, "bots", "conversation-reads.json"));

export function botReadUser(user: string | null | undefined): string {
  return readWatermarkUser(user);
}

export function conversationOwner(
  sessionId: string,
  sessions: BotConversationOwnerRow[],
  bots: Bot[],
): { bot: Bot; user: string } | null {
  const session = sessions.find((row) => row.sessionId === sessionId);
  const bot = bots.find((row) =>
    row.sessionId === sessionId || (!!session?.botId && row.id === session.botId)
  );
  if (!bot) return null;
  const assigned = session?.assignedUser?.trim();
  const owner = bot.owner?.trim();
  if (assigned && owner && botReadUser(assigned) !== botReadUser(owner)) return null;
  return { bot, user: botReadUser(assigned || owner) };
}

export function conversationUnread(user: string, sessionId: string, latestAssistantRowid: number | null): boolean {
  return store.unread(user, sessionId, latestAssistantRowid);
}

export function markBotConversationRead(
  user: string,
  sessionId: string,
  latestAssistantRowid: number | null,
  now = Date.now(),
): BotConversationRead {
  return store.mark(user, sessionId, latestAssistantRowid, now);
}

/** Seed the rollout baseline once, so upgrading does not mark old bot history unread. */
export function ensureBotConversationReadBaseline(
  user: string,
  sessionId: string,
  latestAssistantRowid: number | null,
  now = Date.now(),
): void {
  store.ensureBaseline(user, sessionId, latestAssistantRowid, now);
}
