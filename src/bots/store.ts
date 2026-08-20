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
import { sanitizeThinkingLevel } from "../auto/store.ts";
import {
  BotOwnerQuotaError,
  persistentBotQuota,
  type PersistentBotQuotaPolicy,
} from "./quota.ts";

export { BotOwnerQuotaError } from "./quota.ts";

/**
 * The mascot avatar: one eye (the species) x a home shape (the individual) x a
 * colorway. Shape and color compose into a bot's identity, so they are stored
 * on the record rather than derived — a bot looks the same everywhere it
 * appears, and keeps looking that way when the roster is reordered.
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
  /** Short, non-secret role text that same-owner bots may discover. */
  description?: string;
  /** Declared coordination abilities. These are labels, not tool grants. */
  capabilities?: string[];
  agent: string;
  model?: string;
  thinkingLevel?: string;
  cwd?: string;
  /**
   * Roster email of whoever created the bot. The bot's backing session is
   * assigned to them at launch, so it shows up under their own filter in the
   * rail instead of landing in "unassigned" where nobody goes looking.
   */
  owner?: string;
  enabled: boolean;
  sessionId?: string;
  createdAt: number;
  lastMessageAt?: number;
  /** Relaunch with persisted profile/workspace data before the next user turn. */
  runtimeRefreshPending?: boolean;
};

/**
 * The conversation a bot's next process attaches to.
 *
 * A bot's id is its identity; this id is its *conversation*, and the two
 * outlive any process. The transcript read model is keyed on it
 * (`lfg://session/<id>`), so minting a new one on relaunch did not start a new
 * process against the same chat — it started a new chat, which is why a bot
 * that died came back with nothing to show. A bot mints exactly once, the first
 * time anyone talks to it.
 *
 * Named `sessionId` on the record for now because that is what every read path
 * still calls it; the concept is a conversation id.
 */
export function botConversationId(
  bot: Pick<Bot, "sessionId">,
  mintId: () => string,
): string {
  return bot.sessionId?.trim() || mintId();
}

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

function readBots(): Bot[] {
  try {
    const parsed = JSON.parse(readFileSync(botsPath(), "utf8"));
    return Array.isArray(parsed) ? parsed as Bot[] : [];
  } catch {
    return [];
  }
}

export async function listBots(): Promise<Bot[]> {
  return readBots();
}

export async function getBot(id: string): Promise<Bot | null> {
  return (await listBots()).find((bot) => bot.id === id) ?? null;
}

export async function createBot(input: {
  name: string;
  persona: string;
  description?: string;
  capabilities?: string[];
  agent?: string;
  model?: string;
  thinkingLevel?: string;
  cwd?: string;
  owner?: string;
  shape?: BotShape;
  colorway?: BotColorway;
  ownerQuota?: PersistentBotQuotaPolicy;
}): Promise<Bot> {
  // Keep the read, quota check, and write in one synchronous section. Two MCP
  // calls cannot both observe the last free slot before either commits it.
  const bots = readBots();
  if (input.owner && input.ownerQuota) {
    const quota = persistentBotQuota(bots, input.owner, input.ownerQuota);
    if (quota.remaining === 0) throw new BotOwnerQuotaError(input.owner, quota);
  }
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
    description: input.description,
    capabilities: input.capabilities,
    agent,
    model: input.model,
    thinkingLevel: sanitizeThinkingLevel(input.thinkingLevel, agent),
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
  patch: Partial<Pick<Bot, "name" | "shape" | "colorway" | "persona" | "description" | "capabilities" | "agent" | "model" | "thinkingLevel" | "cwd" | "owner" | "enabled" | "sessionId" | "lastMessageAt" | "runtimeRefreshPending">>,
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
      agent,
    ),
  };
  writeBots(bots.map((item) => item.id === id ? bot : item));
  return bot;
}

export async function deleteBot(id: string): Promise<void> {
  const bots = await listBots();
  writeBots(bots.filter((bot) => bot.id !== id));
}
