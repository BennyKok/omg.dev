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
import { dirname, join } from "node:path";
import { PATHS } from "./config.ts";
import { botAuthorId, botAuthorIdFromText } from "./bots/authorship.ts";
import type {
  Conversation,
  ConversationHistoryAccess,
  ConversationParticipant,
  ConversationParticipantRole,
  MessageAuthorRef,
} from "./conversation-contract.ts";
export type {
  Conversation,
  ConversationHistoryAccess,
  ConversationParticipant,
  ConversationParticipantRole,
  MessageAuthorRef,
} from "./conversation-contract.ts";

export const UNKNOWN_LEGACY_AUTHOR: MessageAuthorRef = {
  kind: "legacy",
  participantId: "legacy:unknown",
  verified: false,
};

type LegacySession = {
  sessionId?: string | null;
  conversationId?: string | null;
  parentSessionId?: string | null;
  parentNativeSessionId?: string | null;
  spawnedBy?: string | null;
  botId?: string | null;
  assignedUser?: string | null;
  title?: string | null;
  startedAt?: number | null;
};

type LegacyBot = {
  id: string;
  name: string;
  owner?: string | null;
  sessionId?: string | null;
  shape?: string | null;
  colorway?: string | null;
};

type RosterUser = { email: string; name?: string | null; avatar?: string | null };

const storePath = () => join(PATHS.data, "conversations", "conversations.json");

