import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { PATHS } from "../config.ts";
import type { Bot } from "./store.ts";
import type { BotRuntimeActor } from "./self-management.ts";

export const BOT_PEER_MESSAGE_MAX_CHARS = 8_000;
export const BOT_PEER_MAX_DEPTH = 4;
export const BOT_PEER_RATE_LIMIT = 10;
export const BOT_PEER_RATE_WINDOW_MS = 60_000;

export class BotPeerMessageError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "BotPeerMessageError";
  }
}

export type BotPeerMessage = {
  id: string;
  correlationId: string;
  replyToMessageId?: string;
  sourceBotId: string;
  targetBotId: string;
  owner: string;
  depth: number;
  text: string;
  status: "reserved" | "enqueued";
  targetSessionId?: string;
  queueMessageId?: string;
  createdAt: number;
  enqueuedAt?: number;
};

type MessageRow = {
  id: string;
  correlation_id: string;
  reply_to_message_id: string | null;
  source_bot_id: string;
  target_bot_id: string;
  owner: string;
  depth: number;
  text: string;
  status: string;
  target_session_id: string | null;
  queue_message_id: string | null;
  created_at: number;
  enqueued_at: number | null;
};

let db: Database | null = null;
let openedPath: string | null = null;

function normalizeUser(value: string): string {
  return value.trim().toLowerCase();
}

function database(): Database {
  const path = join(PATHS.data, "lfg.sqlite");
  if (db && openedPath === path) return db;
  db?.close();
  mkdirSync(PATHS.data, { recursive: true });
  const opened = new Database(path, { create: true });
  opened.exec("PRAGMA journal_mode = WAL");
  opened.exec("PRAGMA synchronous = NORMAL");
  opened.exec("PRAGMA busy_timeout = 5000");
  opened.exec(`
    CREATE TABLE IF NOT EXISTS bot_peer_messages (
      id TEXT PRIMARY KEY,
      correlation_id TEXT NOT NULL,
      reply_to_message_id TEXT,
      source_bot_id TEXT NOT NULL,
      target_bot_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      depth INTEGER NOT NULL,
      text TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('reserved', 'enqueued')),
      target_session_id TEXT,
      queue_message_id TEXT,
      created_at INTEGER NOT NULL,
      enqueued_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS bot_peer_messages_source_rate
      ON bot_peer_messages(source_bot_id, created_at);
    CREATE INDEX IF NOT EXISTS bot_peer_messages_correlation
      ON bot_peer_messages(correlation_id, created_at, id);
  `);
  db = opened;
  openedPath = path;
  return opened;
}

function fromRow(row: MessageRow): BotPeerMessage {
  return {
    id: row.id,
    correlationId: row.correlation_id,
    ...(row.reply_to_message_id ? { replyToMessageId: row.reply_to_message_id } : {}),
    sourceBotId: row.source_bot_id,
    targetBotId: row.target_bot_id,
    owner: row.owner,
    depth: row.depth,
    text: row.text,
    status: row.status as BotPeerMessage["status"],
    ...(row.target_session_id ? { targetSessionId: row.target_session_id } : {}),
    ...(row.queue_message_id ? { queueMessageId: row.queue_message_id } : {}),
    createdAt: row.created_at,
    ...(row.enqueued_at ? { enqueuedAt: row.enqueued_at } : {}),
  };
}

function readMessage(id: string): BotPeerMessage | null {
  const row = database().query<MessageRow, [string]>(`
    SELECT id, correlation_id, reply_to_message_id, source_bot_id, target_bot_id,
      owner, depth, text, status, target_session_id, queue_message_id, created_at, enqueued_at
    FROM bot_peer_messages WHERE id = ?
  `).get(id);
  return row ? fromRow(row) : null;
}

function resolveTarget(actor: BotRuntimeActor, targetBotId: string, bots: Bot[]): Bot {
  const id = targetBotId.trim();
  if (!id) throw new BotPeerMessageError(400, "targetBotId is required");
  if (id === actor.bot.id) throw new BotPeerMessageError(400, "a bot cannot message itself");
  const target = bots.find((bot) => bot.id === id);
  if (!target) throw new BotPeerMessageError(404, "target bot not found");
  if (normalizeUser(target.owner ?? "") !== normalizeUser(actor.user)) {
    throw new BotPeerMessageError(403, "target bot is not owned by the assigned user");
  }
  if (!target.enabled) throw new BotPeerMessageError(409, "target bot is disabled");
  return target;
}

/**
 * Atomically validate and reserve one peer turn.
 *
 * The caller identity is already server-resolved. The only client selectors
 * are the safe peer id and an optional message id that the caller received.
 * Reply depth and correlation are always derived from the stored parent row.
 */
