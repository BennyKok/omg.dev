// Rotating a persistent bot onto a fresh canonical session.
//
// Two different problems land on the same primitive, which is why they live in
// one file instead of two.
//
// 1. CONFIGURATION. A bot's persona, description, capabilities, agent, model,
//    thinking level and workspace are all baked into the launch prompt
//    (`botRuntimeContract`, injected once by `ensureBotSession`). Editing any
//    of them changes what the bot is *supposed* to be, but the running model
//    session has already read the old text. There is no supported way to
//    rewrite a system prompt underneath a live model — every harness we drive
//    treats the launch prompt as immutable for the life of the thread — so the
//    only honest way to apply a persona edit is a new session.
//
//    The previous mechanism (`runtimeRefreshPending`) killed the process and
//    relaunched it on the SAME conversation id. That reads like a refresh and
//    is not one: `botConversationRef` deliberately reuses the id so the human's
//    transcript survives, and for aisdk `sessionHasIndexedMessages` then makes
//    the harness RESUME its own thread. The new contract text arrives as one
//    more turn appended to a conversation that still contains, and still obeys,
//    the old one. Users reported exactly that — "I changed the persona and it's
//    still acting like the old bot."
//
// 2. CONTEXT. A persistent bot is by construction long-lived. Its conversation
//    only ever grows, and at some point it stops fitting. Failing at the
//    context wall loses the turn and, worse, leaves the bot wedged: every retry
//    hits the same wall. Rotating *before* the wall, carrying a summary
//    forward, keeps the thread alive.
//
// Both want the same three steps: capture what matters, start a fresh session
// with the current config, then rebind. So there is one rotation primitive, and
// configuration/compaction are just two reasons to invoke it.
//
// This module is the pure half — decisions, revision arithmetic, checkpoint
// assembly and redaction. It spawns nothing and writes nothing, so every rule
// below is testable without a harness. The effectful half (spawn, rebind,
// archive) lives in serve.ts's `rotateBotSession`, which is the only writer.

import { stripOmgRuntimeContract } from "../omg-capabilities.ts";
import { stripBotLaunchEnvelope } from "./transcript.ts";
import type { Bot } from "./store.ts";

/** Why a rotation was asked for. Recorded so the UI can be truthful. */
export type BotRotationReason = "config" | "compaction" | "restart";

/**
 * Where a bot is in the rotation lifecycle.
 *
 * `queued` is the load-bearing one: a rotation that cannot run right now
 * because the bot is mid-turn is not a failure and must not be silently
 * dropped. It waits, visibly.
 */
export type BotRotationState = "idle" | "queued" | "rotating" | "failed";

/** What the bot editor shows next to its Apply control. */
export type BotConfigStatus =
  | "current"
  | "update-available"
  | "queued"
  | "refreshing"
  | "failed";

/**
 * Fields whose value is copied into the launch prompt, and which therefore
 * cannot change without a new session.
 *
 * This is the same set the old `runtimeRefreshPending` path used, kept
 * deliberately identical so the upgrade does not silently change which edits
 * are considered material. `name`, `description` and `capabilities` are in here
 * because `botRuntimeContract` interpolates all three; they look cosmetic in
 * the roster and are not.
 */
export const SESSION_BOUND_BOT_FIELDS: ReadonlySet<string> = new Set([
  "name",
  "persona",
  "description",
  "capabilities",
  "agent",
  "model",
  "thinkingLevel",
  "claudeAccountId",
  "cwd",
  "user",
]);

/**
 * Fields that already render live from the bot record on every surface.
 *
 * The avatar is read from the record by `BotMascot` at paint time, and
 * `enabled` is a gate the server checks per message. Neither is in the launch
 * prompt, so neither may force a rotation — making someone restart their bot's
 * conversation to change its colour would be absurd, and the requirement is
 * explicit that cosmetic edits must not rotate.
 */
export const COSMETIC_BOT_FIELDS: ReadonlySet<string> = new Set([
  "shape",
  "colorway",
  "enabled",
]);

/** Does this PATCH body mention anything baked into the launch prompt? */
export function botPatchTouchesSessionBoundField(body: Record<string, unknown>): boolean {
  return Object.keys(body).some((field) => SESSION_BOUND_BOT_FIELDS.has(field));
}

