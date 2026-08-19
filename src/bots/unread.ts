import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PATHS } from "../config.ts";
import type { Bot } from "./store.ts";

export type BotConversationOwnerRow = {
  sessionId?: string | null;
  botId?: string | null;
  assignedUser?: string | null;
};

export type BotConversationRead = {
  user: string;
  sessionId: string;
  readThroughRowid: number;
  updatedAt: number;
};

type ReadFile = { version: 1; reads: BotConversationRead[] };

const LOCAL_USER = "__local__";
const path = () => join(PATHS.data, "bots", "conversation-reads.json");

export function botReadUser(user: string | null | undefined): string {
  return user?.trim().toLowerCase() || LOCAL_USER;
}

function readFile(): ReadFile {
  try {
    const parsed = JSON.parse(readFileSync(path(), "utf8")) as Partial<ReadFile>;
    return parsed.version === 1 && Array.isArray(parsed.reads)
      ? { version: 1, reads: parsed.reads }
      : { version: 1, reads: [] };
  } catch {
    return { version: 1, reads: [] };
  }
}

function writeFile(value: ReadFile): void {
  const target = path();
  const dir = dirname(target);
  mkdirSync(dir, { recursive: true });
  const temp = `${target}.${process.pid}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  try {
    const fd = openSync(temp, "r");
    try { fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, target);
    try {
      const dirFd = openSync(dir, "r");
      try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
    } catch {}
  } finally {
    try { unlinkSync(temp); } catch {}
  }
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

export function assertConversationAccess(
  requestedUser: string | null | undefined,
  sessionId: string,
  sessions: BotConversationOwnerRow[],
  bots: Bot[],
): { bot: Bot; user: string } {
  const owner = conversationOwner(sessionId, sessions, bots);
  if (!owner) throw new Error("bot conversation not found");
  if (owner.user !== botReadUser(requestedUser)) throw new Error("bot conversation belongs to another user");
  return owner;
}

export function conversationUnread(user: string, sessionId: string, latestAssistantRowid: number | null): boolean {
  if (latestAssistantRowid == null) return false;
  const key = botReadUser(user);
  const read = readFile().reads.find((row) => row.user === key && row.sessionId === sessionId);
  return !read || latestAssistantRowid > read.readThroughRowid;
}

export function markBotConversationRead(
  user: string,
  sessionId: string,
  latestAssistantRowid: number | null,
  now = Date.now(),
): BotConversationRead {
  const key = botReadUser(user);
  const file = readFile();
  const prior = file.reads.find((row) => row.user === key && row.sessionId === sessionId);
  const next: BotConversationRead = {
    user: key,
    sessionId,
    readThroughRowid: Math.max(prior?.readThroughRowid ?? 0, latestAssistantRowid ?? 0),
    updatedAt: now,
  };
  file.reads = [...file.reads.filter((row) => !(row.user === key && row.sessionId === sessionId)), next];
  writeFile(file);
  return next;
}

/** Seed the rollout baseline once, so upgrading does not mark old bot history unread. */
export function ensureBotConversationReadBaseline(
  user: string,
  sessionId: string,
  latestAssistantRowid: number | null,
  now = Date.now(),
): void {
  const key = botReadUser(user);
  const file = readFile();
  if (file.reads.some((row) => row.user === key && row.sessionId === sessionId)) return;
  file.reads.push({ user: key, sessionId, readThroughRowid: latestAssistantRowid ?? 0, updatedAt: now });
  writeFile(file);
}
