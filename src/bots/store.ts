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
  /**
   * Pinned Claude account for a Claude-backed bot. Empty/absent means "Auto",
   * which lets the launcher pick the account with the most headroom. Only the
   * Claude backend ("aisdk") has accounts, so the pin is dropped on any other
   * agent — the same rule an auto agent follows.
   */
  claudeAccountId?: string;
  cwd?: string;
  /**
   * Roster email of whoever created the bot. The bot's backing session is
   * assigned to them at launch, so it shows up under their own filter in the
   * rail instead of landing in "unassigned" where nobody goes looking.
   */
  owner?: string;
  enabled: boolean;
  /** Durable product conversation. Runtime session ids can rotate beneath it. */
  conversationId?: string;
  /** Current canonical primary runtime session. */
  sessionId?: string;
  createdAt: number;
  lastMessageAt?: number;
  /**
   * Legacy deferred-relaunch flag, kept only so a record written by an older
   * build still applies its pending edit after upgrade. New writes use the
   * revision pair below; see `src/bots/rotation.ts` for why a relaunch onto the
   * same conversation id was never a real refresh.
   */
  runtimeRefreshPending?: boolean;

  // ---- configuration versioning and rotation (src/bots/rotation.ts) ----
  /**
   * Monotonic revision of everything baked into the launch prompt. Bumped by
   * any edit touching SESSION_BOUND_BOT_FIELDS, never by a cosmetic one.
   */
  configRevision?: number;
  /** The revision actually live in the current canonical session. */
  appliedConfigRevision?: number;
  /** Lifecycle of an in-flight or deferred rotation. Absent means idle. */
  rotationState?: "idle" | "queued" | "rotating" | "failed";
  /** Why the pending/last rotation was requested. */
  rotationReason?: "config" | "compaction" | "restart";
  /** Primary runtime observed when an explicit restart was requested. */
  rotationExpectedSessionId?: string | null;
  /** Human-readable reason the last rotation attempt did not land. */
  rotationError?: string;
  rotationUpdatedAt?: number;
  lastRotatedAt?: number;
  /**
   * Prior canonical sessions, newest first and bounded. These stay resumable
   * and searchable through history; they are explicitly NOT roster rows and
   * never carry independent unread state.
   */
  archivedSessionIds?: string[];
  /**
   * Hysteresis latch for automatic compaction. `false` means the bot has
   * already rotated for context pressure and must fall back below the re-arm
   * mark before it may do so again. Absent means armed.
   */
  compactionArmed?: boolean;
  lastCompactionAt?: number;
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

/**
 * Keep a Claude account pin only where accounts exist.
 *
 * The pin names a local Claude credential set, and only the Claude backend
 * ("aisdk") reads one. A bot moved to any other agent must not keep a stored
 * pin, because nothing would honour it and it would come back if the bot were
 * moved to Claude again. An empty string or null clears the pin, which is the
 * "Claude - Auto" selection.
 */
export function sanitizeBotClaudeAccountId(
  value: string | null | undefined,
  agent: string,
): string | undefined {
  if (agent !== "aisdk") return undefined;
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || undefined;
}

export async function createBot(input: {
  name: string;
  persona: string;
  description?: string;
  capabilities?: string[];
  agent?: string;
  model?: string;
  thinkingLevel?: string;
  claudeAccountId?: string | null;
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
    claudeAccountId: sanitizeBotClaudeAccountId(input.claudeAccountId, agent),
    cwd: input.cwd,
    owner: input.owner,
    enabled: true,
    createdAt: Date.now(),
  };
  writeBots([...bots, bot]);
  return bot;
}

export type BotPatch = Partial<Pick<
  Bot,
  | "name" | "shape" | "colorway" | "persona" | "description" | "capabilities"
  | "agent" | "model" | "thinkingLevel" | "claudeAccountId" | "cwd" | "owner" | "enabled"
  | "conversationId" | "sessionId" | "lastMessageAt" | "runtimeRefreshPending"
  | "configRevision" | "appliedConfigRevision" | "rotationState"
  | "rotationReason" | "rotationExpectedSessionId" | "rotationError" | "rotationUpdatedAt" | "lastRotatedAt"
  | "archivedSessionIds" | "compactionArmed" | "lastCompactionAt"
>>;

function applyPatch(current: Bot, patch: BotPatch): Bot {
  const agent = patch.agent ?? current.agent;
  return {
    ...current,
    ...patch,
    agent,
    thinkingLevel: sanitizeThinkingLevel(
      Object.hasOwn(patch, "thinkingLevel") ? patch.thinkingLevel : current.thinkingLevel,
      agent,
    ),
    // Same rule as the thinking level: carry the pin forward on a plain edit,
    // but never past a backend switch that has no Claude accounts at all.
    claudeAccountId: sanitizeBotClaudeAccountId(
      Object.hasOwn(patch, "claudeAccountId") ? patch.claudeAccountId : current.claudeAccountId,
      agent,
    ),
  };
}

export async function updateBot(id: string, patch: BotPatch): Promise<Bot | null> {
  return mutateBot(id, (current) => applyPatch(current, patch));
}

/**
 * Read-modify-write a single bot in one synchronous section.
 *
 * `updateBot` used to `await listBots()` and then write. The await is a real
 * yield point, so two overlapping updates could both read the pre-state and the
 * second write would silently drop the first one's field — the classic lost
 * update. That was survivable when every patch was a whole-record form submit,
 * and stops being survivable once rotation writes a revision that a concurrent
 * writer must not clobber.
 *
 * There is no await between the read and the write here, so within this process
 * the mutation is atomic. `writeBots` is already atomic on disk (temp file plus
 * rename plus fsync), which covers the cross-process case as far as it can be
 * covered by a single-writer JSON store.
 *
 * `mutate` returning null aborts the write and reports the abort, which is what
 * makes a compare-and-swap expressible: read the current revision, decide, and
 * either commit or decline without ever leaving the critical section.
 */
export function mutateBot(
  id: string,
  mutate: (current: Bot) => Bot | null,
): Bot | null {
  const bots = readBots();
  const current = bots.find((bot) => bot.id === id);
  if (!current) return null;
  const next = mutate(current);
  if (!next) return null;
  writeBots(bots.map((item) => item.id === id ? next : item));
  return next;
}

export async function deleteBot(id: string): Promise<void> {
  const bots = await listBots();
  writeBots(bots.filter((bot) => bot.id !== id));
}