/** The projection of a bot that the launch prompt is built from. */
export type SessionBoundConfig = Pick<
  Bot,
  | "name" | "persona" | "description" | "capabilities" | "agent" | "model"
  | "thinkingLevel" | "claudeAccountId" | "cwd" | "owner"
>;

export function sessionBoundConfigOf(bot: SessionBoundConfig): SessionBoundConfig {
  return {
    name: bot.name,
    persona: bot.persona,
    description: bot.description,
    capabilities: bot.capabilities,
    agent: bot.agent,
    model: bot.model,
    thinkingLevel: bot.thinkingLevel,
    claudeAccountId: bot.claudeAccountId,
    cwd: bot.cwd,
    owner: bot.owner,
  };
}

const norm = (value: string | undefined | null): string => (value ?? "").trim();

/**
 * Did an edit actually change the launch prompt?
 *
 * Presence of a key is not enough, and this is the difference between a feature
 * that works and one everybody learns to ignore. The bot editor is a single
 * form that submits every field on Save, so `name`, `persona`, `agent`, `model`
 * and `cwd` are in the body of *every* PATCH — including one where the user
 * only picked a new colour. Bumping on key presence would mark the bot
 * "Update available" after a purely cosmetic save, offer a rotation that would
 * change nothing, and cost the user their conversation to apply a no-op.
 *
 * So compare values. Whitespace is normalised because a stray trailing space in
 * a textarea is not a persona change, and capabilities compare element-wise
 * because order is what the contract renders.
 */
export function sessionBoundConfigChanged(
  before: SessionBoundConfig,
  after: SessionBoundConfig,
): boolean {
  if (
    norm(before.name) !== norm(after.name) ||
    norm(before.persona) !== norm(after.persona) ||
    norm(before.description) !== norm(after.description) ||
    norm(before.agent) !== norm(after.agent) ||
    norm(before.model) !== norm(after.model) ||
    norm(before.thinkingLevel) !== norm(after.thinkingLevel) ||
    norm(before.claudeAccountId) !== norm(after.claudeAccountId) ||
    norm(before.cwd) !== norm(after.cwd) ||
    norm(before.owner).toLowerCase() !== norm(after.owner).toLowerCase()
  ) {
    return true;
  }
  const left = (before.capabilities ?? []).map(norm);
  const right = (after.capabilities ?? []).map(norm);
  return left.length !== right.length || left.some((item, index) => item !== right[index]);
}

/**
 * The revision arithmetic.
 *
 * Legacy bots carry neither field. Defaulting `configRevision` to 1 and
 * `appliedConfigRevision` to 0 would light up "Update available" on every bot
 * in the roster the moment this ships, for a change nobody made — so an absent
 * applied revision reads as "whatever the current revision is", i.e. current.
 * The first real session-bound edit after the upgrade bumps to 2 and the
 * difference becomes meaningful.
 */
export function botConfigRevision(bot: Pick<Bot, "configRevision">): number {
  const value = bot.configRevision;
  return Number.isInteger(value) && (value as number) >= 1 ? value as number : 1;
}

export function botAppliedConfigRevision(
  bot: Pick<Bot, "configRevision" | "appliedConfigRevision">,
): number {
  const value = bot.appliedConfigRevision;
  if (Number.isInteger(value) && (value as number) >= 0) return value as number;
  return botConfigRevision(bot);
}

/** The revision a session-bound edit moves the bot to. Monotonic by construction. */
export function nextBotConfigRevision(bot: Pick<Bot, "configRevision">): number {
  return botConfigRevision(bot) + 1;
}

/** Is the bot's live configuration older than its record's? */
export function botHasPendingConfig(
  bot: Pick<Bot, "configRevision" | "appliedConfigRevision">,
): boolean {
  return botAppliedConfigRevision(bot) < botConfigRevision(bot);
}

/**
 * The single truthful answer to "what does the Apply control say".
 *
 * Order matters. An in-flight rotation outranks a pending edit, because while
 * it runs the honest word is "Refreshing" even though the revisions still
 * differ — they only converge at the very end, on rebind. A failure outranks
 * "update available" for the same reason: the user needs to know the last
 * attempt did not land, not just that one is outstanding.
 */