export function reserveBotPeerMessage(input: {
  actor: BotRuntimeActor;
  bots: Bot[];
  targetBotId: string;
  text: string;
  replyToMessageId?: string;
  now?: number;
}): { message: BotPeerMessage; target: Bot } {
  const target = resolveTarget(input.actor, input.targetBotId, input.bots);
  const text = input.text.trim();
  if (!text) throw new BotPeerMessageError(400, "text is required");
  if (text.length > BOT_PEER_MESSAGE_MAX_CHARS) {
    throw new BotPeerMessageError(413, `text must be at most ${BOT_PEER_MESSAGE_MAX_CHARS} characters`);
  }
  const now = input.now ?? Date.now();
  const owner = normalizeUser(input.actor.user);
  const id = `bmsg_${randomBytes(8).toString("hex")}`;

  const reserve = database().transaction(() => {
    let correlationId = `bcorr_${randomBytes(8).toString("hex")}`;
    let depth = 0;
    const replyToMessageId = input.replyToMessageId?.trim() || undefined;
    if (replyToMessageId) {
      const parent = readMessage(replyToMessageId);
      if (!parent || parent.status !== "enqueued") {
        throw new BotPeerMessageError(404, "reply message not found");
      }
      if (
        parent.owner !== owner ||
        parent.targetBotId !== input.actor.bot.id ||
        parent.sourceBotId !== target.id
      ) {
        throw new BotPeerMessageError(403, "reply message does not belong to this bot conversation");
      }
      if (parent.depth >= BOT_PEER_MAX_DEPTH) {
        throw new BotPeerMessageError(409, `conversation depth limit reached (${BOT_PEER_MAX_DEPTH})`);
      }
      correlationId = parent.correlationId;
      depth = parent.depth + 1;
    }

    const recent = database().query<{ count: number }, [string, number]>(`
      SELECT COUNT(*) AS count FROM bot_peer_messages
      WHERE source_bot_id = ? AND created_at > ?
    `).get(input.actor.bot.id, now - BOT_PEER_RATE_WINDOW_MS)?.count ?? 0;
    if (recent >= BOT_PEER_RATE_LIMIT) {
      throw new BotPeerMessageError(
        429,
        `peer message rate limit reached (${BOT_PEER_RATE_LIMIT} per minute)`,
      );
    }

    database().query(`
      INSERT INTO bot_peer_messages (
        id, correlation_id, reply_to_message_id, source_bot_id, target_bot_id,
        owner, depth, text, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?)
    `).run(
      id,
      correlationId,
      replyToMessageId ?? null,
      input.actor.bot.id,
      target.id,
      owner,
      depth,
      text,
      now,
    );
    return readMessage(id)!;
  });

  return { message: reserve.immediate(), target };
}

export function markBotPeerMessageEnqueued(
  id: string,
  targetSessionId: string,
  queueMessageId: string,
  now = Date.now(),
): BotPeerMessage {
  database().query(`
    UPDATE bot_peer_messages
    SET status = 'enqueued', target_session_id = ?, queue_message_id = ?, enqueued_at = ?
    WHERE id = ? AND status = 'reserved'
  `).run(targetSessionId, queueMessageId, now, id);
  const message = readMessage(id);
  if (!message || message.status !== "enqueued") {
    throw new Error("peer message reservation could not be finalized");
  }
  return message;
}

export function releaseBotPeerMessage(id: string): void {
  database().query("DELETE FROM bot_peer_messages WHERE id = ? AND status = 'reserved'").run(id);
}

export function getBotPeerMessage(id: string): BotPeerMessage | null {
  return readMessage(id);
}

export function formatBotPeerMessage(
  message: BotPeerMessage,
  source: Pick<Bot, "id" | "name">,
  target: Pick<Bot, "id" | "name">,
): string {
  return [
    `[Peer message from ${source.name} (${source.id}) to ${target.name} (${target.id})]`,
    `Message ID: ${message.id}`,
    `Correlation ID: ${message.correlationId}`,
    `Conversation depth: ${message.depth}/${BOT_PEER_MAX_DEPTH}`,
    message.replyToMessageId ? `Explicit reply to: ${message.replyToMessageId}` : "",
    "No model output is sent back automatically. To reply, explicitly call `omg_send_message_to_peer` with the sender bot ID and this Message ID as `replyToMessageId`.",
    "",
    message.text,
  ].filter((line) => line !== "").join("\n");
}

export function resetBotPeerMessageStoreForTests(): void {
  db?.close();
  db = null;
  openedPath = null;
}
