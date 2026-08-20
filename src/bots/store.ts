import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { PATHS } from "../config.ts";
import { sanitizeThinkingLevel, type AutoAgentBackend } from "../auto/store.ts";

/**
 * Persistent bots — the CRUD record store, phase 1 scope.
 *
 * A session is task-scoped: born from a prompt, ships, closes. A bot is
 * relationship-scoped: a named persistent agent with a persona and a face.
 * This store holds the record only — name, persona, avatar, which coding
 * agent runs it. It deliberately does NOT own a backing session, launch a
 * conversation, or expose messaging: bot chat is a later phase (see the
 * mobile PR this ships alongside — the New/Edit Bot sheet needs somewhere
 * to write a bot record to, and that is the entire job of this file).
 *
 * The mascot avatar: one eye (the species) x a home shape (the individual) x
 * a colorway. Shape and color compose into a bot's identity, so they are
 * stored on the record rather than derived — a bot looks the same everywhere
 * it appears, and keeps looking that way when the roster is reordered.
 * Mirrors web/src/components/BotAvatar.tsx's BOT_SHAPES/BOT_COLORWAYS
 * exactly, which is also what mobile/src/omg/bots.ts and bot-icons.ts key
 * their PNG lookup on.
 */
export const BOT_SHAPES = ["circle", "squircle", "teardrop", "pebble", "hexagon"] as const;
export const BOT_COLORWAYS = ["warm", "brand", "violet", "forest", "midnight"] as const;
export type BotShape = (typeof BOT_SHAPES)[number];
export type BotColorway = (typeof BOT_COLORWAYS)[number];

export type Bot = {
  id: string;
  name: string;
  shape?: BotShape;
  colorway?: BotColorway;
  persona: string;
  agent: string;
  model?: string;
  thinkingLevel?: string;
  cwd?: string;
  /** Roster email of whoever created the bot. */
  owner?: string;
  enabled: boolean;
  sessionId?: string;
  createdAt: number;
  lastMessageAt?: number;
};

const botsPath = () => join(PATHS.data, "bots", "bots.json");

function writeBots(bots: Bot[]): void {
  const path = botsPath();
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const temp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(bots, null, 2), { mode: 0o600 });
  try {
    const fd = openSync(temp, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, path);
    try {
      const dirFd = openSync(dir, "r");
      try {
        fsyncSync(dirFd);
      } finally {
        closeSync(dirFd);
      }
    } catch {}
  } finally {
    try {
      unlinkSync(temp);
    } catch {}
  }
}

export async function listBots(): Promise<Bot[]> {
  try {
    const parsed = JSON.parse(readFileSync(botsPath(), "utf8"));
    return Array.isArray(parsed) ? (parsed as Bot[]) : [];
  } catch {
    return [];
  }
}

export async function getBot(id: string): Promise<Bot | null> {
  return (await listBots()).find((bot) => bot.id === id) ?? null;
}

export async function createBot(input: {
  name: string;
  persona: string;
  agent?: string;
  model?: string;
  thinkingLevel?: string;
  cwd?: string;
  owner?: string;
  shape?: BotShape;
  colorway?: BotColorway;
}): Promise<Bot> {
  const bots = await listBots();
  let id: string;
  do id = `bot_${randomBytes(4).toString("hex")}`;
  while (bots.some((bot) => bot.id === id));
  const agent = input.agent || "aisdk";
  // Unpicked avatars walk the shape and colorway lists on different strides,
  // so the first bots in a roster look like distinct individuals instead of
  // five identical warm circles.
  const shape = input.shape ?? BOT_SHAPES[bots.length % BOT_SHAPES.length];
  const colorway = input.colorway ?? BOT_COLORWAYS[bots.length % BOT_COLORWAYS.length];
  const bot: Bot = {
    id,
    name: input.name,
    shape,
    colorway,
    persona: input.persona,
    agent,
    model: input.model,
    thinkingLevel: sanitizeThinkingLevel(input.thinkingLevel, agent as AutoAgentBackend),
    cwd: input.cwd,
    owner: input.owner,
    enabled: true,
    createdAt: Date.now(),
  };
  writeBots([...bots, bot]);
  return bot;
}

export async function updateBot(
  id: string,
  patch: Partial<
    Pick<
      Bot,
      | "name"
      | "shape"
      | "colorway"
      | "persona"
      | "agent"
      | "model"
      | "thinkingLevel"
      | "cwd"
      | "owner"
      | "enabled"
      | "sessionId"
      | "lastMessageAt"
    >
  >,
): Promise<Bot | null> {
  const bots = await listBots();
  const current = bots.find((bot) => bot.id === id);
  if (!current) return null;
  const agent = patch.agent ?? current.agent;
  const bot: Bot = {
    ...current,
    ...patch,
    agent,
    thinkingLevel: sanitizeThinkingLevel(
      Object.hasOwn(patch, "thinkingLevel") ? patch.thinkingLevel : current.thinkingLevel,
      agent as AutoAgentBackend,
    ),
  };
  writeBots(bots.map((item) => (item.id === id ? bot : item)));
  return bot;
}