export function botConfigStatus(
  bot: Pick<
    Bot,
    "configRevision" | "appliedConfigRevision" | "rotationState" | "rotationReason"
  >,
): BotConfigStatus {
  // Restart and compaction are runtime lifecycle states, not configuration
  // status. Letting either turn the editor into "Refresh failed" would merge
  // the three actions back together in the one place their distinction matters.
  const applyingConfig = bot.rotationReason === "config";
  if (applyingConfig && bot.rotationState === "rotating") return "refreshing";
  if (applyingConfig && bot.rotationState === "failed") return "failed";
  if (!botHasPendingConfig(bot)) return "current";
  return applyingConfig && bot.rotationState === "queued" ? "queued" : "update-available";
}

// ---------------------------------------------------------------------------
// Admission: may a rotation run right now?
// ---------------------------------------------------------------------------

/** A live session as the rotation gate needs to see it. */
export type BotRotationSession = {
  sessionId?: string | null;
  nativeSessionId?: string | null;
  botId?: string | null;
  busy?: boolean;
  pid?: number | null;
  launching?: boolean;
  parentSessionId?: string | null;
  parentNativeSessionId?: string | null;
  subagentDepth?: number | null;
  spawnedBy?: string | null;
};

export type BotRotationBlock = "primary-busy" | "children-active";

export type BotRotationAdmission =
  | { ready: true }
  | { ready: false; blocked: BotRotationBlock; children: string[] };

/**
 * Delegated children of this bot that are still running.
 *
 * Child sessions inherit `botId` for attribution (see the note atop
 * session.ts), which is what makes them findable here — and is also why the
 * primary must be matched by identity rather than by `botId` alone.
 */
export function activeBotChildren<T extends BotRotationSession>(
  botId: string,
  sessions: readonly T[],
): T[] {
  return sessions.filter((session) => {
    if (session.botId !== botId) return false;
    const delegated =
      !!session.parentSessionId ||
      !!session.parentNativeSessionId ||
      !!session.subagentDepth ||
      session.spawnedBy === "subagent";
    if (!delegated) return false;
    // listSessions can retain resumable history. Only a running or launching
    // child can still report into the primary and therefore block rotation.
    return session.pid === undefined
      ? true
      : !!session.busy || !!session.launching || (session.pid ?? 0) > 0;
  });
}

/**
 * Whether rotation may proceed, and if not, why.
 *
 * For a rotation the machine decided to run, the default is to wait, never to
 * kill. A bot mid-turn is producing an answer somebody is waiting for; a bot
 * with live children has delegated work that will try to report home. Rotating
 * through either loses real work silently, which is the one outcome worse than
 * a stale persona.
 *
 * A human `restart` is the exception, and it is not a special case so much as
 * the whole point of the action. Waiting is only safe while the busy signal
 * still means progress. The reason a person reaches for Restart is that it
 * does not: a wedged turn, a provider error the harness never returned from, a
 * runtime whose session id no longer resolves. Those states report `busy`
 * forever, so an admission gate turns the one escape hatch into another thing
 * that is stuck. Deferring here produced exactly that bug — a restart parked
 * as "queued" behind a turn that could never end.
 *
 * So a restart is admitted unconditionally, and the work that admission used
 * to protect is carried instead of guarded: `rotateBotSession` moves the
 * undelivered send queue onto the replacement, and a late child report finds
 * the bot through its archived session ids.
 */
export function botRotationAdmission(
  botId: string,
  primary: BotRotationSession | undefined,
  sessions: readonly BotRotationSession[],
  reason: BotRotationReason = "config",
): BotRotationAdmission {
  if (reason === "restart") return { ready: true };
  if (primary?.busy) {
    return {
      ready: false,
      blocked: "primary-busy",
      children: [],
    };
  }
  const children = activeBotChildren(botId, sessions)
    .map((session) => session.sessionId ?? session.nativeSessionId)
    .filter((id): id is string => !!id);
  if (children.length) return { ready: false, blocked: "children-active", children };
  return { ready: true };
}

