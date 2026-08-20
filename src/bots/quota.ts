import { computerAgentAdmissionContext, type AgentAdmissionContext } from "../agent-admission.ts";
import type { Bot } from "./store.ts";

/** Default stored-bot allowance for one verified owner. */
export const DEFAULT_PERSISTENT_BOT_LIMIT = 20;
export const PERSISTENT_BOT_LIMIT_ENV = "LFG_PERSISTENT_BOT_LIMIT";
const MAX_CONFIGURED_PERSISTENT_BOT_LIMIT = 10_000;

export type PersistentBotQuotaSource = "default" | "config" | "host_entitlement" | "legacy";
export type PersistentBotQuotaScope = "owner" | "legacy_pool";

/** Additive API payload. Nullable limits mean the ownerless legacy pool is grandfathered. */
export type PersistentBotQuota = {
  used: number;
  limit: number | null;
  remaining: number | null;
  scope: PersistentBotQuotaScope;
  source: PersistentBotQuotaSource;
};

export type PersistentBotQuotaPolicy = {
  limit: number;
  source: Exclude<PersistentBotQuotaSource, "legacy">;
};

function configuredLimit(raw: string | null | undefined): number | null {
  if (!raw?.trim()) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return null;
  return Math.min(value, MAX_CONFIGURED_PERSISTENT_BOT_LIMIT);
}

/**
 * Resolve policy only from server-owned inputs.
 *
 * The root-written Computer entitlement wins when it carries the additive
 * persistentBotLimit field. Older entitlements carry only live-agent and
 * schedule limits, so they fall through to the administrator environment
 * override and then the explicit product default. Plan names never imply a
 * number here.
 */
export function persistentBotQuotaPolicy(options: {
  entitlement?: AgentAdmissionContext | null;
  configuredLimit?: string | null;
} = {}): PersistentBotQuotaPolicy {
  const entitlement = Object.hasOwn(options, "entitlement")
    ? options.entitlement ?? null
    : computerAgentAdmissionContext();
  if (entitlement?.persistentBotLimit) {
    return { limit: entitlement.persistentBotLimit, source: "host_entitlement" };
  }
  const local = configuredLimit(
    Object.hasOwn(options, "configuredLimit")
      ? options.configuredLimit
      : process.env[PERSISTENT_BOT_LIMIT_ENV],
  );
  if (local !== null) return { limit: local, source: "config" };
  return { limit: DEFAULT_PERSISTENT_BOT_LIMIT, source: "default" };
}

function normalizedOwner(owner: string | null | undefined): string | null {
  return owner?.trim().toLowerCase() || null;
}

/**
 * Count stored records, not running processes. Disabled and idle bots count.
 * Ownerless legacy records stay in a separate grandfathered pool. They never
 * consume a verified person's allowance and are never guessed onto an owner.
 */
export function persistentBotQuota(
  bots: readonly Bot[],
  owner: string | null | undefined,
  policy: PersistentBotQuotaPolicy = persistentBotQuotaPolicy(),
): PersistentBotQuota {
  const key = normalizedOwner(owner);
  if (!key) {
    return {
      used: bots.filter((bot) => !normalizedOwner(bot.owner)).length,
      limit: null,
      remaining: null,
      scope: "legacy_pool",
      source: "legacy",
    };
  }
  const used = bots.filter((bot) => normalizedOwner(bot.owner) === key).length;
  return {
    used,
    limit: policy.limit,
    remaining: Math.max(0, policy.limit - used),
    scope: "owner",
    source: policy.source,
  };
}

export class BotOwnerQuotaError extends Error {
  constructor(readonly owner: string, readonly quota: PersistentBotQuota) {
    super(
      `Persistent bot limit reached: ${quota.used} of ${quota.limit} stored bots are in use. ` +
      "Delete a bot before creating another.",
    );
    this.name = "BotOwnerQuotaError";
  }
}

export type BotQuotaLimitPayload = {
  error: string;
  code: "bot_quota_limit";
  quota: PersistentBotQuota;
};

export function botQuotaLimitPayload(error: BotOwnerQuotaError): BotQuotaLimitPayload {
  return { error: error.message, code: "bot_quota_limit", quota: error.quota };
}