function normalizeIdentity(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function conversationHumanParticipantId(identity: string): string {
  const digest = botAuthorId(identity);
  return digest ? `human:${digest}` : "";
}

export function botParticipantId(botId: string): string {
  return `bot:${botId}`;
}

function isConversation(value: unknown): value is Conversation {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<Conversation>;
  return typeof row.id === "string" && Array.isArray(row.participants) && Array.isArray(row.runtimeSessions);
}

function readStore(): Conversation[] {
  try {
    const parsed = JSON.parse(readFileSync(storePath(), "utf8"));
    return Array.isArray(parsed) ? parsed.filter(isConversation) : [];
  } catch {
    return [];
  }
}

function writeStore(conversations: Conversation[]): void {
  const path = storePath();
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const temp = `${path}.${process.pid}.${crypto.randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(conversations, null, 2), { mode: 0o600 });
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

export function listConversations(): Conversation[] {
  return readStore();
}

export function getConversation(id: string): Conversation | null {
  return readStore().find((row) => row.id === id) ?? null;
}

export function ensureBotConversation(input: {
  conversationId: string;
  bot: LegacyBot;
  ownerIdentity?: string | null;
  roster?: readonly RosterUser[];
  now?: number;
}): Conversation {
  const existing = getConversation(input.conversationId);
  if (existing) return existing;
  const now = input.now ?? Date.now();
  const participants = [botParticipant(input.bot, now)];
  const human = rosterParticipant(input.ownerIdentity ?? input.bot.owner ?? "", input.roster ?? [], now);
  if (human) participants.unshift(human);
  const conversation: Conversation = {
    id: input.conversationId,
    title: input.bot.name,
    participants,
    runtimeSessions: [],
    createdAt: now,
    updatedAt: now,
    legacy: {
      source: "bot_session",
      botId: input.bot.id,
      sessionId: input.conversationId,
    },
  };
  writeStore([...readStore(), conversation]);
  return conversation;
}

export function ensureConversationHuman(input: {
  conversationId: string;
  identity: string;
  name?: string | null;
  avatar?: string | null;
  role?: ConversationParticipantRole;
  historyAccess?: ConversationHistoryAccess;
  joinedAt?: number;
}): Conversation | null {
  const conversation = getConversation(input.conversationId);
  const id = conversationHumanParticipantId(input.identity);
  if (!conversation || !id) return conversation;
  const existing = conversation.participants.find((row) => row.id === id);
  if (existing) return conversation;
  return upsertConversationParticipant(input.conversationId, {
    id,
    kind: "human",
    role: input.role ?? (conversation.participants.some((row) => row.kind === "human") ? "member" : "owner"),
    display: {
      name: input.name ?? null,
      avatar: input.avatar ?? null,
      fallback: input.name?.trim() || normalizeIdentity(input.identity).split("@")[0] || "Member",
    },
    joinedAt: input.joinedAt ?? Date.now(),
    historyAccess: input.historyAccess ?? "all",
  });
}

function rosterParticipant(identity: string, roster: readonly RosterUser[], now: number): ConversationParticipant | null {
  const normalized = normalizeIdentity(identity);
  const id = conversationHumanParticipantId(normalized);
  if (!id) return null;
  const profile = roster.find((user) => normalizeIdentity(user.email) === normalized);
  return {
    id,
    kind: "human",
    role: "owner",
    display: {
      name: profile?.name ?? null,
      avatar: profile?.avatar ?? null,
      fallback: profile?.name?.trim() || normalized.split("@")[0] || "Member",
    },
    joinedAt: now,
    historyAccess: "all",
  };
}

function botParticipant(bot: LegacyBot, now: number): ConversationParticipant {
  return {
    id: botParticipantId(bot.id),
    kind: "bot",
    role: "member",
    display: { name: bot.name, fallback: bot.name || "Bot" },
    joinedAt: now,
    historyAccess: "all",
  };
}

export function conversationBotParticipant(
  bot: LegacyBot,
  input: { role?: ConversationParticipantRole; joinedAt?: number; historyAccess?: ConversationHistoryAccess } = {},
): ConversationParticipant {
  const participant = botParticipant(bot, input.joinedAt ?? Date.now());
  participant.role = input.role ?? participant.role;
  participant.historyAccess = input.historyAccess ?? participant.historyAccess;
  return participant;
}

function delegated(session: LegacySession): boolean {
  return !!(
    session.parentSessionId ||
    session.parentNativeSessionId ||
    session.spawnedBy === "subagent" ||
    session.spawnedBy === "fork"
  );
}

/**
 * Idempotently materialize the old session-shaped product state.
 *
 * Child sessions receive an execution attachment to their parent's
 * conversation. They never become participants and never become primary.
 */
export function migrateLegacyConversations(input: {
  sessions: readonly LegacySession[];
  bots: readonly LegacyBot[];
  roster?: readonly RosterUser[];
  now?: number;
}): Conversation[] {
  const now = input.now ?? Date.now();
  const roster = input.roster ?? [];
  const rows = readStore();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const sessionToConversation = new Map<string, string>();
  let changed = false;

  const ensure = (conversation: Conversation): Conversation => {
    const existing = byId.get(conversation.id);
    if (existing) return existing;
    rows.push(conversation);
    byId.set(conversation.id, conversation);
    changed = true;
    return conversation;
  };

  for (const bot of input.bots) {
    const primary = input.sessions.find(
      (session) => !delegated(session) && session.botId === bot.id && !!session.sessionId,
    );
    const savedId = bot.sessionId?.trim();
    const savedSession = savedId
      ? input.sessions.find((session) => session.sessionId === savedId)
      : undefined;
    // A saved bot session id is a compatibility pointer, not product identity.
    // If it resolves to another product row, verified bot ownership wins. This
    // mirrors the hardened legacy routing boundary.
    const trustedSavedId = savedId && (!savedSession || (!delegated(savedSession) && savedSession.botId === bot.id))
      ? savedId
      : undefined;
    const id = trustedSavedId || primary?.sessionId?.trim();
    if (!id) continue;
    const createdAt = primary?.startedAt ?? now;
    const participants = [botParticipant(bot, createdAt)];
    const human = rosterParticipant(primary?.assignedUser || bot.owner || "", roster, createdAt);
    if (human) participants.unshift(human);
    const conversation = ensure({
      id,
      title: bot.name,
      participants,
      runtimeSessions: [],
      createdAt,
      updatedAt: now,
      legacy: { source: "bot_session", botId: bot.id, sessionId: id },
    });
    for (const participant of participants) {
      if (conversation.participants.some((row) => row.id === participant.id)) continue;
      conversation.participants.push(participant);
      conversation.updatedAt = now;
      changed = true;
    }
    for (const session of input.sessions.filter((row) => row.botId === bot.id && row.sessionId)) {
      const sessionId = session.sessionId!;
      sessionToConversation.set(sessionId, conversation.id);
      if (!conversation.runtimeSessions.some((entry) => entry.sessionId === sessionId)) {
        conversation.runtimeSessions.push({
          sessionId,
          participantId: botParticipantId(bot.id),
          kind: delegated(session) ? "execution" : "primary",
          attachedAt: session.startedAt ?? now,
        });
        conversation.updatedAt = now;
        changed = true;
      }
    }
  }

  // New runtimes can already carry the durable id even while legacy botId
  // remains in circulation. Rotation uses this path when it gives a bot a new
  // runtime session id under the same conversation.
  for (const session of input.sessions) {
    const sessionId = session.sessionId?.trim();
    const conversationId = session.conversationId?.trim();
    const conversation = conversationId ? byId.get(conversationId) : undefined;
    if (!sessionId || !conversation) continue;
    sessionToConversation.set(sessionId, conversationId!);
    if (conversation.runtimeSessions.some((entry) => entry.sessionId === sessionId)) continue;
    const botId = session.botId ? botParticipantId(session.botId) : null;
    conversation.runtimeSessions.push({
      sessionId,
      participantId: conversation.participants.some((row) => row.id === botId) ? botId : null,
      kind: delegated(session) ? "execution" : "primary",
      attachedAt: session.startedAt ?? now,
    });
    conversation.updatedAt = now;
    changed = true;
  }

  for (const session of input.sessions) {
    const sessionId = session.sessionId?.trim();
    if (!sessionId || sessionToConversation.has(sessionId) || delegated(session)) continue;
    const createdAt = session.startedAt ?? now;
    const human = rosterParticipant(session.assignedUser || "", roster, createdAt);
    const conversation = ensure({
      id: sessionId,
      title: session.title ?? null,
      participants: human ? [human] : [],
      runtimeSessions: [{ sessionId, participantId: human?.id, kind: "primary", attachedAt: createdAt }],
      createdAt,
      updatedAt: now,
      legacy: { source: "regular_session", sessionId },
    });
    if (human && !conversation.participants.some((row) => row.id === human.id)) {
      conversation.participants.push(human);
      conversation.updatedAt = now;
      changed = true;
    }
    sessionToConversation.set(sessionId, conversation.id);
  }

  // Attach children only after all primary mappings exist.
  for (const session of input.sessions.filter(delegated)) {
    const sessionId = session.sessionId?.trim();
    const parentId = session.parentSessionId ?? session.parentNativeSessionId;
    const conversationId = parentId ? sessionToConversation.get(parentId) : undefined;
    const conversation = conversationId ? byId.get(conversationId) : undefined;
    if (!sessionId || !conversation) continue;
    sessionToConversation.set(sessionId, conversation.id);
    if (conversation.runtimeSessions.some((entry) => entry.sessionId === sessionId)) continue;
    const parentAttachment = conversation.runtimeSessions.find((entry) => entry.sessionId === parentId);
    conversation.runtimeSessions.push({
      sessionId,
      participantId: parentAttachment?.participantId,
      kind: "execution",
      attachedAt: session.startedAt ?? now,
    });
    conversation.updatedAt = now;
    changed = true;
  }

  if (changed) writeStore(rows);
  return rows;
}

export function conversationForSession(sessionId: string): Conversation | null {
  return readStore().find((conversation) =>
    conversation.runtimeSessions.some((entry) => entry.sessionId === sessionId),
  ) ?? null;
}

export function attachRuntimeSession(input: {
  conversationId: string;
  sessionId: string;
  participantId?: string | null;
  kind: "primary" | "execution";
  attachedAt?: number;
}): Conversation | null {
  const rows = readStore();
  const conversation = rows.find((row) => row.id === input.conversationId);
  if (!conversation) return null;
  const existing = conversation.runtimeSessions.find((entry) => entry.sessionId === input.sessionId);
  if (existing) {
    existing.participantId = input.participantId ?? existing.participantId;
    existing.kind = input.kind;
    existing.detachedAt = null;
  } else {
    conversation.runtimeSessions.push({
      sessionId: input.sessionId,
      participantId: input.participantId,
      kind: input.kind,
      attachedAt: input.attachedAt ?? Date.now(),
    });
  }
  conversation.updatedAt = Date.now();
  writeStore(rows);
  return conversation;
}

export function upsertConversationParticipant(
  conversationId: string,
  participant: ConversationParticipant,
): Conversation | null {
  const rows = readStore();
  const conversation = rows.find((row) => row.id === conversationId);
  if (!conversation) return null;
  const index = conversation.participants.findIndex((row) => row.id === participant.id);
  if (index >= 0) conversation.participants[index] = participant;
  else conversation.participants.push(participant);
  conversation.updatedAt = Date.now();
  writeStore(rows);
  return conversation;
}

export function leaveConversationParticipant(
  conversationId: string,
  participantId: string,
  leftAt = Date.now(),
): Conversation | null {
  const conversation = getConversation(conversationId);
  const participant = conversation?.participants.find((row) => row.id === participantId);
  if (!conversation || !participant) return null;
  return upsertConversationParticipant(conversationId, { ...participant, leftAt });
}

export function canReadConversation(
  conversation: Conversation,
  participantId: string,
  messageTs?: number | null,
): boolean {
  const participant = conversation.participants.find((row) => row.id === participantId);
  if (!participant) return false;
  if (participant.leftAt && (!messageTs || messageTs > participant.leftAt)) return false;
  if (messageTs && participant.historyAccess === "from_join" && messageTs < participant.joinedAt) return false;
  return true;
}

export function canWriteConversation(conversation: Conversation, participantId: string): boolean {
  const participant = conversation.participants.find((row) => row.id === participantId);
  return !!participant && !participant.leftAt && participant.role !== "observer";
}

export function canManageConversation(conversation: Conversation, participantId: string): boolean {
  const participant = conversation.participants.find((row) => row.id === participantId);
  return !!participant && !participant.leftAt && participant.role === "owner";
}

export function messageAuthorForSession(
  sessionId: string,
  message: { role: string; text: string },
): MessageAuthorRef {
  const conversation = conversationForSession(sessionId);
  if (!conversation) return UNKNOWN_LEGACY_AUTHOR;
  if (message.role === "user") {
    const digest = botAuthorIdFromText(message.text);
    const participantId = digest ? `human:${digest}` : "";
    // The server-authored marker is the verification boundary. The roster can
    // be updated a few milliseconds later on a first-message cold launch, but
    // that does not make the durable author reference less true.
    return participantId
      ? { kind: "human", participantId, verified: true }
      : UNKNOWN_LEGACY_AUTHOR;
  }
  if (message.role === "assistant") {
    const attachment = conversation.runtimeSessions.find((row) => row.sessionId === sessionId);
    const participant = attachment?.participantId
      ? conversation.participants.find((row) => row.id === attachment.participantId)
      : undefined;
    if (participant?.kind === "bot") {
      return { kind: "bot", participantId: participant.id, verified: true };
    }
  }
  return UNKNOWN_LEGACY_AUTHOR;
}

export function resetConversationsForTests(): void {
  // The store has no process cache. This exported no-op documents that tests
  // can move PATHS.data safely between cases, like the other local stores.
}