/**
 * A queued turn must keep its original ordering and finish before rotation.
 *
 * Applies to automatic rotations only. A restart carries the queue forward
 * instead of waiting for it, because a queue that cannot drain is the symptom
 * the human is restarting to clear.
 */
export function queueBlocksBotRotation(
  messages: readonly { status: string }[],
): boolean {
  return messages.some((message) =>
    message.status === "pending" || message.status === "sending" || message.status === "queued"
  );
}

// ---------------------------------------------------------------------------
// Automatic compaction
// ---------------------------------------------------------------------------

export type BotCompactionSettings = {
  /** Master switch. Off means a bot only ever rotates when a human applies a change. */
  enabled: boolean;
  /** Rotate at or above this share of the model's context window. */
  thresholdPercent: number;
  /** Re-arm only after usage falls back to or below this share. */
  rearmPercent: number;
  /** Floor between two automatic rotations, whatever the numbers say. */
  minIntervalMs: number;
};

export const DEFAULT_BOT_COMPACTION_THRESHOLD_PERCENT = 78;
export const DEFAULT_BOT_COMPACTION_REARM_PERCENT = 55;
export const DEFAULT_BOT_COMPACTION_MIN_INTERVAL_MS = 5 * 60_000;
export const MIN_BOT_COMPACTION_THRESHOLD_PERCENT = 40;
export const MAX_BOT_COMPACTION_THRESHOLD_PERCENT = 95;

export function defaultBotCompactionSettings(): BotCompactionSettings {
  return {
    enabled: true,
    thresholdPercent: DEFAULT_BOT_COMPACTION_THRESHOLD_PERCENT,
    rearmPercent: DEFAULT_BOT_COMPACTION_REARM_PERCENT,
    minIntervalMs: DEFAULT_BOT_COMPACTION_MIN_INTERVAL_MS,
  };
}

/**
 * Clamp an operator-supplied threshold into a range where it still means
 * something. Below 40% a bot would rotate constantly and never accumulate
 * enough thread to be useful; above 95% there is not enough headroom left to
 * write the checkpoint and launch a replacement before the wall.
 */
export function sanitizeBotCompactionThreshold(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_BOT_COMPACTION_THRESHOLD_PERCENT;
  return Math.min(
    MAX_BOT_COMPACTION_THRESHOLD_PERCENT,
    Math.max(MIN_BOT_COMPACTION_THRESHOLD_PERCENT, Math.round(numeric)),
  );
}

/** The context reading compaction is allowed to act on. Shape of `SessionTokenUsage`. */
export type BotContextReading = {
  available?: boolean;
  source?: string;
  context?: {
    used?: number | null;
    max?: number | null;
    percent?: number | null;
  } | null;
};

export type BotCompactionDecision = {
  rotate: boolean;
  /** The armed flag to persist back onto the bot. */
  armed: boolean;
  /** Measured fill, or null when the harness does not report usable numbers. */
  percent: number | null;
  reason:
    | "disabled"
    | "no-token-data"
    | "below-threshold"
    | "not-armed"
    | "too-soon"
    | "threshold-crossed";
};

/**
 * Should this bot rotate for context pressure?
 *
 * Deliberately refuses to guess. When the harness does not report token usage
 * the answer is "no", not "fall back to counting transcript rows" — a row count
 * has no fixed relationship to context fill (one tool result can outweigh two
 * hundred chat turns), so acting on it would rotate healthy bots and miss full
 * ones. A bot on a harness with no token telemetry keeps the old behaviour of
 * running until the harness itself complains, which is no worse than today.
 *
 * Hysteresis is the other half. A bare threshold thrashes: the checkpoint
 * carried into the new session is itself context, so a bot that rotates at 78%
 * may well start life at 30-40%, and any noise around the line would rotate it
 * again immediately. Usage must fall back to `rearmPercent` before another
 * automatic rotation can fire, and `minIntervalMs` is the belt-and-braces floor
 * for a bot whose fresh session somehow still reads above the re-arm mark.
 */
export function botCompactionDecision(input: {
  usage: BotContextReading | null | undefined;
  bot: Pick<Bot, "compactionArmed" | "lastCompactionAt">;
  settings: BotCompactionSettings;
  now: number;
}): BotCompactionDecision {
  // An absent flag means armed. A bot that has never rotated must be eligible
  // the first time it fills up, and persisting `true` for every bot at upgrade
  // time just to say "not yet used" is state for its own sake.
  const armed = input.bot.compactionArmed !== false;
  if (!input.settings.enabled) {
    return { rotate: false, armed, percent: null, reason: "disabled" };
  }

  const percent = measuredContextPercent(input.usage);
  if (percent === null) {
    return { rotate: false, armed, percent: null, reason: "no-token-data" };
  }

  // Re-arm first, so a single reading that is both below the re-arm mark and
  // (impossibly) above the threshold cannot do both. Below re-arm is
  // unambiguously "healthy", and healthy never rotates.
  if (percent <= input.settings.rearmPercent) {
    return { rotate: false, armed: true, percent, reason: "below-threshold" };
  }
  if (percent < input.settings.thresholdPercent) {
    return { rotate: false, armed, percent, reason: "below-threshold" };
  }
  // At or above the line from here down.
  if (!armed) return { rotate: false, armed, percent, reason: "not-armed" };
  const last = input.bot.lastCompactionAt ?? 0;
  if (last && input.now - last < input.settings.minIntervalMs) {
    return { rotate: false, armed, percent, reason: "too-soon" };
  }
  return { rotate: true, armed: false, percent, reason: "threshold-crossed" };
}

/**
 * Context fill as a percentage, or null when it cannot be established.
 *
 * Recomputed from `used`/`max` rather than trusting a reported `percent`,
 * because the two disagree in practice: some harnesses report a percentage
 * against a soft "usable" window while `max` is the hard one. The ratio we act
 * on has to be the ratio against the number that actually overflows. `percent`
 * alone is accepted only when the raw pair is missing.
 */
export function measuredContextPercent(usage: BotContextReading | null | undefined): number | null {
  const context = usage?.context;
  if (!context) return null;
  const used = context.used;
  const max = context.max;
  if (typeof used === "number" && Number.isFinite(used) && used >= 0 &&
      typeof max === "number" && Number.isFinite(max) && max > 0) {
    return (used / max) * 100;
  }
  const percent = context.percent;
  if (typeof percent === "number" && Number.isFinite(percent) && percent >= 0) return percent;
  return null;
}

// ---------------------------------------------------------------------------
// The handoff checkpoint
// ---------------------------------------------------------------------------

/**
 * One turn carried across the boundary.
 *
 * `author` is the trusted normalized author identity (an email), server-derived,
 * or the explicit `legacy:unknown` marker. It exists for multi-user bot threads: when several
 * people share a conversation, collapsing every human turn to the bare word
 * "user" loses who said what, and the bot wakes up in the new session unable to
 * attribute a preference or a request to the person who made it.
 *
 * It is an email rather than a display name because on a hosted shared Computer
 * a display name does not exist server-side — the local roster is empty by
 * construction there, and member profiles live only in the roster control-plane
 * merges into the bootstrap response. The verified header value is the only
 * identity the box actually holds. It is also no more disclosure than the
 * surrounding transcript already carries, since the delivered prompt is already
 * wrapped in `[Message from <email> to bot <name>]`.
 */
export type CheckpointTurn = {
  role: "user" | "assistant";
  text: string;
  author?: string;
};

/** Attribution is prose in a durable prompt, so it is bounded like everything else. */
export const CHECKPOINT_MAX_AUTHOR_CHARS = 60;

export type BotHandoffCheckpoint = {
  /** Where this came from, so the new session can cite it rather than claim it. */
  sourceSessionId: string;
  reason: BotRotationReason;
  configRevision: number;
  createdAt: number;
  goals: string[];
  decisions: string[];
  openTasks: string[];
  preferences: string[];
  artifacts: string[];
  recentTurns: CheckpointTurn[];
};

/**
 * Build conservative structured sections from explicit prose signals.
 *
 * The latest human turns are current goals. Decisions, unresolved work, and
 * preferences require direct wording. This avoids inventing durable facts from
 * ordinary discussion while still giving the new runtime more than a raw tail.
 */
export function extractCheckpointSections(turns: readonly CheckpointTurn[]): Pick<
  BotHandoffCheckpoint,
  "goals" | "decisions" | "openTasks" | "preferences"
> {
  const human = turns.filter((turn) => turn.role === "user" && turn.text.trim());
  const goals = human.slice(-3).map((turn) => turn.text);
  const lines = turns.flatMap((turn) =>
    turn.text.split(/\n+/).map((line) => line.replace(/^[-*\d.)\s]+/, "").trim()).filter(Boolean)
  );
  return {
    goals,
    decisions: lines.filter((line) =>
      /^(?:decision|decided)\s*[:\-]|\b(?:we|the user) (?:decided|will use|will keep)\b|\bmust (?:remain|stay|use|not)\b/i.test(line)
    ),
    openTasks: lines.filter((line) =>
      /^(?:todo|open task|remaining|next|unresolved|blocked)\s*[:\-]|\b(?:still need|remains to|not yet)\b/i.test(line)
    ),
    preferences: lines.filter((line) =>
      /\b(?:I|the user) (?:prefer|always want|never want)\b|^(?:preference|user preference)\s*[:\-]/i.test(line)
    ),
  };
}

/** Hard bounds. A checkpoint that blows the budget defeats the point of rotating. */
export const CHECKPOINT_MAX_TURNS = 12;
export const CHECKPOINT_MAX_TURN_CHARS = 600;
export const CHECKPOINT_MAX_SECTION_ITEMS = 8;
export const CHECKPOINT_MAX_ITEM_CHARS = 300;
export const CHECKPOINT_MAX_TOTAL_CHARS = 12_000;

/**
 * Patterns that must never cross the boundary.
 *
 * A checkpoint is written into the next session's launch prompt, which is
 * persisted, indexed, and readable anywhere the transcript is. Anything secret
 * that lands there has been copied into a second durable place. Cheap prefix
 * matching on the well-known shapes is not a general secret scanner and is not
 * claimed to be one; it is the floor, and the real defence is that only user
 * and assistant prose is eligible in the first place (no tool results, no
 * environment, no contract text).
 */
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bghp_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\b(?:api[_-]?key|secret|password|passwd|token|bearer)\s*[:=]\s*\S{8,}/gi,
];

/**
 * Strip anything that must not be copied forward.
 *
 * Four separate things are being removed, in order:
 *  - the BOT launch envelope: the bot runtime contract, any prior-conversation
 *    summary, and any earlier handoff checkpoint. This is the one that must not
 *    be forgotten. The contract carries the bot's persona verbatim, so copying
 *    a launch turn forward would paste the OLD persona into the new session's
 *    prompt and the bot would keep behaving like its old self — reintroducing
 *    the exact bug rotation exists to fix, in the exact code that fixes it.
 *    Stripping earlier checkpoints also stops summaries nesting inside
 *    summaries as a long-lived bot rotates for the fifth time;
 *  - the task-session runtime contract, same reasoning, different envelope;
 *  - credential-shaped strings;
 *  - the peer-message envelope header, which carries routing ids that mean
 *    nothing in a new session.
 */
export function redactForCheckpoint(text: string): string {
  let out = stripOmgRuntimeContract(stripBotLaunchEnvelope(text));
  out = out.replace(/^\[Peer message from [^\]]*\]\s*/gm, "");
  out = out.replace(/^Message ID: \S+$/gm, "");
  out = out.replace(/^Correlation ID: \S+$/gm, "");
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[redacted]");
  return out.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function clampItems(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const text = redactForCheckpoint(String(raw ?? "")).slice(0, CHECKPOINT_MAX_ITEM_CHARS).trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= CHECKPOINT_MAX_SECTION_ITEMS) break;
  }
  return out;
}

/**
 * Assemble a checkpoint from whatever the summarizer produced plus the tail of
 * the conversation.
 *
 * The structured sections are best-effort: when the summarizer is unavailable
 * or returns nothing usable, the recent turns alone still carry the thread, and
 * that is a materially better handoff than starting blank. What is NOT
 * best-effort is the bound — every section is clamped here rather than trusted,
 * because the input may come from a model.
 */
export function buildHandoffCheckpoint(input: {
  sourceSessionId: string;
  reason: BotRotationReason;
  configRevision: number;
  createdAt: number;
  goals?: readonly string[];
  decisions?: readonly string[];
  openTasks?: readonly string[];
  preferences?: readonly string[];
  artifacts?: readonly string[];
  turns?: readonly CheckpointTurn[];
}): BotHandoffCheckpoint {
  const recentTurns = (input.turns ?? [])
    .filter((turn) => turn.role === "user" || turn.role === "assistant")
    .slice(-CHECKPOINT_MAX_TURNS)
    .map((turn) => {
      const author = redactForCheckpoint(turn.author ?? "")
        .slice(0, CHECKPOINT_MAX_AUTHOR_CHARS)
        .trim();
      return {
        role: turn.role,
        text: redactForCheckpoint(turn.text ?? "").slice(0, CHECKPOINT_MAX_TURN_CHARS).trim(),
        ...(author ? { author } : {}),
      };
    })
    .filter((turn) => !!turn.text);

  return {
    sourceSessionId: input.sourceSessionId,
    reason: input.reason,
    configRevision: input.configRevision,
    createdAt: input.createdAt,
    goals: clampItems(input.goals ?? []),
    decisions: clampItems(input.decisions ?? []),
    openTasks: clampItems(input.openTasks ?? []),
    preferences: clampItems(input.preferences ?? []),
    artifacts: clampItems(input.artifacts ?? []),
    recentTurns,
  };
}

/** Does this checkpoint carry anything at all worth injecting? */
export function checkpointIsEmpty(checkpoint: BotHandoffCheckpoint): boolean {
  return (
    !checkpoint.goals.length &&
    !checkpoint.decisions.length &&
    !checkpoint.openTasks.length &&
    !checkpoint.preferences.length &&
    !checkpoint.artifacts.length &&
    !checkpoint.recentTurns.length
  );
}

const CHECKPOINT_HEADER = "=== omg.dev BOT HANDOFF CHECKPOINT ===";
const CHECKPOINT_FOOTER = "=== END omg.dev BOT HANDOFF CHECKPOINT ===";

/**
 * Render the checkpoint for the launch prompt.
 *
 * Provenance is stated first and in the model's own reading order: this is a
 * summary, it was machine-written, and it came from a specific earlier session.
 * Without that line a bot reads its own summary as first-hand memory and will
 * happily assert a "decision" it never witnessed as though it had. Naming the
 * source session id also gives it something real to cite when the human asks
 * where something came from.
 */
export function formatHandoffCheckpoint(checkpoint: BotHandoffCheckpoint): string {
  const section = (title: string, items: readonly string[]): string =>
    items.length ? [`${title}:`, ...items.map((item) => `- ${item}`)].join("\n") : "";

  const turns = checkpoint.recentTurns.length
    ? [
        "Recent turns (oldest first, abbreviated):",
        ...checkpoint.recentTurns.map((turn) =>
          `- ${turn.author ? `${turn.role} (${turn.author})` : turn.role}: ${turn.text}`
        ),
      ].join("\n")
    : "";

  const body = [
    CHECKPOINT_HEADER,
    `- This is a machine-generated summary of an earlier session, not your own memory.`,
    `- Source session: ${checkpoint.sourceSessionId}`,
    `- Reason for the new session: ${
      checkpoint.reason === "config"
        ? "your configuration was updated"
        : "the previous conversation was approaching its context limit"
    }.`,
    `- Treat it as briefing material. If the human asks about something not covered here, say you are picking the thread back up rather than inventing detail.`,
    "",
    section("Current goals", checkpoint.goals),
    section("Durable decisions", checkpoint.decisions),
    section("Unresolved tasks", checkpoint.openTasks),
    section("User preferences", checkpoint.preferences),
    section("Referenced artifacts and commits", checkpoint.artifacts),
    turns,
    CHECKPOINT_FOOTER,
  ]
    .filter((part) => part !== "")
    .join("\n\n");

  return body.length > CHECKPOINT_MAX_TOTAL_CHARS
    ? `${body.slice(0, CHECKPOINT_MAX_TOTAL_CHARS)}\n${CHECKPOINT_FOOTER}`
    : body;
}

/**
 * The one line the human sees in the new conversation.
 *
 * "Visible but quiet" is the requirement, and both halves matter. Silent
 * rotation is disorienting — the bot appears to forget mid-thread with no
 * explanation. A loud one makes the machinery the subject of a conversation
 * that was about something else. One sentence, stated once, at the top.
 */
export function rotationNoticeText(reason: BotRotationReason): string {
  if (reason === "config") {
    return "[This conversation continues with your updated configuration. Earlier history is preserved and searchable.]";
  }
  if (reason === "restart") {
    return "[This conversation continues after a runtime restart. Earlier history is preserved and searchable.]";
  }
  return "[This conversation continues in a fresh context window. Earlier history is preserved and searchable.]";
}

/**
 * Serialized rotations plus a compare-and-swap on the revision.
 *
 * The mutex in serve.ts stops two rotations for one bot overlapping, but it
 * does not stop the second one being pointless: two browser tabs both clicking
 * Apply produce two queued rotations, and the first one already applied the
 * revision the second was asked for. Retrying it would spawn a second session,
 * throw away the first, and cost the user their thread for nothing.
 *
 * So a rotation names the revision it intends to apply, and a rotation whose
 * target is already applied is a no-op success rather than an error — the
 * caller asked for "config revision N is live", and it is. A rotation naming a
 * revision that no longer exists (the record moved on again) is stale and is
 * rejected so the caller re-reads and retries against the current one.
 */
export type RotationCasResult =
  | { proceed: true }
  | { proceed: false; outcome: "already-applied" | "stale" };

export function rotationCompareAndSwap(
  bot: Pick<Bot, "configRevision" | "appliedConfigRevision">,
  expectedRevision: number | undefined,
): RotationCasResult {
  const current = botConfigRevision(bot);
  const applied = botAppliedConfigRevision(bot);
  // No expectation supplied: compaction and other server-initiated rotations
  // always target whatever is current.
  if (expectedRevision === undefined) return { proceed: true };
  if (expectedRevision <= applied) return { proceed: false, outcome: "already-applied" };
  if (expectedRevision !== current) return { proceed: false, outcome: "stale" };
  return { proceed: true };
}

/**
 * Compare the runtime a manual restart was requested against with the current
 * primary binding. The per-bot mutex prevents overlap; this comparison prevents
 * a duplicate request that waited on that mutex from restarting the replacement
 * a second time.
 */
export function runtimeRotationCompareAndSwap(
  bot: Pick<Bot, "sessionId">,
  expectedSessionId: string | null | undefined,
): { proceed: true } | { proceed: false; outcome: "already-rotated" } {
  // Server-owned automatic rotations do not use this CAS. A manual route must
  // always send the runtime identity it observed, including null.
  if (expectedSessionId === undefined) return { proceed: true };
  const current = bot.sessionId?.trim() || null;
  return current === expectedSessionId
    ? { proceed: true }
    : { proceed: false, outcome: "already-rotated" };
}

/** Translate the old deferred-refresh flag without losing its requested edit. */
export function migrateLegacyBotRotationState(bot: Bot, now = Date.now()): Bot {
  if (!bot.runtimeRefreshPending) return bot;
  return {
    ...bot,
    conversationId: bot.conversationId?.trim() || bot.sessionId?.trim() || undefined,
    runtimeRefreshPending: false,
    configRevision: nextBotConfigRevision(bot),
    appliedConfigRevision: botConfigRevision(bot),
    rotationState: "queued",
    rotationReason: "config",
    rotationError: undefined,
    rotationUpdatedAt: now,
  };
}

/** Bounded archive of prior canonical sessions, newest first. */
export const MAX_ARCHIVED_BOT_SESSIONS = 25;

export function appendArchivedSession(
  existing: readonly string[] | undefined,
  sessionId: string,
): string[] {
  const rest = (existing ?? []).filter((id) => id && id !== sessionId);
  return [sessionId, ...rest].slice(0, MAX_ARCHIVED_BOT_SESSIONS);
}
