import { mkdir, open, readdir, realpath, stat } from "node:fs/promises";
import { appendFileSync, existsSync, statfsSync, statSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir, homedir, loadavg, cpus, totalmem, freemem } from "node:os";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { marked } from "marked";
import {
  AgentAdmissionController,
  NO_AGENT_LIMIT,
  agentLaunchMemoryBudget,
  computerAgentAdmissionContext,
} from "../agent-admission.ts";
import { PATHS, appVersion, installInfo } from "../config.ts";
import { claudeOauthToken as sharedClaudeOauthToken } from "../claude-creds.ts";
import {
  applyReleaseUpdate,
  applySourceUpdate,
  changelogDelta,
  releaseUpdateStatus,
  scheduleRestart,
  sourceUpdateStatus,
} from "../self-update.ts";
import { compressedAssetResponse, maybeCompressResponse } from "../http-compress.ts";
import { serveOmgMcpRequest } from "../mcp-http.ts";
import * as pwaBootLog from "../pwa-boot-log.ts";
import { botRuntimeContract, shortSessionId } from "../omg-capabilities.ts";
import {
  getCachedResumableSession,
  updateResumableUser,
  upsertResumableRows,
  type ResumableCacheRow,
} from "../resume-cache.ts";
import {
  AGENTS_DIR,
  listAgents,
  loadAgent,
  writeAgent,
} from "../agents/registry.ts";
import {
  parseActions,
  readActionsSidecar,
  reportPathFor,
  runAgent,
  type ActionRow,
} from "../agents/runner.ts";
import { executeAction, executeActionsCombined, dispatchSendFixAgent } from "../actions/index.ts";
import {
  listAutoAgents,
  getAutoAgent,
  saveAutoAgent,
  deleteAutoAgent,
  deleteAutoAgentsOwnedByBot,
  countAutoAgentsOwnedByBot,
  isRunning,
  listFindings,
  updateFinding,
  logFindingAction,
  type AutoAgent,
  type AutoAgentOwner,
  type FindingActionPath,
} from "../auto/store.ts";
import { runAutoAgent } from "../auto/runner.ts";
import { routineNudgeText, exceedsMaxFrequency } from "../auto/bot-routine.ts";
import {
  BOT_COLORWAYS,
  BOT_SHAPES,
  BotOwnerQuotaError,
  createBot,
  deleteBot,
  getBot,
  listBots,
  mutateBot,
  updateBot,
  type Bot,
  type BotColorway,
  type BotShape,
} from "../bots/store.ts";
import {
  botQuotaLimitPayload,
  persistentBotQuota,
  persistentBotQuotaPolicy,
} from "../bots/quota.ts";
import { botCanonicalSessionId, botConversationRef, findBotMainSession } from "../bots/session.ts";
import { botVisibleUserText } from "../bots/transcript.ts";
import {
  CHECKPOINT_MAX_TURNS,
  MAX_BOT_COMPACTION_THRESHOLD_PERCENT,
  MIN_BOT_COMPACTION_THRESHOLD_PERCENT,
  appendArchivedSession,
  botCompactionDecision,
  botAppliedConfigRevision,
  botConfigRevision,
  botConfigStatus,
  botHasPendingConfig,
  botRotationAdmission,
  buildHandoffCheckpoint,
  checkpointIsEmpty,
  defaultBotCompactionSettings,
  extractCheckpointSections,
  formatHandoffCheckpoint,
  migrateLegacyBotRotationState,
  nextBotConfigRevision,
  queueBlocksBotRotation,
  rotationCompareAndSwap,
  rotationNoticeText,
  runtimeRotationCompareAndSwap,
  sessionBoundConfigChanged,
  sessionBoundConfigOf,
  type BotHandoffCheckpoint,
  type BotRotationBlock,
  type BotRotationReason,
  type CheckpointTurn,
} from "../bots/rotation.ts";
import {
  BOT_SELF_CREATE_FIELDS,
  BOT_SELF_UPDATE_FIELDS,
  BotSelfManagementError,
  botPatchRequiresRuntimeRefresh,
  ownedBotPeers,
  readDeclaredCapabilities,
  resolveBotRuntimeActor,
  unknownBotFields,
} from "../bots/self-management.ts";
import {
  BotPeerMessageError,
  formatBotPeerMessage,
  markBotPeerMessageEnqueued,
  releaseBotPeerMessage,
  reserveBotPeerMessage,
} from "../bots/messaging.ts";
import {
  botReadUser,
  conversationUnread,
  ensureBotConversationReadBaseline,
  markBotConversationRead,
} from "../bots/unread.ts";
import {
  assertBotConversationAccess,
  botCreationOwner,
  botViewerFromRequest,
  localUserSplitEnabled,
  // Aliased: the route already binds `visibleBots` to its own result.
  visibleBots as visibleBotsForViewer,
} from "../bots/access.ts";
import {
  botAuthorEmailFromText,
  formatBotAttribution,
  resolveBotMessageAuthor,
} from "../bots/authorship.ts";
import {
  attachRuntimeSession,
  botParticipantId,
  canManageConversation,
  canReadConversation,
  conversationBotParticipant,
  conversationHumanParticipantId,
  detachRuntimeSession,
  ensureBotConversation,
  ensureConversationHuman,
  getConversation,
  leaveConversationParticipant,
  listConversations,
  replaceConversationPrimaryRuntime,
  upsertConversationParticipant,
  viewerConversationParticipantId,
} from "../conversations.ts";
import { startAutoScheduler, setBotRoutineDelivery } from "../auto/scheduler.ts";
import { handleWakeTick } from "../auto/wake-tick.ts";
import { pushWakeHooksNow, setWakeHooksBootId } from "../auto/wake-hooks-push.ts";
import {
  getMetricsHistory,
  readAllPressure,
  startMetricsSampler,
  type MetricSample,
} from "../metrics.ts";
import {
  computeSessionDiff,
  computeSessionDiffStat,
  computeSessionDiffSummary,
  computeSessionFilePatch,
} from "../session-diff.ts";
import { listSessionTree, readSessionFile } from "../session-files.ts";
import { reportClientError, listClientErrors } from "../client-errors.ts";
import { getAllUsage, getProviderUsage, listUsageProviders } from "../usage.ts";
import { sessionTokenUsage } from "../session-token-usage.ts";
import {
  vapidPublicKey,
  saveSubscription,
  removeSubscription,
  subscriptionUser,
  takePushNotification,
  notifyAll,
  type PushSubscription,
} from "../push.ts";
import {
  listQuestions,
  getQuestion,
  addQuestion,
  answerQuestion,
  dismissQuestion,
  markHandled,
  waitForAnswer,
  sweepExpiredQuestions,
  formatPushbackAnswerText,
  questionVisibleToUser,
} from "../ask/store.ts";
import {
  listSessions,
  managedLaunchRow,
  readTitleOverrides,
  resolveTranscript,
  setSessionTitle,
  sessionIdForPid,
  pendingToolPrompt,
  listResumable,
  findSessions,
  queryResumable,
  refreshResumableCache,
  cwdForTranscript,
  cwdForCodexTranscript,
  findCodexTranscriptById,
  deferToolUseArgs,
  visibleTranscriptMessages,
  type PendingPrompt,
  type Session,
  type SessionMsg,
} from "../sessions.ts";
import { countTranscriptRows } from "../transcript-rows.ts";
import {
  invalidateListSessionsCache,
  listSessionsCached,
  noteListSessionsClientActivity,
} from "../session-cache.ts";
import { buildSessionUsageReport, findSessionDevServerPids } from "../session-usage.ts";
import { memoryReclaimCandidates } from "../idle-archive.ts";
import { CODING_AGENT_ADAPTERS, resolveActiveSessionAgent, usesCommandFileRuntime } from "../coding-agent-adapters.ts";
import { launchCodingAgentSession } from "../coding-agent-provider.ts";
import {
  enqueueTranscriptIndex,
  indexedMessagePage,
  indexedMessageRowPage,
  indexedToolUseArgs,
  indexArtifactMessage,
  indexedArtifactPlacement,
  indexTranscript,
  lastIndexedAssistantMessage,
  latestIndexedAssistantCursor,
  prepareFileHistoryForResume,
  removeIndexedArtifact,
  sessionHasIndexedMessages,
  sessionIndexKey,
  searchTranscriptIndex,
  subscribeIndexedArtifactMessages,
} from "../transcript-index.ts";
import {
  ensureChatTranscriptCaughtUp,
  startChatIngestMonitor,
  subscribeChatTranscript,
  warmChatTranscripts,
} from "../chat-ingest.ts";
import { traceLog, traceLogPathForToday } from "../trace-log.ts";
import {
  capturePane,
  parsePrompt,
  type PanePrompt,
  answerPrompt,
  dismissPrompt,
  tmuxInterrupt,
  tmuxKillPane,
  tmuxKillSession,
  closeAgentBrowserSession,
  relaunchSessionWithModel,
  spawnManagedGrokSession,
  spawnManagedCursorSession,
  relaunchCursorSessionWithModel,
  spawnManagedAisdkSession,
  spawnManagedCodexAisdkSession,
  spawnManagedOpencodeAisdkSession,
  spawnManagedPiSession,
  spawnManagedCopilotSession,
  spawnManagedJcodeSession,
  dismissCursorTrustPrompt,
  dismissResumeSummaryGate,
  panePidForSession,
  tmuxHasSession,
  isBusy,
  isJcodeBusy,
} from "../tmux.ts";
import {
  addManaged,
  getManagedSessionCreation,
  listManaged,
  patchManaged,
  removeManaged,
  type ManagedSession,
} from "../managed.ts";
import { reconcileCommandFileSessions } from "../session-recovery.ts";
import { resolveResumeModel } from "../resume-model.ts";
import { PtyBridge, termSessionName } from "../pty.ts";
import { capturePaneScroll, capturePaneEscaped, paneWidth } from "../tmux.ts";
import { detectUrls } from "../links.ts";
import type { ServerWebSocket } from "bun";
import {
  createLiveWsSupport,
  isLiveWsEnabled,
  liveTransportMode,
  type LiveWsSocketData,
} from "../live-ws.ts";
import { appendCmd as appendAisdkCmd, removeEntry as removeAisdkEntry, readEntry as readAisdkEntry, findEntryByAnyId as findAisdkEntryByAnyId, isEntryBusy as isAisdkEntryBusy, isPidAlive as isAisdkPidAlive, patchEntry as patchAisdkEntry, terminateHarnessProcess, waitForHarnessExit, wakeHarnessCommandReader } from "../aisdk-registry.ts";
import { markClosed } from "../closing.ts";
import {
  assignUser,
  gravatar,
  iconIdentityKey,
  resolveSessionUserTag,
  rosterBoxAccount,
  rosterEmails,
  userAssignments,
  userRoster,
} from "../users.ts";
import {
  addOnboardingProfile,
  getOnboarding,
  patchOnboarding,
  setProfileAvatar,
  type HostedFirstRun,
  type OnboardingSteps,
} from "../onboarding.ts";
import {
  AVATARS_DIR,
  AVATAR_MIME_BY_EXT,
  iconUrl,
  removeUserIcon,
  setUserIcon,
  userIconsSync,
} from "../user-icons.ts";
import {
  listCustomRepos,
  listHiddenRepos,
  addCustomRepo,
  removeCustomRepo,
  unhideRepo,
  unlinkRepo,
  cloneRepo,
  createProjectFolder,
  useProjectFolder,
} from "../repos-store.ts";
import { projectName, reposRoot } from "../projects.ts";
import { listConfiguredRepos } from "../repo-list.ts";
import { runExecCommand, clampExecTimeout, MAX_EXEC_TIMEOUT_MS } from "../exec.ts";
import {
  cwdIsWithin,
  repoContainingCwd,
  repoForParentSession,
  repoForRequestedSessionCwd,
  resolveInputCwd,
} from "../repo-resolve.ts";
import { WORKTREE_ROOT, resolveSessionCwd, startWorktreeSweep } from "../worktree.ts";
import { ensureDiskBackedTmpdir, startTmpSweep } from "../tmp-reclaim.ts";
import {
  FolderDeleteError,
  deleteFolder,
  isDirEmpty,
  planFolderDelete,
} from "../folder-delete.ts";
import { ensureConversationVisibleFrom } from "../claude-conversation.ts";
import {
  transcribeStt,
  getVoiceSettings,
  setVoiceSettings,
  saveVoiceProviderKey,
  listProviders,
  voiceSetupInfo,
  sttStreamingAvailable,
  openSttStream,
  type VoiceSettings,
  type SttStreamBridge,
} from "../voice-providers.ts";
import {
  isCodingAgentKind,
  listCodingAgents,
  listSetupChecks,
  cancelCodingAgentAuth,
  getCodingAgentAuth,
  getCodingAgentSetupLog,
  loginCommandFor,
  pendingCodingAgentLogins,
  registerClaudeMcpForAccount,
  runCodingAgentSetup,
  runCodingAgentSetups,
  runSetupAction,
  setCodingAgentVisibility,
  startCodingAgentAuth,
  startToolAuth,
  submitCodingAgentAuthCode,
} from "../coding-agents.ts";
import {
  deletePiCredential,
  isPiAuthProviderId,
  setPiProviderApiKey,
} from "../pi-auth.ts";
import {
  deleteOpencodeCredential,
  isOpencodeAuthProviderId,
  setOpencodeProviderApiKey,
} from "../opencode-auth.ts";
import { deleteJcodeCredential, isJcodeAuthProviderId } from "../jcode-auth.ts";
import { listToolConnections } from "../tool-connections.ts";
import {
  bindClaudeSessionAccount,
  claudeAccountIdForSession,
  createClaudeAccount,
  listClaudeAccounts,
  pickClaudeAccountForNewSession,
  removeClaudeAccount,
  resolveClaudeAccount,
} from "../claude-accounts.ts";
import {
  AUTO_AGENT_BACKENDS,
  defaultModelForAgent,
  listModelCatalog,
  modelsForAgent,
  resolveModelForAgent,
  thinkingLevelsForAgent,
} from "../agent-catalog.ts";
import {
  readModelDiscoveryCacheSync,
  refreshModelCatalog,
  startModelDiscoveryScheduler,
} from "../model-discovery.ts";
import {
  BOT_SCHEDULE_LIMIT,
  DEFAULT_TIME_ZONE,
  getGlobalSettings,
  getGlobalSettingsSync,
  MAX_LIVE_AGENTS_LIMIT,
  setGlobalSettings,
  validTimeZone,
  validTranscriptView,
  type GlobalSettings,
} from "../settings.ts";
import { listSkillCatalog, searchSkillCatalog, withoutSkillKeywords } from "../skills-catalog.ts";
import {
  collapseArtifactRetryMessages,
  createImageArtifact,
  createVideoArtifact,
  deleteArtifact,
  getImageArtifact,
  hydrateImageArtifactMessage,
  imageArtifactToMessage,
  listAllArtifacts,
  listImageArtifacts,
  publishHtmlArtifact,
  type ImageArtifact,
  type ImageArtifactMessage,
} from "../artifacts.ts";
import {
  createOriginDelivery,
  indexOriginDeliveryMedia,
  listOriginDeliveries,
  type OriginDeliveryMedia,
} from "../origin-deliveries.ts";
import { deleteImagePreview, getOrCreateImagePreview } from "../artifact-previews.ts";
import { resolveUploadRequest, uploadsDir } from "../uploads.ts";
import { addShipPost, listShipPosts, resolveShipProject } from "../shipped.ts";
import { verifySelfRepoLanding } from "../session-landing.ts";
import { collectShipProvenance, shipBlockReason } from "../ship-provenance.ts";
import {
  artifactRefreshManager,
  prepareArtifactRefreshConfig,
  startArtifactRefreshScheduler,
  type ArtifactRefreshChanges,
} from "../artifact-refresh.ts";

// Where the user keeps the repos lfg can launch agents into. Scanned for git
// repos at runtime; defaults to ~/repos. The lfg repo itself (PATHS.root) is
// always offered as a target since it is present and trusted.
const REPOS_ROOT = reposRoot();
const SELF_REPO = PATHS.root;
const EVLOG_DIR = join(PATHS.data, "evlogs");
const SERVER_INSTANCE_ID = randomBytes(8).toString("hex");
let selfUpdateRunning = false;

// Everything that can start, stop, or rebind one bot's backing session shares a
// single critical section per bot.
//
// It began as peer-delivery-only: two offline sends could otherwise launch
// duplicate backing sessions and scramble enqueue order. Rotation joins the
// same lock rather than taking its own, because a separate lock would not be a
// lock at all — a rotation tearing a session down while a peer delivery is
// bringing one up interleaves two writers on `bot.sessionId`, and the loser's
// write silently wins. One queue per bot makes "which session is this bot's"
// answerable at every instant.
const botWorkTails = new Map<string, Promise<void>>();

async function serializeBotWork<T>(botId: string, task: () => Promise<T>): Promise<T> {
  const previous = botWorkTails.get(botId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  botWorkTails.set(botId, current);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (botWorkTails.get(botId) === current) botWorkTails.delete(botId);
  }
}

function evlog(event: string, fields: Record<string, unknown> = {}) {
  traceLog(event, fields);
  try {
    mkdirSync(EVLOG_DIR, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    appendFileSync(
      join(EVLOG_DIR, `${day}.jsonl`),
      `${JSON.stringify({
        ts: new Date().toISOString(),
        monoMs: Math.round(performance.now() * 1000) / 1000,
        event,
        ...fields,
      })}\n`,
    );
  } catch {
    // Diagnostics must never affect the app path being measured.
  }
}

const BOOT_API_TIMING_ENDPOINTS = new Set([
  "/api/bootstrap",
  "/api/sessions",
  "/api/skills",
  "/api/agents",
  "/api/repos",
  "/api/users",
  "/api/checks",
  "/api/setup/checks",
  "/api/coding-agents",
  "/api/findings",
  "/api/auto/findings",
  "/api/notes",
  "/api/config",
]);

function apiDurationMs(start: number): number {
  return Math.round((performance.now() - start) * 1000) / 1000;
}

function uploadExt(contentType: string, filename: string): string {
  const fromName = extname(filename).toLowerCase().replace(/^\./, "");
  if (/^[a-z0-9]{1,12}$/.test(fromName)) return fromName;
  const ct = contentType.toLowerCase();
  if (ct.includes("png")) return "png";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  if (ct.includes("pdf")) return "pdf";
  if (ct.includes("markdown")) return "md";
  if (ct.includes("json")) return "json";
  if (ct.includes("html")) return "html";
  if (ct.includes("text")) return "txt";
  return "bin";
}

function uploadStem(filename: string): string {
  const leaf = filename.split(/[\\/]/).pop() || "";
  const stem = leaf.replace(/\.[^.]*$/, "").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return stem.slice(0, 48) || "upload";
}

async function persistUpload(req: Request, filename: string, prefix = "upload"): Promise<{ path: string; name: string }> {
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  const ext = uploadExt(ct, filename);
  const buf = new Uint8Array(await req.arrayBuffer());
  if (!buf.length) throw new Error("empty upload");
  const dir = uploadsDir();
  mkdirSync(dir, { recursive: true });
  const safePrefix = prefix.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "upload";
  const name = `${safePrefix}-${Date.now()}-${randomBytes(3).toString("hex")}-${uploadStem(filename)}.${ext}`;
  const fp = join(dir, name);
  await Bun.write(fp, buf);
  return { path: fp, name: filename || name };
}

async function persistUploadChunk(
  req: Request,
  filename: string,
  prefix: string,
  uploadId: string,
  offset: number,
  total: number,
): Promise<{ path?: string; name: string; complete: boolean }> {
  if (!/^[0-9a-f-]{36}$/i.test(uploadId)) throw new Error("invalid upload id");
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("invalid upload offset");
  if (!Number.isSafeInteger(total) || total <= 0 || offset >= total) throw new Error("invalid upload size");

  const ct = (req.headers.get("content-type") || "").toLowerCase();
  const ext = uploadExt(ct, filename);
  const buf = new Uint8Array(await req.arrayBuffer());
  if (!buf.length) throw new Error("empty upload chunk");
  if (offset + buf.length > total) throw new Error("upload chunk exceeds file size");

  const dir = uploadsDir();
  mkdirSync(dir, { recursive: true });
  const safePrefix = prefix.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "upload";
  const name = `${safePrefix}-${uploadId}-${uploadStem(filename)}.${ext}`;
  const fp = join(dir, name);

  // The browser sends a file's chunks in order. Writing at an explicit offset
  // makes a repeated request safe if the connection drops after the server
  // persisted a chunk but before the browser received its response.
  if (offset > 0) {
    const current = await stat(fp).catch(() => null);
    if (!current || current.size < offset) throw new Error("upload chunk arrived out of order");
  }
  const handle = await open(fp, offset === 0 ? "w" : "r+");
  try {
    await handle.write(buf, 0, buf.length, offset);
    const complete = offset + buf.length === total;
    if (complete) await handle.truncate(total);
    return { ...(complete ? { path: fp } : {}), name: filename || name, complete };
  } finally {
    await handle.close();
  }
}

function uploadFilename(req: Request, url: URL): string {
  const rawName = url.searchParams.get("filename") || req.headers.get("x-file-name") || "";
  try {
    return decodeURIComponent(rawName);
  } catch {
    return rawName;
  }
}

function uploadChunkParams(url: URL): { uploadId: string; offset: number; total: number } | null {
  const uploadId = url.searchParams.get("uploadId");
  if (!uploadId) return null;
  return {
    uploadId,
    offset: Number(url.searchParams.get("offset")),
    total: Number(url.searchParams.get("total")),
  };
}

// Resolved per call, not pinned to a literal. Model discovery refreshes on a
// cron, so a boot-time constant freezes the default at whatever the catalog knew
// at startup and keeps serving it long after a newer Grok appears — and a pinned
// id also strands boxes whose grok CLI does not have that exact model.
const GROK_DEFAULT_MODEL = () => defaultModelForAgent("grok");
const PI_DEFAULT_MODEL = "sonnet";
// Models whose provider currently rejects our requests (Sakana's fugu returns a
// hard 403 Forbidden, and the local Novita credential currently 403s too — see
// opencode.log). A session born onto one of these streams zero output and
// silently goes idle, so redirect create + model-switch away from them to the
// catalog-owned anonymous OpenCode default instead of letting the turn die.
const OPENCODE_DISABLED_MODELS = new Set<string>([
  "fugu/fugu",
  "fugu/fugu-ultra",
  "fugu",
  "fugu-ultra",
  "novita-ai/deepseek/deepseek-v4-pro",
  "novita-ai/zai-org/glm-5.2",
  "novita-ai/zai-org/glm-5.1",
]);
import {
  enqueueMessage,
  listQueue,
  retryMessage,
  clearResolved,
  reconcileQueued,
  getMessage,
  recordCommandFileMessage,
  resumePersistedQueues,
  takeUndeliveredQueue,
} from "../sendq.ts";
import { startFleetWatcher } from "../voice-bus.ts";
import { startSessionPushBridge } from "../session-push.ts";

const PORT = Number(process.env.LFG_PORT ?? process.env.PORT ?? 8766);

/** Ceiling on any single request body. See the Bun.serve options for why. */
const MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024;

/** Root URL this box's web UI is reachable at (e.g. `http://box.tailnet.ts.net:8766`
 * over Tailscale). Optional — when unset, no session URLs are advertised and
 * external surfaces simply omit their "open session" affordance. */
const PUBLIC_URL = (process.env.LFG_PUBLIC_URL ?? "").trim().replace(/\/$/, "");

/** Absolute web-UI deep link for a session (`/?session=<id>` — consumed by the
 * web app's deep-link effect), or null when LFG_PUBLIC_URL is not configured. */
function publicSessionUrl(sessionId: string): string | null {
  if (!PUBLIC_URL || !sessionId) return null;
  return `${PUBLIC_URL}/?session=${encodeURIComponent(sessionId)}`;
}
// Bind to loopback by default — the UI is meant to be reached over Tailscale
// (via `tailscale serve`), never the public internet. Override LFG_HOST only
// if you understand the exposure.
const HOST = process.env.LFG_HOST ?? "127.0.0.1";
const MAX_LFG_SUBAGENT_DEPTH = 4;
const agentAdmission = new AgentAdmissionController();

/**
 * What the box could hand a new agent, and whether that number can be believed.
 *
 * `trusted` separates Linux's MemAvailable — an estimate of what is reclaimable,
 * cache included — from `freemem()`, which counts only wholly untouched pages.
 * On macOS the two are nowhere near each other: a healthy 16 GB Mac reports a
 * few hundred MB free while holding many GB as reclaimable cache. Refusing work
 * on that number would be refusing on a measurement, not on a shortage, so
 * callers that would BLOCK on it must check `trusted` first.
 */
function hostAvailableMemory(): { bytes: number; trusted: boolean } {
  try {
    const match = readFileSync("/proc/meminfo", "utf8").match(/^MemAvailable:\s+(\d+)\s+kB$/m);
    if (match) return { bytes: Number(match[1]) * 1024, trusted: true };
  } catch {
    // Non-Linux standalone installs fall back to Node's portable reading.
  }
  return { bytes: freemem(), trusted: false };
}

function hostAvailableMemoryBytes(): number {
  return hostAvailableMemory().bytes;
}

function formatMemory(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

// Admission gate for activating a NEW agent (create / cold resume / fork).
// Cloud Computers use the trusted bootstrap plan and cannot be overridden by a
// dashboard setting. Ordinary LFG installs retain their local setting cap.
// The returned reservation is held until the managed launching row exists, so
// concurrent requests cannot both pass an async list read and oversubscribe.
//
// `overLimit` is the self-hosted escape hatch. On your own hardware the cap is
// a preference, not a purchase: the honest answer to "24 of 24 live" is to let
// the owner start the agent anyway, not to make them go and edit a number
// first. It is refused on a Computer, where the cap IS the plan — and even
// when granted, the memory budget below still has to clear, so an override
// can oversubscribe the setting but never the machine.
async function activationGate(
  options?: { overLimit?: boolean; kind?: "interactive" | "schedule" | "bot" },
): Promise<Response | { release: () => void; reclaimed?: number }> {
  const settings = getGlobalSettingsSync();
  const computer = computerAgentAdmissionContext();
  // Schedule admission is a Computer-plan rule. A self-hosted box has no plan
  // file, so spawnedBy=schedule is just another session under maxLiveAgents.
  const kind = computer && options?.kind === "schedule" ? "schedule" : "interactive";
  const limit =
    kind === "schedule" && computer
      ? computer.scheduleLimit
      : (computer?.limit ?? settings.maxLiveAgents);
  if (limit === 0) return { release: () => {} };
  const overLimit = !computer && options?.overLimit === true;
  const exemptFromCount = options?.kind === "bot";
  const reservation = await agentAdmission.acquire(
    overLimit || exemptFromCount ? NO_AGENT_LIMIT : limit,
    async () => {
      const available = hostAvailableMemory();
      const sessions = await listSessions().catch(() => []);
      const pool = (!computer
        ? sessions
        : kind === "schedule"
          ? sessions.filter((session) => session.spawnedBy === "schedule")
          : sessions.filter((session) => session.spawnedBy !== "schedule"))
        .filter((session) => !session.persistent);
      return {
        sessions: pool,
        // Always measured, so every launch books its share of memory even on
        // the count-capped path. Only whether a shortfall REFUSES is
        // conditional.
        memory: agentLaunchMemoryBudget(totalmem(), available.bytes),
        // A self-hosted box trusts its own count-based cap. An override has
        // just discarded that cap, so the budget becomes the last thing between
        // "start one more" and an OOM — but only where the reading means what
        // the budget assumes. Off Linux this is `freemem()`, which ignores
        // reclaimable cache and would refuse every override on a perfectly
        // healthy Mac. Better to honour the owner's explicit decision about
        // their own machine than to block it on a number we know is wrong.
        enforceMemory: computer !== null || (overLimit && available.trusted),
      };
    },
    computer ? archiveIdleDurableAgentsForMemory : undefined,
  );
  if (reservation.ok) return reservation;
  // Tagged `plan_limit` ONLY on a hosted Computer. An ordinary LFG install that
  // hits its own maxLiveAgents setting was stopped by a preference it can edit
  // in Settings, not by a plan — telling that person to upgrade would be
  // nonsense, and a host must not paint an upgrade sheet over it.
  if (reservation.reason === "memory") {
    return err(
      429,
      computer
        ? `this Computer has ${formatMemory(reservation.availableBytes)} memory available and needs ${formatMemory(reservation.requiredBytes)} to start another agent safely; finish an agent or upgrade your Computer`
        : `this machine has ${formatMemory(reservation.availableBytes)} memory available and needs ${formatMemory(reservation.requiredBytes)} to start another agent safely; close an agent to free memory`,
      computer ? "plan_limit" : undefined,
    );
  }
  // Two different refusals that happen to count the same thing. A plan cap is a
  // sales conversation the host owns; a local cap is a preference its owner can
  // edit, so it says so, and carries the code a surface needs to offer the
  // override without matching on prose.
  //
  // The sentence deliberately does NOT say "start anyway". Only three surfaces
  // implement that (create, cold resume, finding reply); fork cannot be
  // overridden at all. Naming it here would promise a button that is missing
  // from half the places this text appears — so the affordance stays with the
  // surfaces that actually have it, and the prose names only what is always
  // true.
  if (!computer) {
    return err(
      429,
      `${reservation.resident} of ${limit} agents live — close an agent, or raise the limit in Settings`,
      "agent_limit",
    );
  }
  if (kind === "schedule") {
    return err(
      429,
      `your ${computer.plan} Computer plan allows ${computer.scheduleLimit} concurrent scheduled runs; ${reservation.resident} live — wait for one to finish`,
      "plan_limit",
    );
  }
  return err(
    429,
    `your ${computer.plan} Computer plan allows ${computer.limit} concurrent agents; ${reservation.resident} live — upgrade your Computer or close an agent`,
    "plan_limit",
  );
}

// Current memory of the aggregate agent slice (the cgroup every contained agent
// runs in — see tmux.ts). Best-effort: returns nulls if systemd can't answer.
function sliceMemoryBytes(): { current: number | null; max: number | null } {
  try {
    const r = Bun.spawnSync({
      cmd: [
        "systemctl", "--user", "show", "lfg-agents.slice",
        "--property=MemoryCurrent", "--property=MemoryMax", "--value",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (r.exitCode !== 0) return { current: null, max: null };
    const lines = r.stdout.toString().trim().split("\n").map((s) => s.trim());
    const parse = (v?: string): number | null => {
      if (!v || v === "[not set]" || v === "infinity") return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    return { current: parse(lines[0]), max: parse(lines[1]) };
  } catch {
    return { current: null, max: null };
  }
}

// Capacity of the filesystem that holds LFG's durable data. Keep this
// best-effort: Settings should still load in runtimes where statfs is not
// available or the data directory has not been mounted yet.
function hostDiskBytes(): { total: number | null; free: number | null } {
  try {
    const disk = statfsSync(PATHS.data);
    const total = Number(disk.blocks) * Number(disk.bsize);
    const free = Number(disk.bfree) * Number(disk.bsize);
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(free)) {
      return { total: null, free: null };
    }
    return { total, free: Math.max(0, Math.min(total, free)) };
  } catch {
    return { total: null, free: null };
  }
}

// Live server snapshot for the settings performance panel + the "working now"
// counter. "live" = an agent process exists; "working" = it has a turn in
// flight (Session.busy). The cap counts LIVE agents (a resident-but-idle agent
// still holds memory); the counter surfaces WORKING for at-a-glance load.
async function serverStats() {
  const sessions = await listSessionsCached().catch(() => []);
  const live = sessions.length;
  const working = sessions.filter((s) => s.busy).length;
  const settings = getGlobalSettingsSync();
  const computer = computerAgentAdmissionContext();
  const slice = sliceMemoryBytes();
  const disk = hostDiskBytes();
  const [load1, load5, load15] = loadavg();
  // Pressure is the leading indicator the panel warns on: it rises while
  // "percent used" still looks healthy. History powers the sparklines.
  const pressure = await readAllPressure();
  const history: MetricSample[] = getMetricsHistory();
  const latest = history.length ? history[history.length - 1]! : null;
  return {
    agents: {
      live,
      working,
      idle: Math.max(0, live - working),
      max: computer?.limit ?? settings.maxLiveAgents, // 0 = unlimited
    },
    memory: {
      sliceCurrentBytes: slice.current,
      sliceMaxBytes: slice.max,
      hostTotalBytes: totalmem(),
      hostFreeBytes: freemem(),
    },
    disk: {
      totalBytes: disk.total,
      freeBytes: disk.free,
    },
    cpu: { cores: cpus().length, load1, load5, load15 },
    network: { rxBps: latest?.rxBps ?? 0, txBps: latest?.txBps ?? 0 },
    pressure,
    history,
  };
}

// Per-session memory/disk breakdown, for the operator question the aggregate
// panel cannot answer: "the box is at 92% — WHICH session do I close?"
//
// Deliberately its own route rather than a field on /api/server/stats: that one
// is polled every 3s by every open settings pane, and this walks /proc reading
// smaps_rollup, cmdline, cgroup and environ per process (~50-130ms). Folding it
// in would multiply the cost of the cheap panel by the expensive one. Callers
// fetch it only while the breakdown is expanded, and the short cache below
// collapses concurrent viewers onto a single scan.
const SESSION_USAGE_TTL_MS = 2_000;
let sessionUsageCache: { at: number; value: Awaited<ReturnType<typeof buildSessionUsageReport>> } | null = null;
let sessionUsageInflight: Promise<Awaited<ReturnType<typeof buildSessionUsageReport>>> | null = null;

async function sessionUsage() {
  if (sessionUsageCache && Date.now() - sessionUsageCache.at < SESSION_USAGE_TTL_MS) {
    return sessionUsageCache.value;
  }
  // Share one in-flight scan: a settings pane open in three tabs must not walk
  // /proc three times on a box that is already short on memory.
  if (sessionUsageInflight) return sessionUsageInflight;
  sessionUsageInflight = (async () => {
    const sessions = await listSessionsCached().catch(() => []);
    const report = await buildSessionUsageReport(
      sessions.map((session) => ({
        sessionId: session.sessionId,
        tmuxName: session.tmuxName,
        cwd: session.cwd,
        pid: session.pid,
        title: session.title,
        agent: session.agent,
        managed: session.managed,
      })),
    );
    sessionUsageCache = { at: Date.now(), value: report };
    return report;
  })();
  try {
    return await sessionUsageInflight;
  } finally {
    sessionUsageInflight = null;
  }
}

marked.setOptions({ gfm: true, breaks: false });

// Render a report's markdown to HTML, wrapping every table in a horizontal
// scroll container so wide tables (security posture, pricing, db stats) scroll
// within their card on mobile instead of blowing out the viewport width.
function renderReportHtml(raw: string): string {
  const html = marked.parse(raw) as string;
  return html
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, "</table></div>");
}

// ---------- legacy: pre-agents flat reports ----------

async function listRepos() {
  return listConfiguredRepos({ reposRoot: REPOS_ROOT, selfRepo: SELF_REPO });
}

type RepoEntry = Awaited<ReturnType<typeof listRepos>>[number];

// Auto agents may run in a git worktree (or any nested checkout); the UI must
// still group them under the owning repo's project. projectName() collapses
// worktree cwds back to the main checkout, so compute it server-side — the
// browser cannot read .git files to do this itself.
function withAutoAgentMeta<T extends { id: string; cwd?: string }>(a: T) {
  return { ...a, project: projectName(a.cwd || SELF_REPO), running: isRunning(a.id) };
}

/**
 * How much prompt text a LIST response carries per agent.
 *
 * The agent list renders the prompt inside a single CSS-`truncate` line, so
 * roughly the first 60 characters are the only ones a reader ever sees — but
 * the full text shipped on every poll. That is not a rounding error once
 * someone actually uses auto agents: a real box measured 29 agents carrying
 * 89,978 bytes of prompt, 93% of a 98,980-byte response, re-fetched every 5
 * seconds by the list poll and again by /api/bootstrap on every cold open.
 *
 * It is worse than it looks over the hosted relay, which strips
 * `content-encoding` (see the box→relay leg in control-plane's
 * session-proxy.ts), so those bytes cross the wire uncompressed.
 *
 * 200 is comfortably more than the line can show at any viewport. The editor
 * needs the whole thing, so it refetches GET /api/auto/agents/:id on open —
 * `promptTruncated` is the flag that tells it to.
 */
export const AUTO_AGENT_LIST_PROMPT_CHARS = 200;

/** Pure half of withAutoAgentListMeta — exported so the clipping itself is
 *  testable without standing up a server or touching the repo on disk. */
export function truncateAutoAgentPrompt(prompt: string): {
  prompt: string;
  promptTruncated: boolean;
} {
  return prompt.length <= AUTO_AGENT_LIST_PROMPT_CHARS
    ? { prompt, promptTruncated: false }
    : { prompt: prompt.slice(0, AUTO_AGENT_LIST_PROMPT_CHARS), promptTruncated: true };
}

/** List-shaped agent: same as withAutoAgentMeta, minus the prompt tail. */
function withAutoAgentListMeta<T extends { id: string; cwd?: string; prompt?: string }>(a: T) {
  const meta = withAutoAgentMeta(a);
  // An agent with no prompt at all keeps that shape rather than gaining an
  // empty string, so the editor's "is this a preview?" check stays honest.
  if (typeof a.prompt !== "string") return { ...meta, promptTruncated: false };
  return { ...meta, ...truncateAutoAgentPrompt(a.prompt) };
}

/**
 * Why the session LIST leaves `cmd` on the floor.
 *
 * `cmd` is the full spawn command line, which for a managed session embeds the
 * entire omg.dev runtime contract AND the complete user prompt. Measured on a
 * live box: 15 sessions carrying 36 KB of `cmd` — 67.7% of a 53 KB
 * /api/sessions response, median 2,019 chars per session — refetched by the
 * dashboard's 5s poll and again by /api/bootstrap on every cold open. Over the
 * hosted relay those bytes cross uncompressed (see the box→relay leg in
 * control-plane's session-proxy.ts).
 *
 * Nothing that reads the list ever looks at it: the web UI declares the field
 * on its Session type but renders nothing from it, and the MCP listing slims
 * rows itself (see slimSession in mcp.ts). Truncating instead of dropping
 * would still leak prompt text, which this codebase treats as sensitive —
 * control-plane's session proxy clones a whole request just to keep one enum,
 * precisely so prompt text cannot reach telemetry.
 *
 * Everything the server derives from `cmd` (model, thinking level, codex
 * prompt recovery, headless detection) happens inside listSessions() while
 * building the row, so stripping it at the serialization boundary costs
 * nothing. `?full=1` on /api/sessions opts back in for the one caller that
 * genuinely wants the command line: omg_list_sessions with verbose:true.
 */
export function sessionListRow(session: Session): Omit<Session, "cmd"> {
  const { cmd: _dropped, ...row } = session;
  return row;
}

function repoRootForManagedCwd(cwd: string): string | undefined {
  const top = Bun.spawnSync({
    cmd: ["git", "-C", cwd, "rev-parse", "--show-toplevel"],
    stdout: "pipe",
    stderr: "pipe",
  });
  const topLevel = top.exitCode === 0 ? top.stdout.toString().trim() : "";
  const proc = Bun.spawnSync({
    cmd: ["git", "-C", cwd, "rev-parse", "--git-common-dir"],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) return topLevel || undefined;
  const common = proc.stdout.toString().trim();
  if (!common) return topLevel || undefined;
  const absCommon = resolve(cwd, common);
  return absCommon.includes("/.git/worktrees/") ? dirname(absCommon.split("/.git/worktrees/")[0] + "/.git") : topLevel || cwd;
}

function dirExists(path: string | null | undefined): path is string {
  if (!path) return false;
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

async function artifactOwnerCwd(sessionId: string): Promise<string | null> {
  const sessions = await listSessions().catch(() => []);
  const session = sessions.find((row) => sessionMatchesId(row, sessionId));
  if (dirExists(session?.cwd)) return session.cwd;
  const managed = listManaged().find((row) => sessionMatchesId(row, sessionId));
  if (dirExists(managed?.cwd)) return managed.cwd;
  const transcript = await resolveTranscript(sessionId).catch(() => null);
  if (!transcript) return null;
  const cwd = await cwdForTranscript(transcript).catch(() => null) ??
    await cwdForCodexTranscript(transcript).catch(() => null);
  return dirExists(cwd) ? cwd : null;
}

async function resolveResumeCwd(
  transcriptCwd: string | null,
  project: string | null | undefined,
): Promise<string> {
  const repos = await listRepos().catch(() => []);
  const repo = project ? repos.find((r) => r.project === project) : undefined;
  if (repo && (!dirExists(transcriptCwd) || projectName(transcriptCwd) !== project)) return repo.cwd;
  if (dirExists(transcriptCwd)) return transcriptCwd;
  return repo?.cwd || SELF_REPO;
}

function persistManagedResume(session: Session): void {
  if (!session.sessionId) return;
  const backend = session.agent === "aisdk"
    ? "aisdk"
    : session.agent === "codex-aisdk"
      ? "codex-aisdk"
      : session.agent === "opencode"
        ? "opencode"
        : session.agent === "pi"
          ? "pi"
          : session.runtime === "command-file" &&
              (session.agent === "grok" || session.agent === "cursor" || session.agent === "fx" || session.agent === "copilot" || session.agent === "jcode")
            ? session.agent
          : null;
  if (!backend && !session.transcriptPath) return;
  const fileBackedId =
    session.nativeSessionId ??
    session.transcriptPath?.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/)?.[0] ??
    session.sessionId;
  // Grok/Cursor mint a stable LFG sessionId for the UI, while the on-disk
  // transcript is named by the native chat id. After close we removeManaged the
  // live mapping; if resume-cache only stores the native id, resolveTranscript
  // (and WS subscribe) for the LFG id return null and the UI shows an empty
  // transcript. Persist under the LFG id (managed so prune keeps it) with
  // resumeHandle = native id, and keep a native-id row for the history scan.
  const dualIdNativeTui =
    !backend &&
    (session.agent === "grok" || session.agent === "cursor") &&
    !!session.nativeSessionId &&
    session.nativeSessionId !== session.sessionId;
  const sessionId = backend || dualIdNativeTui ? session.sessionId : fileBackedId;
  const agent =
    backend === "codex-aisdk" || session.agent === "codex"
      ? "codex"
      : backend === "opencode"
        ? "opencode"
        : backend === "pi"
          ? "pi"
          : backend === "grok" || backend === "cursor" || backend === "fx" || backend === "copilot" || backend === "jcode"
            ? backend
          : session.agent === "grok"
            ? "grok"
            : session.agent === "cursor"
              ? "cursor"
              : "claude";
  const path = backend ? sessionIndexKey(session.sessionId) : session.transcriptPath;
  const mtimeMs = session.lastActivityAt ?? Date.now();
  // Annotated, not inferred: `agent` and `backend` are narrow unions on the
  // row type, but a bare object literal widens both to `string`, so the two
  // spreads below failed to typecheck against upsertResumableRows. Pinning the
  // contract here also means a future field drift is reported at the one place
  // it's constructed rather than at every use site.
  const base: Omit<ResumableCacheRow, "sessionId" | "resumeHandle" | "managed"> = {
    cwd: session.cwd,
    project: session.project,
    title: session.title,
    lastActivityAt: mtimeMs,
    lastUserText: session.lastUserText,
    agent,
    path,
    mtimeMs,
    backend: backend ?? undefined,
    model: session.model,
    assignedUser: session.assignedUser,
    resumable: true,
  };
  const rows: Parameters<typeof upsertResumableRows>[0] = [{
    ...base,
    sessionId,
    resumeHandle: backend
      ? session.nativeSessionId || session.sessionId
      : dualIdNativeTui
        ? session.nativeSessionId
        : undefined,
    // Dual-id LFG-key rows must survive pruneResumableExcept (which only keeps
    // filesystem-scanned native ids in the unmanaged set).
    managed: !!backend || dualIdNativeTui,
  }];
  if (dualIdNativeTui && session.nativeSessionId) {
    rows.push({
      ...base,
      sessionId: session.nativeSessionId,
      resumeHandle: session.nativeSessionId,
      managed: false,
    });
  }
  upsertResumableRows(rows);
}

// ---------- agent reports ----------

async function listAgentReports(agent: string) {
  const dir = join(PATHS.data, "reports", agent);
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const entries = await Promise.all(
    files
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .map(async (f) => {
        const s = await stat(join(dir, f));
        return { date: f.replace(/\.md$/, ""), bytes: s.size, mtime: s.mtimeMs };
      }),
  );
  return entries.sort((a, b) => b.date.localeCompare(a.date));
}

async function listAgentSummaries() {
  const agents = await listAgents();
  return Promise.all(
    agents.map(async (a) => {
      const reps = await listAgentReports(a.name);
      return {
        name: a.name,
        title: a.frontmatter.title ?? a.name,
        enabled: a.frontmatter.enabled !== false,
        inputCount: a.frontmatter.inputs?.length ?? 0,
        lastReport: reps[0]
          ? { date: reps[0].date, bytes: reps[0].bytes, mtime: reps[0].mtime }
          : null,
      };
    }),
  );
}

const SETUP_CHECKS_CACHE_TTL_MS = 45_000;
let setupChecksCache:
  | { expiresAt: number; checks: Awaited<ReturnType<typeof listSetupChecks>> }
  | null = null;
let setupChecksInFlight: Promise<Awaited<ReturnType<typeof listSetupChecks>>> | null = null;

async function listSetupChecksCached(opts: { refresh?: boolean } = {}) {
  const now = Date.now();
  if (!opts.refresh && setupChecksCache && setupChecksCache.expiresAt > now) {
    return setupChecksCache.checks;
  }
  if (!opts.refresh && setupChecksInFlight) return setupChecksInFlight;
  setupChecksInFlight = listSetupChecks()
    .then((checks) => {
      setupChecksCache = { checks, expiresAt: Date.now() + SETUP_CHECKS_CACHE_TTL_MS };
      return checks;
    })
    .finally(() => {
      setupChecksInFlight = null;
    });
  return setupChecksInFlight;
}

/**
 * Cache for listCodingAgents — the single most expensive thing /api/bootstrap
 * does, by an order of magnitude.
 *
 * statusFor() probes every coding agent's auth state, and those probes SHELL
 * OUT: `cursor-agent status` boots a whole Node runtime, `jcode auth status`
 * runs a shell wrapper, plus `git rev-parse`. Measured on a real box: 26
 * execve's and 1542 ms per call, 97% of it blocked in wait4 — and identical on
 * the second call, because nothing cached it. /api/bootstrap fans out ten
 * tasks in parallel and every one of the other nine finishes in 5-130 ms, so
 * this alone set the endpoint's 1557 ms.
 *
 * Worse than its own latency: statusFor is SYNCHRONOUS, so those spawns block
 * the Bun event loop for ~1.5 s and stall every other in-flight request. That
 * is what made a 1 ms /api/voice/config land at 1918 ms in the browser.
 *
 * A TTL is the right shape because the answer is "is this CLI logged in",
 * which changes on a human action, not on its own — and every route that can
 * change it busts the cache explicitly (see the /api/coding-agents mutation
 * hook in fetch()). In-flight dedup mirrors listSetupChecksCached above so a
 * cold cache under concurrent boots still only pays for one probe sweep.
 */
const CODING_AGENTS_CACHE_TTL_MS = 60_000;
let codingAgentsCache:
  | { expiresAt: number; agents: Awaited<ReturnType<typeof listCodingAgents>> }
  | null = null;
let codingAgentsInFlight: Promise<Awaited<ReturnType<typeof listCodingAgents>>> | null = null;

function refreshCodingAgentsCache() {
  if (codingAgentsInFlight) return codingAgentsInFlight;
  codingAgentsInFlight = listCodingAgents()
    .then((agents) => {
      codingAgentsCache = { agents, expiresAt: Date.now() + CODING_AGENTS_CACHE_TTL_MS };
      return agents;
    })
    .finally(() => {
      codingAgentsInFlight = null;
    });
  return codingAgentsInFlight;
}

/**
 * Stale-while-revalidate, because a plain TTL does not actually fix this for a
 * real user. A dashboard opened after a quiet minute would find the entry
 * expired and pay the whole 1.5 s probe in the foreground — which is the exact
 * cold-open stall we are removing. Serving the stale answer and refreshing
 * behind it means only the very first read after boot can ever block, and
 * `warmCodingAgentsCache()` takes even that off the request path.
 *
 * Staleness is safe here specifically because it is bounded by correctness
 * elsewhere: every route that can change the answer drops the entry outright
 * (see the mutation hook in fetch()), so a stale read can only ever describe a
 * state no user action has invalidated.
 */
async function listCodingAgentsCached(opts: { refresh?: boolean } = {}) {
  if (opts.refresh) return refreshCodingAgentsCache();
  if (codingAgentsCache) {
    if (codingAgentsCache.expiresAt <= Date.now()) {
      // Stale: hand back what we have and re-probe out of band. Errors are
      // swallowed so a failing probe can never reject a caller that already
      // has a usable answer.
      void refreshCodingAgentsCache().catch(() => {});
    }
    return codingAgentsCache.agents;
  }
  return refreshCodingAgentsCache();
}

/** Prime the cache off the request path so the first dashboard open is fast. */
function warmCodingAgentsCache() {
  void refreshCodingAgentsCache().catch(() => {});
}

/** Drop the cached agent/auth probe so the next read re-runs it. */
function invalidateCodingAgentsCache() {
  codingAgentsCache = null;
}

async function readAgentReport(agent: string, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  if (!/^[a-z0-9_-]+$/.test(agent)) return null;
  const f = Bun.file(reportPathFor(agent, date));
  if (!(await f.exists())) return null;
  const raw = await f.text();
  const parsed = parseActions(agent, date, raw).map((p) => p.id);
  const sidecar = await readActionsSidecar(agent, date);
  const byId = new Map(sidecar.map((s) => [s.id, s] as const));
  const actions = parsed
    .map((id) => byId.get(id))
    .filter((r): r is ActionRow => !!r);
  return { date, raw, html: renderReportHtml(raw), actions };
}

// ---------- run lifecycle ----------

type RunState = {
  id: string;
  agent: string;
  date: string;
  startedAt: number;
  status: "running" | "done" | "failed";
  logs: string[];
  result?: unknown;
  error?: string;
  subscribers: Set<(ev: { line?: string; final?: RunState }) => void>;
};

const RUNS = new Map<string, RunState>();
const RUN_TTL_MS = 60 * 60 * 1000;

// Last successful /api/claude/usage payload (60s TTL).
let usageCache: { at: number; data: unknown } | null = null;

function evictOldRuns() {
  const cutoff = Date.now() - RUN_TTL_MS;
  for (const [k, v] of RUNS) if (v.startedAt < cutoff && v.status !== "running") RUNS.delete(k);
}

function emit(state: RunState, ev: { line?: string; final?: RunState }) {
  for (const s of state.subscribers) {
    try {
      s(ev);
    } catch {}
  }
}

async function startRun(agent: string): Promise<RunState> {
  evictOldRuns();
  const id = randomBytes(6).toString("hex");
  const state: RunState = {
    id,
    agent,
    date: new Date().toISOString().slice(0, 10),
    startedAt: Date.now(),
    status: "running",
    logs: [],
    subscribers: new Set(),
  };
  RUNS.set(id, state);

  runAgent(agent, {
    onLog: (line) => {
      state.logs.push(line);
      emit(state, { line });
    },
  })
    .then((r) => {
      state.status = "done";
      state.result = r;
      emit(state, { final: state });
    })
    .catch((e) => {
      state.status = "failed";
      state.error = e instanceof Error ? e.message : String(e);
      emit(state, { final: state });
    });

  return state;
}

function agentRunSnapshot(runId: string) {
  const state = RUNS.get(runId);
  if (!state) return null;
  return {
    id: state.id,
    agent: state.agent,
    date: state.date,
    status: state.status,
    logs: state.logs,
    result: state.result,
    error: state.error,
  };
}

function subscribeAgentRun(runId: string, cb: (event: { type: "log"; line: string } | { type: "done" | "failed"; status: "done" | "failed"; result?: unknown; error?: string }) => void) {
  const state = RUNS.get(runId);
  if (!state) return () => {};
  const send = (ev: { line?: string; final?: RunState }) => {
    if (ev.line) cb({ type: "log", line: ev.line });
    if (ev.final) {
      const status = ev.final.status === "failed" ? "failed" : "done";
      cb({
        type: status,
        status,
        result: ev.final.result,
        error: ev.final.error,
      });
    }
  };
  state.subscribers.add(send);
  return () => state.subscribers.delete(send);
}

// ---------- HTTP helpers ----------

// v2 frontend: the Vite-built React app at <repo>/web/dist. (v1, the hand-written
// single-file src/web/index.html, was removed.) Rebuild with `bun run build` in
// web/ to publish changes.
const WEB_DIR = join(import.meta.dir, "..", "..", "web", "dist");
const INDEX_PATH = join(WEB_DIR, "index.html");

const STATIC_FILES: Record<string, { path: string; type: string }> = {
  "/manifest.webmanifest": {
    path: join(WEB_DIR, "manifest.webmanifest"),
    type: "application/manifest+json",
  },
  "/icon.svg": { path: join(WEB_DIR, "icon.svg"), type: "image/svg+xml" },
  "/icon-small.svg": {
    path: join(WEB_DIR, "icon-small.svg"),
    type: "image/svg+xml",
  },
  "/icon-maskable.svg": {
    path: join(WEB_DIR, "icon-maskable.svg"),
    type: "image/svg+xml",
  },
  "/icon-192.png": { path: join(WEB_DIR, "icon-192.png"), type: "image/png" },
  "/icon-512.png": { path: join(WEB_DIR, "icon-512.png"), type: "image/png" },
  "/icon-maskable-512.png": {
    path: join(WEB_DIR, "icon-maskable-512.png"),
    type: "image/png",
  },
  "/agent-claude.svg": { path: join(WEB_DIR, "agent-claude.svg"), type: "image/svg+xml" },
  "/agent-codex.svg": { path: join(WEB_DIR, "agent-codex.svg"), type: "image/svg+xml" },
  "/agent-cursor.svg": { path: join(WEB_DIR, "agent-cursor.svg"), type: "image/svg+xml" },
  "/agent-fx.svg": { path: join(WEB_DIR, "agent-fx.svg"), type: "image/svg+xml" },
  "/agent-opencode.svg": { path: join(WEB_DIR, "agent-opencode.svg"), type: "image/svg+xml" },
  "/agent-jcode.svg": { path: join(WEB_DIR, "agent-jcode.svg"), type: "image/svg+xml" },
  "/agent-grok.svg": { path: join(WEB_DIR, "agent-grok.svg"), type: "image/svg+xml" },
  "/agent-hermes.svg": { path: join(WEB_DIR, "agent-hermes.svg"), type: "image/svg+xml" },
  "/agent-pi.svg": { path: join(WEB_DIR, "agent-pi.svg"), type: "image/svg+xml" },
  "/agent-copilot.svg": { path: join(WEB_DIR, "agent-copilot.svg"), type: "image/svg+xml" },
  "/apple-touch-icon.png": { path: join(WEB_DIR, "apple-touch-icon.png"), type: "image/png" },
};

// Serve a small static asset (manifest, PWA icons, agent SVGs) with proper
// cache validators. Previously these went out as `max-age=300` with no ETag /
// Last-Modified, so every 5 minutes the browser did a full re-download instead
// of a cheap revalidation — and agent icons, referenced on every composer
// render, felt like a fresh network hit. Now:
//   - versioned URLs (`?v=…`, content-addressed by the caller) → cached hard
//     for a year, immutable, so repeat renders never touch the network.
//   - un-versioned URLs → 1-day cache + stale-while-revalidate, and an ETag /
//     Last-Modified pair so revalidation returns a tiny 304 instead of the body.
async function staticAssetResponse(
  req: Request,
  url: URL,
  filePath: string,
  type: string,
): Promise<Response> {
  const f = Bun.file(filePath);
  if (!(await f.exists())) return new Response("Not found", { status: 404 });
  const size = f.size;
  const mtimeMs = Math.floor(f.lastModified);
  const mtimeSec = Math.floor(mtimeMs / 1000) * 1000;
  const etag = `"${size.toString(16)}-${mtimeMs.toString(16)}"`;
  const cacheControl = url.searchParams.has("v")
    ? "public, max-age=31536000, immutable"
    : "public, max-age=86400, stale-while-revalidate=604800";
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Cache-Control": cacheControl,
    ETag: etag,
    "Last-Modified": new Date(mtimeSec).toUTCString(),
    Vary: "Accept-Encoding",
  };

  const ifNoneMatch = req.headers.get("if-none-match");
  const ifModifiedSince = req.headers.get("if-modified-since");
  const matchesEtag =
    !!ifNoneMatch && ifNoneMatch.split(",").some((tag) => tag.trim() === etag);
  const notModifiedByDate =
    !ifNoneMatch &&
    !!ifModifiedSince &&
    Number.isFinite(Date.parse(ifModifiedSince)) &&
    Date.parse(ifModifiedSince) >= mtimeSec;
  if (matchesEtag || notModifiedByDate) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(f, { headers });
}

async function webIndexResponse() {
  // Runtime extension injection: LFG core ships no proprietary UI. Our
  // deployments set LFG_EXTENSIONS (comma-separated ESM URLs) — each is
  // injected as a module <script> AFTER the app bundle, so it runs once
  // window.lfg (host React + registerExtension) exists and contributes UI
  // (e.g. a private tab). Open-source forks set nothing → clean core.
  let html = await Bun.file(INDEX_PATH).text();
  const runtimeConfig = `<script>window.__LFG_CONFIG__=${JSON.stringify({ liveTransport: liveTransportMode() })}</script>`;
  html = html.includes("</head>")
    ? html.replace("</head>", `${runtimeConfig}</head>`)
    : runtimeConfig + html;
  const exts = (process.env.LFG_EXTENSIONS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (exts.length) {
    const tags = exts
      .map((src) => `<script type="module" src="${src.replace(/"/g, "&quot;")}"></script>`)
      .join("");
    html = html.includes("</body>")
      ? html.replace("</body>", `${tags}</body>`)
      : html + tags;
  }
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * "How far did my PWA actually get?" rendered as a page.
 *
 * Written to be read on a phone, and to state a verdict rather than hand over a
 * wall of rows: the point is to end the black-screen guessing loop, so the first
 * thing on screen is which layer is at fault.
 */
function pwaDiagResponse(url: URL): Response {
  const noStore = { "Cache-Control": "no-store, max-age=0" };
  if (url.searchParams.has("clear")) {
    pwaBootLog.clear();
    return new Response(null, {
      status: 303,
      headers: { Location: "/__lfg_pwa_diag", ...noStore },
    });
  }
  const entries = pwaBootLog.snapshot();
  const v = pwaBootLog.verdict(entries);
  if (url.searchParams.has("json")) {
    return new Response(JSON.stringify({ verdict: v, entries }, null, 2), {
      headers: { "Content-Type": "application/json", ...noStore },
    });
  }

  const now = Date.now();
  const ago = (t: number) => {
    const s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    return `${Math.round(s / 3600)}h ago`;
  };
  const shortUa = (ua?: string) => {
    if (!ua) return "";
    if (/iPhone/.test(ua)) return "iPhone";
    if (/iPad/.test(ua)) return "iPad";
    if (/Android/.test(ua)) return "Android";
    if (/Macintosh|Mac OS X/.test(ua)) return "Mac";
    if (/Windows/.test(ua)) return "Windows";
    if (/Linux/.test(ua)) return "Linux";
    return ua.slice(0, 20);
  };

  // Cards, not a table: this page is read on the phone that is failing, and a
  // six-column table there squeezes every value into a one-character column.
  const rows = entries
    .map((e) => {
      const cls = e.source === "beacon" ? "beacon" : "req";
      const meta = [e.mode, shortUa(e.ua)].filter(Boolean).join(" · ");
      const detail = Object.entries(e.detail ?? {})
        .map(([k, val]) => `<span class="kv"><b>${escapeHtml(k)}</b> ${escapeHtml(String(val))}</span>`)
        .join("");
      const repeat = e.repeat && e.repeat > 1 ? `<span class="rep">×${e.repeat}</span>` : "";
      return `<li class="ev">
<div class="ev-top"><span class="tag ${cls}">${escapeHtml(e.source)}</span><span class="lbl">${escapeHtml(e.label)}</span>${repeat}<span class="when">${escapeHtml(ago(e.t))}</span></div>
${meta ? `<div class="meta">${escapeHtml(meta)}</div>` : ""}
${detail ? `<div class="kvs">${detail}</div>` : ""}
</li>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<meta name="robots" content="noindex"/>
<title>lfg — PWA launch diagnostics</title>
<style>
html,body{margin:0;background:#000;color:#f4f4f5;font:15px/1.5 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}
main{max-width:44rem;margin:0 auto;padding:1.5rem 1rem 4rem}
h1{font-size:1.1rem;margin:0 0 .25rem}
.sub{color:#71717a;margin:0;font-size:.85rem}
.verdict{border:1px solid #27272a;border-radius:.9rem;padding:1rem;margin:1rem 0;background:#09090b}
.verdict h2{margin:0 0 .4rem;font-size:1.05rem;color:#fff}
.verdict p{margin:0;color:#a1a1aa;font-size:.92rem}
.verdict p.note{margin-top:.6rem;padding-top:.6rem;border-top:1px solid #27272a;color:#fde68a;font-size:.85rem}
.how{color:#a1a1aa;font-size:.88rem;margin:.75rem 0 0;padding-left:1.1rem}
.how li{margin:.3rem 0}
.actions{display:flex;gap:.5rem;margin-top:1rem;flex-wrap:wrap}
a.btn{display:inline-block;text-decoration:none;border-radius:999px;padding:.55rem 1rem;font-size:.85rem;font-weight:600;background:#27272a;color:#f4f4f5}
a.btn.primary{background:#0a84ff;color:#fff}
ul.log{list-style:none;margin:1.25rem 0 0;padding:0}
li.ev{border-bottom:1px solid #18181b;padding:.6rem .1rem}
.ev-top{display:flex;align-items:center;gap:.5rem}
.ev-top .lbl{font-weight:600;font-size:.9rem}
.ev-top .when{margin-left:auto;color:#71717a;font-size:.75rem;white-space:nowrap}
.rep{font-size:.7rem;color:#71717a}
.meta{color:#a1a1aa;font-size:.78rem;margin-top:.2rem}
.kvs{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.35rem}
.kv{font-size:.72rem;color:#a1a1aa;background:#18181b;border-radius:.4rem;padding:.15rem .4rem;word-break:break-all}
.kv b{color:#71717a;font-weight:600}
.tag{font-size:.65rem;text-transform:uppercase;letter-spacing:.04em;padding:.1rem .35rem;border-radius:999px}
.tag.req{background:#1e3a5f;color:#bfdbfe}
.tag.beacon{background:#14532d;color:#bbf7d0}
.empty{color:#71717a;padding:1.5rem 0;text-align:center}
</style></head><body>
<main>
<h1>PWA launch diagnostics</h1>
<p class="sub">${entries.length} event${entries.length === 1 ? "" : "s"} recorded · auto-refreshing</p>

<div class="verdict">
<h2>${escapeHtml(v.headline)}</h2>
<p>${escapeHtml(v.explanation)}</p>
${v.note ? `<p class="note">${escapeHtml(v.note)}</p>` : ""}
</div>

<ol class="how">
<li>Tap <strong>Clear</strong> below.</li>
<li>Open the black lfg icon from your Home Screen. Wait ~10 seconds.</li>
<li>Come back here (from any device) and read the verdict.</li>
</ol>

<div class="actions">
<a class="btn primary" href="/__lfg_pwa_diag?clear=1">Clear</a>
<a class="btn" href="/__lfg_pwa_diag">Refresh</a>
<a class="btn" href="/__lfg_pwa_diag?json=1">JSON</a>
</div>

${entries.length ? `<ul class="log">${rows}</ul>` : `<p class="empty">Nothing recorded yet.</p>`}
</main>
<script>setTimeout(function(){location.reload()},5000)</script>
</body></html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", ...noStore },
  });
}

function json(obj: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(obj), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

/**
 * A machine-readable tag on an error a CLIENT has to react to structurally,
 * rather than by matching prose. Only add one when some caller genuinely
 * branches on it — the message stays the thing humans read.
 *
 * `plan_limit`: the request was refused by the hosted Computer's PLAN, not by
 * anything the person did wrong. A host that sells plans turns this into its
 * own upgrade surface instead of a red error toast, so the copy here must stay
 * good enough to stand alone for hosts that don't.
 *
 * `agent_limit`: the same wall on a SELF-HOSTED box, where the cap is the
 * owner's own maxLiveAgents preference. Nothing is for sale here — the surface
 * offers to start the agent anyway (`overLimit`) or to go and edit the number.
 * Kept apart from `plan_limit` precisely so a host cannot mistake one for the
 * other and try to sell an upgrade to someone who owns the hardware.
 *
 * `bot_quota_limit`: a stored-bot owner allowance. It is never a concurrent
 * runtime or memory refusal. The response also carries the typed quota
 * snapshot, so clients do not have to parse this code or the prose for counts.
 */
export type ApiErrorCode =
  | "plan_limit"
  | "agent_limit"
  | "bot_quota_limit"
  | "bot_restart_forbidden"
  | "bot_restart_unavailable"
  | "bot_restart_conflict"
  | "bot_restart_failed";

function err(status: number, message: string, code?: ApiErrorCode) {
  return json(code ? { error: message, code } : { error: message }, { status });
}

/**
 * The session a caller claims to be, for the routes that gate on owning it.
 *
 * Two spellings, because the sender and this reader do not ship together: the
 * MCP layer now sends X-OMG-Session-ID, but the web app and any agent process
 * started before the OMG rename still send X-LFG-Session-ID. Accepting only one
 * turns an ownership check into a 403 on a request that is in fact authorised.
 */
function callerSessionHeader(req: Request): string | null {
  return (
    req.headers.get("x-omg-session-id") ?? req.headers.get("x-lfg-session-id") ?? null
  );
}

/** The one response path for a previously committed session-creation key. */
async function replaySessionCreation(record: ManagedSession): Promise<Response> {
  const active = listManaged().find((row) => row.tmuxName === record.tmuxName);
  let session = null;
  try {
    if (active)
      session = managedLaunchRow(active, await readTitleOverrides(), userAssignments());
  } catch {}
  return json({
    ok: true,
    tmuxName: record.tmuxName,
    cwd: record.cwd,
    sessionId: record.sessionId,
    agent: record.agent,
    session,
    parentSessionId: record.parentSessionId ?? null,
    worktree: record.worktreeBranch ? record.cwd : null,
    sessionUrl: record.sessionId ? publicSessionUrl(record.sessionId) : null,
    replayed: true,
  });
}

type CloseOutcome = { ok: true; mode: string } | { ok: false; status: number; reason: string };

// A closed session's agent, tmux pane, and browser are all stopped above (see
// closeLiveSession) — but a dev server the agent started inside its worktree
// (`expo start`, `vite dev`, ...) is none of those three, and nothing else
// ever reaped it. That is exactly the leak the Storage panel surfaces as
// "N closed sessions" holding hundreds of MB with "those keep running until
// something reclaims them". This is that reclaim, run automatically at the
// one place every close already funnels through, instead of waiting on an
// operator to notice the panel.
//
// findSessionDevServerPids does the identification (env/cgroup/cwd
// inheritance — see src/session-usage.ts) and is read-only; killing is this
// function's job alone, and it only ever signals pids that scan already
// attributed to THIS managed name. A dev server on a shared port, or one
// started by hand in the same worktree, carries none of lfg's session env
// and is never in that list.
//
// SIGTERM is sent and waited for here (cheap: no processes, or a few, per
// close). The SIGKILL follow-up runs on an unref'd timer instead of being
// awaited, so archiveIdleDurableAgentsForMemory's reclaim-under-pressure loop
// (which checks available memory again right after each close) is never
// blocked on a dev server's shutdown grace period.
async function reapSessionDevServers(managedName: string): Promise<void> {
  const targets = await findSessionDevServerPids(managedName).catch(() => []);
  if (!targets.length) return;
  console.log(
    `[close] reaping ${targets.length} dev server(s) for ${managedName}: ${targets.map((t) => t.label).join(", ")}`,
  );
  for (const { pid } of targets) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  setTimeout(() => {
    for (const { pid } of targets) {
      try {
        process.kill(pid, 0); // still alive?
      } catch {
        continue; // exited on its own within the grace window
      }
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
  }, 3000).unref();
}

// Tear down one live session. Shared by every teardown caller in this file
// (the single-session /close route, memory-pressure reclaim, bot rotation,
// session-continue archival, and more) so they all take the exact same path
// (harness shutdown command, tmux teardown, pid tombstone, registry cleanup).
async function closeLiveSession(
  sess: Session,
  id: string,
  closeLog: Record<string, unknown>,
): Promise<CloseOutcome> {
  persistManagedResume(sess);
  // Reap headless Chrome for this managed name before killing the agent.
  // agent-browser daemons reparent under user systemd and outlive tmux/harness
  // exit; idle timeout is the backstop, this is the explicit teardown path.
  closeAgentBrowserSession(sess.tmuxName);
  if (usesCommandFileRuntime(sess.agent, sess.runtime)) {
    // Ask the harness to shut down, then tear down its supervisor pane and
    // control-plane files. markClosed tombstones the harness pid so the
    // session drops out of the list immediately. For codex-aisdk the
    // live-view id is the threadId — map it back to the key the command
    // file and registry entry are named by.
    const entry = findAisdkEntryByAnyId(id);
    const key = entry?.sessionId ?? id;
    appendAisdkCmd(key, { type: "close" });
    if (entry) {
      wakeHarnessCommandReader(entry);
      // Return as soon as the harness exits. Old harnesses have no wake
      // capability and keep their 250 ms command poll; the 300 ms bound still
      // preserves the previous force-stop behavior for a stuck SDK close.
      await waitForHarnessExit(entry.harnessPid);
    }
    if (entry && isAisdkPidAlive(entry.harnessPid)) {
      if (entry.supervisor === "process") terminateHarnessProcess(entry);
      else if (sess.tmuxName) tmuxKillSession(sess.tmuxName);
    } else if (!entry?.supervisor && sess.tmuxName) {
      tmuxKillSession(sess.tmuxName);
    }
    markClosed(sess.pid);
    removeAisdkEntry(key);
    if (sess.tmuxName) {
      removeManaged(sess.tmuxName);
      assignUser(sess.tmuxName, null);
    }
    clearResolved(id);
    invalidateListSessionsCache();
    // Command-file sessions are always lfg-launched (no "attached to someone
    // else's process" case exists for this runtime), so tmuxName alone is a
    // safe key here — see the sess.managed gate on the tmux path below for why
    // that one is stricter.
    if (sess.tmuxName) await reapSessionDevServers(sess.tmuxName);
    evlog("session_close_done", {
      ...closeLog,
      agent: sess.agent,
      tmuxName: sess.tmuxName,
      managed: sess.managed,
      mode: "harness",
    });
    return { ok: true, mode: "harness" };
  }
  if (!sess.tmuxTarget) {
    evlog("session_close_rejected", {
      ...closeLog,
      agent: sess.agent,
      tmuxName: sess.tmuxName,
      managed: sess.managed,
      reason: "no_tmux_target",
    });
    return { ok: false, status: 409, reason: "session is not in a tmux pane — cannot close" };
  }
  // A session lfg started owns its whole tmux session (one managed
  // claude, no sibling panes) — kill the session and deregister it.
  // Attached sessions might share a tmux session with the user's other
  // panes, so only kill the one pane.
  const killed =
    sess.managed && sess.tmuxName ? tmuxKillSession(sess.tmuxName) : tmuxKillPane(sess.tmuxTarget);
  if (!killed) {
    evlog("session_close_failed", {
      ...closeLog,
      agent: sess.agent,
      tmuxName: sess.tmuxName,
      managed: sess.managed,
    });
    return { ok: false, status: 502, reason: "close failed" };
  }
  // Tombstone the pid so the session drops out of listSessions() at once
  // — the process lingers briefly after the SIGHUP and would otherwise
  // flicker back for a poll or two before pgrep stops seeing it.
  markClosed(sess.pid);
  if (sess.managed && sess.tmuxName) {
    if (sess.agent === "codex") {
      const tp = await resolveTranscript(id).catch(() => null);
      const nativeSessionId =
        sess.nativeSessionId ??
        tp?.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/)?.[0];
      patchManaged(sess.tmuxName, { launchState: "running", nativeSessionId });
    } else {
      removeManaged(sess.tmuxName);
    }
    assignUser(sess.tmuxName, null); // a managed name is unique + now gone
  }
  clearResolved(id);
  invalidateListSessionsCache();
  // Only for a session lfg itself started and owns the whole tmux session
  // for (sess.managed) — an attached session may be a tmux pane the user was
  // already running by hand, and lfg never started anything inside it that
  // needs reclaiming.
  if (sess.managed && sess.tmuxName) await reapSessionDevServers(sess.tmuxName);
  const mode = sess.managed && sess.tmuxName ? "tmux_session" : "tmux_pane";
  evlog("session_close_done", {
    ...closeLog,
    agent: sess.agent,
    tmuxName: sess.tmuxName,
    managed: sess.managed,
    mode,
  });
  return { ok: true, mode };
}

// A Cloud Computer may wake with several completed command-file harnesses
// restored from RAM. They are durable but still resident, so treating them as
// neither active nor reclaimable makes the next launch impossible. On memory
// pressure, archive the oldest idle durable harnesses through the normal close
// owner until the launch budget is healthy: each transcript is indexed for
// Resume before its process is stopped. Busy, launching, and process-bound
// sessions are never touched.
//
// Neither are persistent ones. The selection is memoryReclaimCandidates — see
// src/idle-archive.ts.
async function archiveIdleDurableAgentsForMemory(): Promise<number> {
  const candidates = memoryReclaimCandidates(await listSessions());
  let archived = 0;
  for (const session of candidates) {
    const sessionId = session.sessionId as string;
    const outcome = await closeLiveSession(session, sessionId, {
      sessionId,
      source: "computer_memory_reclaim",
    });
    if (!outcome.ok) continue;
    archived++;
    const memory = agentLaunchMemoryBudget(totalmem(), hostAvailableMemoryBytes());
    if (memory.availableBytes >= memory.reserveBytes + memory.launchBytes) break;
  }
  return archived;
}

const BOT_COMPACTION_SWEEP_MS = 15_000;
let botCompactionTimer: ReturnType<typeof setInterval> | null = null;
let botCompactionRunning = false;

/** Check measured context usage and rotate eligible persistent bots. */
export async function checkBotCompactionOnce(now = Date.now()): Promise<number> {
  const global = getGlobalSettingsSync();
  const defaults = defaultBotCompactionSettings();
  const threshold = global.botCompactionThresholdPercent;
  const settings = {
    ...defaults,
    enabled: global.botAutoCompactionEnabled,
    thresholdPercent: threshold,
    // Keep a real hysteresis gap even when the operator lowers the threshold.
    rearmPercent: Math.min(defaults.rearmPercent, threshold - 10),
  };
  const [bots, sessions] = await Promise.all([listBots(), listSessions().catch(() => [])]);
  let rotated = 0;
  for (const bot of bots) {
    if (!bot.enabled || bot.rotationState === "rotating" || bot.rotationState === "failed") continue;
    if (bot.rotationState === "queued" && bot.rotationReason === "config") continue;

    if (bot.rotationState === "queued" && bot.rotationReason === "restart") {
      const outcome = await rotateBotSession(bot.id, {
        reason: "restart",
        expectedRuntimeSessionId: bot.rotationExpectedSessionId,
      });
      if (outcome.ok && outcome.rotated) rotated++;
      continue;
    }

    if (bot.rotationState === "queued" && bot.rotationReason === "compaction") {
      const outcome = await rotateBotSession(bot.id, { reason: "compaction" });
      if (outcome.ok && outcome.rotated) rotated++;
      continue;
    }

    const primary = findBotMainSession(bot, sessions);
    const sessionId = primary?.sessionId ?? bot.sessionId?.trim();
    if (!sessionId) continue;
    const transcriptPath = await resolveTranscript(sessionId).catch(() => null);
    const usage = await sessionTokenUsage(sessionId, transcriptPath);
    const decision = botCompactionDecision({ usage, bot, settings, now });
    if (decision.armed !== (bot.compactionArmed !== false)) {
      mutateBot(bot.id, (current) => ({ ...current, compactionArmed: decision.armed }));
    }
    if (!decision.rotate) continue;
    const outcome = await rotateBotSession(bot.id, { reason: "compaction" });
    if (outcome.ok && outcome.rotated) rotated++;
  }
  return rotated;
}

export function startBotCompactionSweep(): void {
  if (botCompactionTimer) return;
  botCompactionTimer = setInterval(() => {
    if (botCompactionRunning) return;
    botCompactionRunning = true;
    void checkBotCompactionOnce()
      .catch((error) => console.error(`[bot-compaction] ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => {
        botCompactionRunning = false;
      });
  }, BOT_COMPACTION_SWEEP_MS);
  botCompactionTimer.unref?.();
}

type ParentableSession = {
  sessionId?: string | null;
  nativeSessionId?: string | null;
  parentSessionId?: string | null;
  parentNativeSessionId?: string | null;
};

function sessionMatchesId(session: ParentableSession, id: string): boolean {
  return session.sessionId === id || session.nativeSessionId === id;
}

/**
 * How an inbound /send reaches its target.
 *
 * `steer` interrupts the running turn, which is right for a human correcting an
 * agent mid-flight and wrong for a background child reporting home. A bot's
 * backing session is a conversation someone is reading in real time: a
 * `[subagent progress]` update steering into it cuts the bot off mid-reply, and
 * the human sees their answer truncated by machinery they never asked about.
 *
 * So an agent-authored update (it carries `fromSessionId`) into a persistent
 * session always queues — it waits its turn like any other message. A human
 * sending to the same session keeps steer, because interrupting is the whole
 * point of the composer's Enter key.
 */
/**
 * Say who an inbound agent message is from.
 *
 * A human's message to a bot has always carried `[Message from <who> to bot
 * <name>]`. An agent's did not, so a bot running two background tasks got two
 * anonymous `[subagent complete] …` reports and could not tell which was which
 * — it had to hope the child described its own work well enough to be
 * identifiable. Hermes tags every inbound bot-to-bot message with its sender
 * for exactly this reason.
 *
 * The wrapper goes on the same envelope seam the human path uses, and the bot
 * chat hides it the same way. Only for persistent (bot) targets: a task session
 * receiving a child's report is reading a log, where the parenthetical would be
 * noise, and its transcript already renders the sender.
 */
export function attributedAgentUpdate(
  text: string,
  from: { fromSessionId?: string; senderTitle?: string | null; targetPersistent?: boolean },
): string {
  if (!from.fromSessionId || !from.targetPersistent) return text;
  const title = (from.senderTitle ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const who = title
    ? `${title} · ${shortSessionId(from.fromSessionId)}`
    : shortSessionId(from.fromSessionId);
  return `[Background task ${who}]\n\n${text}`;
}

export function agentUpdateSendMode(
  requested: "steer" | "queue" | undefined,
  target: { fromSessionId?: string; targetPersistent?: boolean },
): "steer" | "queue" {
  if (target.fromSessionId && target.targetPersistent) return "queue";
  return requested === "queue" ? "queue" : "steer";
}

function sessionParentId(session: ParentableSession): string | undefined {
  return session.parentSessionId ?? session.parentNativeSessionId ?? undefined;
}

function childSubagentDepth(parent: ParentableSession, sessions: ParentableSession[]): number {
  let depth = 1;
  let cursor: ParentableSession | undefined = parent;
  const seen = new Set<string>();
  while (cursor) {
    const parentId = sessionParentId(cursor);
    if (!parentId || seen.has(parentId)) break;
    seen.add(parentId);
    depth++;
    cursor = sessions.find((session) => sessionMatchesId(session, parentId));
  }
  return depth;
}

export function withOmgSubagentContract(
  prompt: string | undefined,
  opts: { parentSessionId?: string; depth?: number | null },
): string {
  const depthText = opts.depth ? ` Current child depth: ${opts.depth}/${MAX_LFG_SUBAGENT_DEPTH}.` : "";
  // Short (8-char) id: the MCP layer resolves any unambiguous id prefix back to
  // the full session id, so the child never needs the whole uuid.
  //
  // The tool names here are the `omg_*` ones the server actually registers. They
  // used to be spelled `lfg_*`: inbound calls under that name are still aliased
  // at the wire (rewriteLegacyToolCall), but a name that appears in no tool
  // catalog is not something a model can call — it has to guess the real one
  // first. Naming an unlisted tool in the one instruction that carries a child's
  // result home is how background work reports nothing and looks like silence.
  const parentLine = opts.parentSessionId
    ? `- Parent session id: ${shortSessionId(opts.parentSessionId)}. Send progress and terminal-state updates there with MCP tool \`omg_send_session_message\`.`
    : "- No parent session id was supplied. If one becomes available, send progress and terminal-state updates there.";
  const reportLines = opts.parentSessionId
    ? [
        "- Send at least one `[subagent progress]` message when you begin substantive work, then again whenever you make meaningful progress, hit a blocker, or delegate work to another child.",
        "- Before ending, send exactly one terminal-state message to the parent: `[subagent complete]`, `[subagent blocked]`, or `[subagent failed]`. Include what changed, verification run, and what remains.",
      ]
    : [
        "- If no parent session id becomes available, include progress and terminal state in your final response instead of sending a parent update.",
      ];
  return [
    "=== LFG SUBAGENT OPERATING CONTRACT ===",
    "- You are an LFG-managed subagent.",
    "- For any further delegation, use the omg.dev MCP tools (`omg_create_subagent` or `omg_delegate_*`) instead of generic or harness-native subagent/delegation tools.",
    `- Nested LFG subagents are allowed only through depth ${MAX_LFG_SUBAGENT_DEPTH}.${depthText} Do not create another child if it would exceed this limit.`,
    parentLine,
    ...reportLines,
    "=== USER TASK ===",
    (prompt ?? "").trim() || "No task prompt was provided.",
  ].join("\n");
}

// Attach rendered markdown for assistant/user prose; tool/thinking stay raw.
type HtmlMessage = { kind: string; text: string; html?: string };
const messageHtmlCache = new Map<string, string>();
const MESSAGE_HTML_CACHE_MAX = 4_000;

function messageHtmlCacheKey(m: HtmlMessage): string {
  const id = "id" in m && typeof m.id === "string" ? m.id : "";
  return `${id}\0${m.kind}\0${m.text.length}\0${m.text.slice(0, 96)}`;
}

function rememberMessageHtml(key: string, html: string) {
  if (messageHtmlCache.has(key)) messageHtmlCache.delete(key);
  messageHtmlCache.set(key, html);
  if (messageHtmlCache.size <= MESSAGE_HTML_CACHE_MAX) return;
  const oldest = messageHtmlCache.keys().next().value;
  if (oldest) messageHtmlCache.delete(oldest);
}

function msgWithHtml<T extends HtmlMessage>(m: T) {
  if (m.kind === "text" && m.text) {
    const key = messageHtmlCacheKey(m);
    const cached = messageHtmlCache.get(key);
    if (cached !== undefined) return { ...m, html: cached };
    const html = marked.parse(m.text) as string;
    rememberMessageHtml(key, html);
    return { ...m, html };
  }
  return m;
}

function withImageArtifacts<T extends { role: string; kind: string; text: string; ts?: number | null; id?: string | null }>(
  _sessionId: string,
  messages: T[],
): Array<T | ImageArtifactMessage> {
  return collapseArtifactRetryMessages(
    messages.map((message) => hydrateImageArtifactMessage(message as unknown as SessionMsg) as T | ImageArtifactMessage),
  );
}

function transcriptMessagesForClient<T extends { role: string; kind: string; text: string; ts?: number | null; id?: string | null }>(
  sessionId: string,
  messages: T[],
  opts: { deferToolArgs?: boolean } = {},
): Array<T | ImageArtifactMessage> {
  const visible = withImageArtifacts(sessionId, visibleTranscriptMessages(messages));
  return opts.deferToolArgs ? deferToolUseArgs(visible) : visible;
}

// The live half of transcriptMessagesForClient. A streamed message needs the
// same two wire filters, but not the artifact hydration: artifacts arrive on
// their own subscription, already hydrated.
function liveTranscriptMessagesForClient<T extends { kind: string; text: string }>(
  messages: T[],
  opts: { deferToolArgs?: boolean } = {},
): T[] {
  const visible = visibleTranscriptMessages(messages);
  return opts.deferToolArgs ? (deferToolUseArgs(visible) as T[]) : visible;
}

// The `deferToolArgs` capability, as a query parameter.
//
// Additive and optional, the same way `rows` is: without it the payload is the
// old one, byte for byte, so an older client keeps its exact behaviour. This
// is a property of the CONNECTION, not of the server, which is why there is no
// environment variable and no configuration for it.
function requestedDeferToolArgs(url: URL): boolean {
  return url.searchParams.get("deferToolArgs") === "1";
}

// Rows as the client will count them: the shared row model applied to the
// exact message list this endpoint sends, after tool_result and artifact
// hydration have already changed it.
function clientRowCounter(sessionId: string): (messages: SessionMsg[]) => number {
  return (messages) => countTranscriptRows(transcriptMessagesForClient(sessionId, messages));
}

// How many rendered rows a live backlog aims for. 40 raw messages were two
// rows on a tool-heavy session, which is a blank card.
const LIVE_BACKLOG_ROWS = 24;
// Ceiling for the same backlog in raw messages. One connection opens a backlog
// per expanded pane, so this keeps the first frame small; the reader pages
// further back over HTTP, which has the larger ceiling.
const LIVE_BACKLOG_MAX_MESSAGES = 400;

// `rows` asks for a page measured in rendered rows instead of raw messages. It
// is optional: a client that omits it gets exactly the old raw-message page.
export function requestedRows(url: URL): number | null {
  const raw = url.searchParams.get("rows");
  if (raw == null) return null;
  const rows = parseInt(raw, 10);
  if (!Number.isFinite(rows) || rows <= 0) return null;
  return Math.min(500, rows);
}

type DraftState = { id: string; text: string };

type AiTextDeltaPart = {
  type: "text-delta";
  id: string;
  delta?: string;
  text?: string;
  reset?: boolean;
  ts: number;
};

function sendAiTextDeltaPart(
  send: (s: string) => void,
  sid: string,
  entry: { sessionId: string; draftText?: string | null; draftUpdatedAt?: number | null },
  lastDraft: Map<string, DraftState>,
  wrapSid: boolean,
): void {
  const id = `draft-${entry.sessionId}`;
  const text = entry.draftText ?? "";
  const prev = lastDraft.get(sid);
  if (!text) {
    if (prev) lastDraft.delete(sid);
    return;
  }
  let part: AiTextDeltaPart;
  if (!prev || prev.id !== id || !text.startsWith(prev.text)) {
    part = { type: "text-delta", id, text, reset: true, ts: entry.draftUpdatedAt ?? Date.now() };
  } else {
    const delta = text.slice(prev.text.length);
    if (!delta) return;
    part = { type: "text-delta", id, delta, ts: entry.draftUpdatedAt ?? Date.now() };
  }
  lastDraft.set(sid, { id, text });
  const data = wrapSid ? { sid, part } : part;
  send(`event: ai_part\ndata: ${JSON.stringify(data)}\n\n`);
}

function interruptLiveSession(session: Session): { ok: boolean; error?: string; status?: number } {
  const sid = session.sessionId;
  if (!sid) return { ok: false, error: "live session has no id", status: 409 };
  if (session.agent === "hermes") {
    return { ok: false, error: "Hermes has been removed", status: 410 };
  }
  if (usesCommandFileRuntime(session.agent, session.runtime)) {
    const key = findAisdkEntryByAnyId(sid)?.sessionId ?? sid;
    appendAisdkCmd(key, { type: "interrupt" });
    return { ok: true };
  }
  // Jcode's line REPL buffers a complete follow-up until the active turn ends.
  // It has no separate interrupt key, so steering safely degrades to queuing.
  if (session.agent === "jcode") return { ok: true };
  if (!session.tmuxTarget)
    return { ok: false, error: "session is not in a tmux pane — cannot interrupt", status: 409 };
  if (!tmuxInterrupt(session.tmuxTarget)) return { ok: false, error: "interrupt failed", status: 502 };
  return { ok: true };
}

function sendPromptToLiveSession(
  session: Session,
  text: string,
  opts: { mode?: "steer" | "queue" } = {},
): { ok: boolean; msg?: unknown; error?: string } {
  const prompt = text.trim();
  if (!prompt) return { ok: true };
  const sid = session.sessionId;
  if (!sid) return { ok: false, error: "live session has no id" };
  if (session.agent === "hermes") return { ok: false, error: "Hermes has been removed" };
  traceLog("session_send_request", {
    sessionId: sid,
    agent: session.agent,
    mode: opts.mode ?? "steer",
    busy: !!session.busy,
    chars: prompt.length,
  });
  if ((opts.mode ?? "steer") === "steer" && session.busy) {
    const interrupted = interruptLiveSession(session);
    if (!interrupted.ok) return interrupted;
  }
  if (usesCommandFileRuntime(session.agent, session.runtime)) {
    const key = findAisdkEntryByAnyId(sid)?.sessionId ?? sid;
    patchAisdkEntry(key, { recoveredAt: null });
    if (session.tmuxName) patchManaged(session.tmuxName, { interruptedAt: undefined });
    appendAisdkCmd(key, { type: "send", text: prompt });
    traceLog("session_send_aisdk_cmd", { sessionId: sid, key, chars: prompt.length });
    return {
      ok: true,
      msg: recordCommandFileMessage(sid, prompt, !!session.busy),
    };
  }
  if (!session.tmuxTarget) return { ok: false, error: "session is not in a tmux pane — cannot send" };
  const transportPrompt = session.agent === "jcode" ? prompt.replace(/\s+/g, " ").trim() : prompt;
  return {
    ok: true,
    msg: enqueueMessage(sid, transportPrompt, {
      // Jcode's REPL buffers a complete stdin line while its current turn is
      // active. It accepted the line, but the agent has not read it yet.
      queuedBehindTurn: session.agent === "jcode" && !!session.busy,
    }),
  };
}

/** Avatar geometry is a closed set — anything else would render as no creature at all. */
function readBotAvatar(
  body: { shape?: unknown; colorway?: unknown } | null,
): { shape?: BotShape; colorway?: BotColorway } | { error: string } {
  const shape = typeof body?.shape === "string" ? body.shape.trim() : undefined;
  const colorway = typeof body?.colorway === "string" ? body.colorway.trim() : undefined;
  if (shape && !BOT_SHAPES.includes(shape as BotShape))
    return { error: `unknown bot shape "${shape}" (expected one of ${BOT_SHAPES.join(", ")})` };
  if (colorway && !BOT_COLORWAYS.includes(colorway as BotColorway))
    return { error: `unknown bot colorway "${colorway}" (expected one of ${BOT_COLORWAYS.join(", ")})` };
  return { shape: shape as BotShape | undefined, colorway: colorway as BotColorway | undefined };
}

function validateBotAgent(
  agentValue: string | undefined,
  model: string | undefined,
  thinkingLevel: string | undefined,
): { agent: NonNullable<ReturnType<typeof resolveActiveSessionAgent>> } | { error: string } {
  const agent = resolveActiveSessionAgent(agentValue || "aisdk");
  if (!agent) return { error: `unknown coding agent "${agentValue ?? ""}"` };
  if ((agent === "aisdk" || agent === "grok" || agent === "pi" || agent === "copilot") && model) {
    const allowed = modelsForAgent(agent);
    if (!allowed.includes(model))
      return { error: `unknown model "${model}" (expected one of ${allowed.join(", ")})` };
  }
  if (agent === "codex-aisdk" && model && !/^[A-Za-z0-9_.:-]{1,80}$/.test(model))
    return { error: "invalid codex model name" };
  if ((agent === "cursor" || agent === "opencode" || agent === "fx") && model && !/^[A-Za-z0-9_.:\/-]{1,120}$/.test(model))
    return { error: `invalid ${agent} model name` };
  if (agent === "jcode" && model && !/^[A-Za-z0-9_.:\/\-[\],=]{1,160}$/.test(model))
    return { error: "invalid jcode model name" };
  if (thinkingLevel) {
    const allowed = thinkingLevelsForAgent(agent);
    if (!allowed) return { error: `thinkingLevel is not supported for ${agent} bots` };
    if (!allowed.includes(thinkingLevel))
      return { error: `unknown thinking level "${thinkingLevel}" for ${agent} (expected one of ${allowed.join(", ")})` };
  }
  return { agent };
}

async function botContinuitySummary(sessionId: string): Promise<string | null> {
  try {
    const transcript = await resolveTranscript(sessionId) ?? sessionIndexKey(sessionId);
    const page = await indexedMessagePage(transcript, sessionId, { limit: 40 });
    const lines = page.messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .slice(-24)
      .map((message) => {
        const text = message.text.replace(/\s+/g, " ").trim().slice(0, 600);
        return text ? `${message.role}: ${text}` : "";
      })
      .filter(Boolean);
    if (!lines.length) return null;
    return lines.join("\n").slice(-10_000);
  } catch {
    return null;
  }
}

/**
 * Resolve the live backing session for a bot, launching one if it is gone.
 *
 * `firstMessage` is delivered *inside the launch prompt* rather than sent
 * after it. Sending separately raced the boot: the agent batched the setup
 * envelope and the message into one turn and answered neither. Bundling makes
 * the first turn well-defined, and `delivered` tells the caller not to send
 * the message a second time.
 */
async function ensureBotSession(
  bot: Bot,
  firstMessage?: string,
): Promise<{ session: Session; delivered: boolean } | Response> {
  const sessions = await listSessions();
  const live = findBotMainSession(bot, sessions);
  if (live) {
    // Heal a record an older broad `botId` match rebound to a delegated child,
    // so the corrupt id stops being handed to the next reader.
    const conversationId = bot.conversationId?.trim() || live.conversationId?.trim() || bot.sessionId?.trim();
    if (
      live.sessionId &&
      (live.sessionId !== bot.sessionId || (conversationId && conversationId !== bot.conversationId))
    ) {
      await updateBot(bot.id, { sessionId: live.sessionId, conversationId });
    }
    return { session: live, delivered: false };
  }
  // botConversationRef repairs a saved id that names one of this bot's own
  // subagents, recovering the conversation the human has actually been talking
  // to instead of resuming a delegated task's thread.
  return launchBotSession(bot, {
    conversationId: bot.conversationId?.trim() || botConversationRef(bot, sessions).sessionId,
    runtimeSessionId: botConversationRef(bot, sessions).sessionId,
    firstMessage,
  });
}

/**
 * Start one backing process for a bot and bind the record to it.
 *
 * Split out of `ensureBotSession` so cold start and rotation cannot drift.
 * They differ in exactly two ways — which conversation id the process attaches
 * to, and what continuity material rides in the launch prompt — and everything
 * else (agent validation, repo resolution, the activation gate, account
 * picking, the managed-registry rows, user assignment, the spawn, the binding
 * write) is identical. Two copies of that would be two places to forget
 * `assignUser`, and the first Scout session already went missing once for
 * exactly that reason.
 *
 * Rotation changes `runtimeSessionId` while preserving `conversationId`.
 * Cold restart preserves both. The two ids were historically the same, so an
 * old bot record is migrated by treating its saved session id as both values.
 */
async function launchBotSession(
  bot: Bot,
  opts: {
    /** Durable product conversation. */
    conversationId?: string;
    /** Runtime transcript/provider thread. Omitted mints a fresh runtime. */
    runtimeSessionId?: string;
    /** Rotation commits the binding itself after all preparation succeeds. */
    bindRecord?: boolean;
    /** Keep the old primary live while a replacement is prepared. */
    preserveExistingPrimary?: boolean;
    /** Revision loaded into this runtime's launch contract. */
    appliedConfigRevision?: number;
    /** Pre-rendered blocks injected after the contract, in order. */
    injectedBlocks?: readonly string[];
    /** Skip the automatic prior-conversation summary (rotation brings its own). */
    skipContinuity?: boolean;
    firstMessage?: string;
  } = {},
): Promise<{ session: Session; delivered: boolean } | Response> {
  const firstMessage = opts.firstMessage;
  const config = validateBotAgent(bot.agent, bot.model, bot.thinkingLevel);
  if ("error" in config) return err(400, config.error);
  const repos = await listRepos();
  const repo = bot.cwd
    ? repos.find((item) => item.cwd === bot.cwd)
    : (repos.find((item) => item.cwd === SELF_REPO) ?? repos[0]);
  if (!repo) return err(400, bot.cwd ? "unknown repo" : "no repo is available");

  const gate = await activationGate({ kind: "bot" });
  if (gate instanceof Response) return gate;
  try {
    const agent = config.agent;
    const selectedClaudeAccount = agent === "aisdk"
      ? await pickClaudeAccountForNewSession({
          readCapacity: (account) => getProviderUsage(`claude:${account.id}`),
        })
      : null;
    const claudeAccountId = selectedClaudeAccount?.id;
    const resolvedModel = resolveModelForAgent(agent, bot.model, bot.thinkingLevel);
    const launchModel = agent === "grok"
      ? resolvedModel ?? GROK_DEFAULT_MODEL()
      : agent === "cursor" || agent === "jcode" || agent === "copilot" || agent === "fx"
        ? resolvedModel ?? "auto"
        : agent === "opencode"
          ? resolvedModel ?? defaultModelForAgent("opencode")
          : agent === "codex-aisdk"
            ? resolvedModel ?? "gpt-5.5"
            : agent === "aisdk"
              ? resolvedModel ?? "opus"
              : agent === "pi"
                ? resolvedModel ?? PI_DEFAULT_MODEL
                : resolvedModel;
    const legacyId = bot.sessionId?.trim();
    const sessionId = opts.runtimeSessionId?.trim() || crypto.randomUUID();
    const conversationId = opts.conversationId?.trim() || bot.conversationId?.trim() || legacyId || sessionId;
    const durableConversation = ensureBotConversation({
      conversationId,
      bot,
      ownerIdentity: bot.owner,
      roster: userRoster(),
    });
    const botParticipant = durableConversation.participants.find((row) => row.id === botParticipantId(bot.id));
    upsertConversationParticipant(
      conversationId,
      conversationBotParticipant(bot, {
        role: botParticipant?.role,
        joinedAt: botParticipant?.joinedAt,
        historyAccess: botParticipant?.historyAccess,
      }),
    );
    // aisdk decides resume-vs-fresh by asking the index itself
    // (sessionHasIndexedMessages, aisdk-session.ts), so reusing the id restores
    // the model's own thread too and a summary would only repeat what it can
    // already read. Every other harness gets the summary, because for them the
    // reused id restores what the *human* sees but not what the model recalls.
    const resumesOwnThread = agent === "aisdk" && sessionHasIndexedMessages(sessionId);
    // Claude files conversations under a cwd-derived directory. A bot whose
    // repo changed, or whose file was pruned, would otherwise fail its resume
    // and answer with a harness error instead of a sentence.
    if (resumesOwnThread) {
      try {
        ensureConversationVisibleFrom(repo.cwd, sessionId);
      } catch {}
    }
    // Summarize the repaired conversation, never the corrupt id: a bot rebound
    // to its own subagent would otherwise be reintroduced to that task's
    // transcript as if it were its own history.
    const continuity = !opts.skipContinuity && !resumesOwnThread && legacyId
      ? await botContinuitySummary(legacyId)
      : null;
    const prompt = [
      // Regenerated from the bot record on every launch, which is the whole
      // reason a config change needs a new session: this text is read once, at
      // boot, and nothing can revise it afterwards.
      botRuntimeContract(bot.name, bot.persona, {
        awaitingFirstMessage: !firstMessage,
        description: bot.description,
        capabilities: bot.capabilities,
        maxBotSchedules: getGlobalSettingsSync().maxBotSchedules,
      }),
      continuity ? `=== PRIOR CONVERSATION SUMMARY ===\n${continuity}\n=== END PRIOR CONVERSATION SUMMARY ===` : "",
      ...(opts.injectedBlocks ?? []),
      firstMessage ?? "",
    ].filter(Boolean).join("\n\n");
    if (!opts.preserveExistingPrimary) {
      for (const stale of listManaged().filter((row) =>
        row.botId === bot.id &&
        !row.parentSessionId &&
        !row.parentNativeSessionId &&
        row.spawnedBy !== "subagent"
      )) {
        removeManaged(stale.tmuxName);
        assignUser(stale.tmuxName, null);
      }
    }
    const tmuxName = `lfg-${randomBytes(3).toString("hex")}`;
    const createdAt = Date.now();
    addManaged({
      tmuxName,
      cwd: repo.cwd,
      createdAt,
      agent,
      runtime: CODING_AGENT_ADAPTERS[agent].transport,
      sessionId,
      nativeSessionId: agent === "aisdk" || agent === "opencode" ? sessionId : undefined,
      launchState: "launching",
      model: launchModel,
      thinkingLevel: bot.thinkingLevel,
      claudeAccountId,
      title: bot.name,
      project: repo.project,
      spawnedBy: "bot",
      conversationId,
      appliedConfigRevision: opts.appliedConfigRevision ?? botConfigRevision(bot),
      botId: bot.id,
      persistent: true,
    });
    // Attach provisionally before the harness can write its launch turn. This
    // gives transcript indexing a verified bot author without selecting this
    // runtime as the product surface before startup succeeds.
    attachRuntimeSession({
      conversationId,
      sessionId,
      participantId: botParticipantId(bot.id),
      kind: "execution",
      attachedAt: createdAt,
    });
    // Tag before spawn, same as /api/sessions/new: an unassigned bot session is
    // invisible under the rail's default per-user filter, which is exactly how
    // the first Scout session went missing.
    if (bot.owner) assignUser(tmuxName, bot.owner);
    invalidateListSessionsCache();
    const launched = launchCodingAgentSession({
      agent,
      name: tmuxName,
      cwd: repo.cwd,
      prompt,
      model: launchModel,
      thinkingLevel: bot.thinkingLevel,
      sessionId,
      omgUser: bot.owner,
      containInAgentSlice: true,
      claudeAccountId,
    });
    if (!launched.ok) {
      removeManaged(tmuxName);
      assignUser(tmuxName, null);
      detachRuntimeSession(conversationId, sessionId);
      return err(502, launched.error || "failed to start bot session");
    }
    if (launched.nativeSessionId) patchManaged(tmuxName, { nativeSessionId: launched.nativeSessionId });
    if (CODING_AGENT_ADAPTERS[agent].transport === "command-file")
      patchManaged(tmuxName, { launchState: "running" });
    if (opts.bindRecord !== false) {
      const attached = replaceConversationPrimaryRuntime({
        conversationId,
        sessionId,
        participantId: botParticipantId(bot.id),
        attachedAt: createdAt,
      });
      if (!attached) {
        removeManaged(tmuxName);
        assignUser(tmuxName, null);
        detachRuntimeSession(conversationId, sessionId);
        return err(502, "bot conversation could not attach the runtime");
      }
      const saved = await updateBot(bot.id, {
        conversationId,
        sessionId,
        appliedConfigRevision: opts.appliedConfigRevision ?? botConfigRevision(bot),
      });
      if (!saved) return err(404, "bot not found");
    }
    invalidateListSessionsCache();
    const record = listManaged().find((row) => row.tmuxName === tmuxName);
    const row = record
      ? managedLaunchRow(record, await readTitleOverrides(), userAssignments())
      : null;
    if (!row) return err(502, "bot session did not become available");
    return { session: row, delivered: !!firstMessage };
  } finally {
    gate.release();
  }
}

// ---------------------------------------------------------------------------
// Bot session rotation
// ---------------------------------------------------------------------------

/**
 * Commit-ish and link-ish references worth naming in a handoff.
 *
 * Deliberately high-precision and low-recall. A checkpoint that invents context
 * is worse than one that omits it, because the bot will state the invention as
 * fact on its first turn.
 */
function extractCheckpointArtifacts(turns: readonly CheckpointTurn[]): string[] {
  const found: string[] = [];
  const push = (value: string) => {
    if (value && !found.includes(value)) found.push(value);
  };
  for (const turn of turns) {
    for (const url of turn.text.match(/https?:\/\/[^\s)>\]]+/g) ?? []) push(url);
    for (const ref of turn.text.match(/\B#\d{1,6}\b/g) ?? []) push(ref);
    for (const sha of turn.text.match(/\b[0-9a-f]{7,40}\b/g) ?? []) {
      // A run of hex that is all digits is a number, not a sha, and a 12-digit
      // timestamp would otherwise be reported as a commit.
      if (/[a-f]/.test(sha) && /\d/.test(sha)) push(sha);
    }
  }
  return found;
}

/**
 * Read a bounded tail of a conversation and assemble the handoff.
 *
 * Only user and assistant prose is eligible. Tool calls, tool results and
 * reasoning are excluded at the source rather than filtered later — they are
 * the bulk of a long session, they are the most likely place for a credential
 * or a customer record to appear, and none of them is the thread a human is
 * trying to keep.
 *
 * The structured sections are populated only from what a caller supplies. This
 * build extracts artifacts deterministically and carries the recent turns
 * verbatim-but-clamped, and leaves goals/decisions/tasks/preferences empty
 * rather than guessing them from keyword heuristics: a regex that reports
 * "durable decision: we will not use Postgres" because someone typed the words
 * produces a briefing that is confidently wrong, and the bot has no way to
 * check it. Recent turns carry the real continuity; an empty section renders as
 * nothing at all.
 */
async function buildBotHandoffCheckpoint(
  sessionId: string,
  input: { reason: BotRotationReason; configRevision: number; now: number },
): Promise<BotHandoffCheckpoint> {
  const transcript = await resolveTranscript(sessionId) ?? sessionIndexKey(sessionId);
  const page = await indexedMessagePage(transcript, sessionId, { limit: 60 });
  const turns: CheckpointTurn[] = page.messages
    .filter((message) =>
      (message.role === "user" || message.role === "assistant") &&
      (!message.kind || message.kind === "text")
    )
    .map((message) => ({
      role: message.role as "user" | "assistant",
      text: botVisibleUserText(message.text ?? ""),
      ...(message.role === "user"
        ? {
            author:
              botAuthorEmailFromText(message.text ?? "") ||
              (message.author?.kind === "legacy" ? "legacy:unknown" : undefined),
          }
        : {}),
    }))
    .filter((turn) => !!turn.text.trim());
  const sections = extractCheckpointSections(turns.slice(-CHECKPOINT_MAX_TURNS));

  return buildHandoffCheckpoint({
    sourceSessionId: sessionId,
    reason: input.reason,
    configRevision: input.configRevision,
    createdAt: input.now,
    ...sections,
    artifacts: extractCheckpointArtifacts(turns.slice(-CHECKPOINT_MAX_TURNS)),
    turns,
  });
}

export type BotRotationOutcome =
  | {
      ok: true;
      rotated: true;
      sessionId: string;
      previousSessionId: string | null;
      appliedConfigRevision: number;
    }
  | { ok: true; rotated: false; reason: "already-applied" | "already-rotated"; sessionId: string | null }
  | { ok: false; deferred: true; blocked: BotRotationBlock; children: string[] }
  | { ok: false; deferred?: false; status: number; error: string };

/**
 * Move a bot onto a brand new canonical session carrying its current config.
 *
 * The one server-owned rotation primitive. Manual apply and automatic
 * compaction both come through here, so the ordering guarantees below are
 * stated once and hold for both.
 *
 * Order is the whole design:
 *
 *  1. Serialize on the bot. Two browser tabs clicking Apply cannot produce two
 *     primaries, because the second one runs after the first has committed and
 *     then finds its revision already applied.
 *  2. Compare-and-swap the revision. A request naming a revision that is
 *     already live is a no-op *success* — the caller asked for "revision N is
 *     running" and it is, so spawning a second session to satisfy it would cost
 *     the user their thread for nothing. A request naming a revision that no
 *     longer exists is stale and is rejected so the client re-reads.
 *  3. Admit or defer. Busy primary or live delegated children means queue, not
 *     kill. The pending state is persisted so the UI can say so.
 *  4. Build the checkpoint BEFORE anything is torn down. A checkpoint failure
 *     here costs nothing: the old session is still running and still bound.
 *  5. Launch and provisionally attach the replacement while the old primary
 *     remains live. A failed spawn changes no canonical binding.
 *  6. Promote and stage the replacement binding while the old process remains
 *     live. A staging failure restores the old attachment and stops the candidate.
 *  7. Close the old primary, then finalize. A close failure rolls the staged
 *     binding back to the still-live old runtime.
 */
async function rotateBotSession(
  botId: string,
  opts: {
    reason: BotRotationReason;
    expectedRevision?: number;
    expectedRuntimeSessionId?: string | null;
  },
): Promise<BotRotationOutcome> {
  return serializeBotWork(botId, async () => {
    const bot = await getBot(botId);
    if (!bot) return { ok: false, status: 404, error: "bot not found" };

    const cas = opts.reason === "restart"
      ? runtimeRotationCompareAndSwap(bot, opts.expectedRuntimeSessionId)
      : rotationCompareAndSwap(bot, opts.expectedRevision);
    if (!cas.proceed) {
      if (cas.outcome === "already-applied" || cas.outcome === "already-rotated") {
        if (cas.outcome === "already-rotated" && bot.rotationState === "queued") {
          mutateBot(bot.id, (current) => ({
            ...current,
            rotationState: "idle",
            rotationReason: undefined,
            rotationExpectedSessionId: undefined,
            rotationError: undefined,
            rotationUpdatedAt: Date.now(),
          }));
        }
        evlog("bot_rotation_noop", {
          botId,
          reason: opts.reason,
          revision: opts.expectedRevision,
          expectedRuntimeSessionId: opts.expectedRuntimeSessionId,
        });
        return { ok: true, rotated: false, reason: cas.outcome, sessionId: bot.sessionId ?? null };
      }
      return {
        ok: false,
        status: 409,
        error: "bot configuration has changed since this request was made; re-read the bot and retry",
      };
    }

    const sessions = await listSessions();
    const primary = findBotMainSession(bot, sessions);
    const admission = botRotationAdmission(bot.id, primary, sessions, opts.reason);
    if (!admission.ready) {
      mutateBot(bot.id, (current) => ({
        ...current,
        rotationState: "queued",
        rotationReason: opts.reason,
        rotationExpectedSessionId: opts.reason === "restart" ? opts.expectedRuntimeSessionId : undefined,
        rotationError: undefined,
        rotationUpdatedAt: Date.now(),
      }));
      evlog("bot_rotation_deferred", {
        botId,
        reason: opts.reason,
        blocked: admission.blocked,
        children: admission.children.length,
      });
      return { ok: false, deferred: true, blocked: admission.blocked, children: admission.children };
    }

    // An automatic rotation waits for the queue to drain so ordering survives.
    // A restart cannot: the queue it would wait on is stuck behind the same
    // wedged turn the human is restarting to clear. It carries those sends onto
    // the replacement after the swap instead (see `carried` below).
    const queueSessionId = primary?.sessionId ?? botCanonicalSessionId(bot, sessions);
    if (queueSessionId && opts.reason !== "restart") {
      await reconcileQueued(queueSessionId).catch(() => false);
      const queueBusy = queueBlocksBotRotation(listQueue(queueSessionId));
      if (queueBusy) {
        mutateBot(bot.id, (current) => ({
          ...current,
          rotationState: "queued",
          rotationReason: opts.reason,
          rotationExpectedSessionId: opts.reason === "restart" ? opts.expectedRuntimeSessionId : undefined,
          rotationError: undefined,
          rotationUpdatedAt: Date.now(),
        }));
        return { ok: false, deferred: true, blocked: "primary-busy", children: [] };
      }
    }

    // The revision this rotation is applying. Captured before any await, and
    // used verbatim at commit time: an edit that lands WHILE the rotation runs
    // bumps configRevision again, and that newer edit is genuinely not in the
    // session being launched. Committing `botConfigRevision(current)` instead
    // would mark it applied and the user would never be offered the button.
    const targetRevision = botConfigRevision(bot);
    const previousSessionId = botCanonicalSessionId(bot, sessions);
    const conversationId =
      bot.conversationId?.trim() ||
      primary?.conversationId?.trim() ||
      previousSessionId ||
      crypto.randomUUID();
    const now = Date.now();

    mutateBot(bot.id, (current) => ({
      ...current,
      rotationState: "rotating",
      rotationReason: opts.reason,
      rotationExpectedSessionId: opts.reason === "restart" ? opts.expectedRuntimeSessionId : undefined,
      rotationError: undefined,
      rotationUpdatedAt: now,
    }));

    const fail = (status: number, error: string): BotRotationOutcome => {
      mutateBot(bot.id, (current) => ({
        ...current,
        rotationState: "failed",
        rotationReason: opts.reason,
        rotationError: error.slice(0, 400),
        rotationUpdatedAt: Date.now(),
      }));
      evlog("bot_rotation_failed", { botId, reason: opts.reason, error: error.slice(0, 200) });
      return { ok: false, status, error };
    };

    // 4. Checkpoint first, while the old session is still intact.
    let injectedBlocks: string[];
    try {
      const checkpoint = previousSessionId
        ? await buildBotHandoffCheckpoint(previousSessionId, {
            reason: opts.reason,
            configRevision: targetRevision,
            now,
          })
        : null;
      injectedBlocks = [
        ...(checkpoint && !checkpointIsEmpty(checkpoint) ? [formatHandoffCheckpoint(checkpoint)] : []),
        rotationNoticeText(opts.reason),
      ];
    } catch (error) {
      // A bot with no readable history is not a failure — it has nothing to
      // carry. A checkpoint that throws is, because it means the transcript
      // read model is unhealthy and continuing would silently drop the thread.
      return fail(
        502,
        `handoff checkpoint could not be generated: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    // 5. Prepare a fresh runtime under the same durable conversation while the
    // old primary remains live. A spawn failure therefore leaves the old bot
    // fully usable, not merely resumable from disk.
    // The checkpoint is aboard. The record and conversation binding remain unchanged
    // until the process has started successfully.
    const launched = await launchBotSession(bot, {
      conversationId,
      injectedBlocks,
      skipContinuity: true,
      bindRecord: false,
      preserveExistingPrimary: true,
      appliedConfigRevision: targetRevision,
    });
    if (launched instanceof Response) {
      const body = (await launched.json().catch(() => null)) as { error?: string } | null;
      return fail(launched.status, body?.error ?? "failed to start the replacement session");
    }
    const newSessionId = launched.session.sessionId;
    if (!newSessionId) return fail(502, "replacement session did not report an id");

    const stopReplacement = async (source: string): Promise<void> => {
      await closeLiveSession(launched.session, newSessionId, {
        sessionId: newSessionId,
        source,
        botId: bot.id,
      }).catch(() => undefined);
    };

    const attached = replaceConversationPrimaryRuntime({
      conversationId,
      sessionId: newSessionId,
      participantId: botParticipantId(bot.id),
      attachedAt: Date.now(),
    });
    if (!attached) {
      await stopReplacement("bot_rotation_attach_rollback");
      return fail(502, "replacement runtime could not attach to the bot conversation");
    }

    // 6. Stage the canonical record while the old process is still live. This
    // closes the old rollback gap: if the record write fails, no live runtime
    // has been destroyed and the old attachment can remain canonical.
    const staged = mutateBot(bot.id, (current) => ({
      ...current,
      conversationId,
      sessionId: newSessionId,
      appliedConfigRevision: targetRevision,
      configRevision: botConfigRevision(current),
      rotationState: "rotating",
      rotationReason: opts.reason,
      rotationError: undefined,
      rotationUpdatedAt: Date.now(),
    }));
    if (!staged) {
      if (previousSessionId) {
        replaceConversationPrimaryRuntime({
          conversationId,
          sessionId: previousSessionId,
          participantId: botParticipantId(bot.id),
        });
      }
      await stopReplacement("bot_rotation_record_stage_rollback");
      return fail(404, "bot not found");
    }

    // 7. Retire the old process only after its replacement is running,
    // attached, and staged. A close failure restores both durable pointers to
    // the still-live old primary before the candidate is stopped.
    if (primary?.sessionId) {
      const outcome = await closeLiveSession(primary, primary.sessionId, {
        sessionId: primary.sessionId,
        source: `bot_rotation_${opts.reason}`,
        botId: bot.id,
      });
      if (!outcome.ok) {
        replaceConversationPrimaryRuntime({
          conversationId,
          sessionId: primary.sessionId,
          participantId: botParticipantId(bot.id),
        });
        mutateBot(bot.id, (current) => ({
          ...current,
          conversationId,
          sessionId: previousSessionId ?? bot.sessionId,
          appliedConfigRevision: botAppliedConfigRevision(bot),
          rotationState: "failed",
          rotationReason: opts.reason,
          rotationError: outcome.reason.slice(0, 400),
          rotationUpdatedAt: Date.now(),
        }));
        await stopReplacement("bot_rotation_close_rollback");
        return fail(outcome.status, outcome.reason);
      }
    }

    // Undelivered sends belong to the conversation, not to the process that
    // happened to be running when they arrived. Only a restart can reach here
    // with a non-empty queue, and dropping it would make "restart now" cost the
    // user the messages they were waiting on. Reconcile first so anything the
    // old runtime did read is not sent twice, then re-address the rest in their
    // original order through the one owner of session delivery.
    if (previousSessionId && previousSessionId !== newSessionId) {
      await reconcileQueued(previousSessionId).catch(() => false);
      const carried = takeUndeliveredQueue(previousSessionId);
      for (const message of carried) {
        const sent = sendPromptToLiveSession(launched.session, message.text, { mode: "queue" });
        if (!sent.ok) {
          evlog("bot_rotation_queue_carry_failed", {
            botId,
            sessionId: newSessionId,
            error: sent.error,
          });
          break;
        }
      }
      if (carried.length) {
        evlog("bot_rotation_queue_carried", {
          botId,
          from: previousSessionId,
          to: newSessionId,
          count: carried.length,
        });
      }
    }

    // Finalize only after the new process is live and the old process has
    // retired. Session-bound edits that arrived while rotation ran remain a
    // newer configRevision, so the UI still offers their unapplied revision.
    const committed = mutateBot(bot.id, (current) => ({
      ...current,
      rotationState: "idle",
      rotationReason: undefined,
      rotationExpectedSessionId: undefined,
      rotationError: undefined,
      rotationUpdatedAt: Date.now(),
      lastRotatedAt: Date.now(),
      runtimeRefreshPending: false,
      archivedSessionIds: previousSessionId && previousSessionId !== newSessionId
        ? appendArchivedSession(current.archivedSessionIds, previousSessionId)
        : current.archivedSessionIds,
      ...(opts.reason === "compaction"
        ? { compactionArmed: false, lastCompactionAt: Date.now() }
        : {}),
    }));
    if (!committed) {
      // Deletion uses the same bot critical section, so this branch only
      // protects against a store failure. The replacement stays attached and
      // running because the staged record already names it.
      return fail(404, "bot not found");
    }

    evlog("bot_rotation_done", {
      botId,
      reason: opts.reason,
      previousSessionId,
      sessionId: newSessionId,
      conversationId,
      appliedConfigRevision: targetRevision,
      archived: committed.archivedSessionIds?.length ?? 0,
    });
    return {
      ok: true,
      rotated: true,
      sessionId: newSessionId,
      previousSessionId,
      appliedConfigRevision: targetRevision,
    };
  });
}

/**
 * Run a rotation that was deferred, if the bot is now able to take it.
 *
 * Called on the paths that already know a bot just became reachable — a human
 * message, a peer delivery — so a queued rotation lands at the first safe
 * moment instead of waiting for a poll. Returns the (possibly refreshed) bot so
 * the caller keeps using a current record.
 */
async function applyPendingBotRotation(bot: Bot): Promise<Bot> {
  // Only a rotation somebody actually asked for resumes here. A bot merely
  // sitting on an unapplied edit is left alone: "Update available" means the
  // human has not decided yet, and quietly restarting their conversation the
  // next time they say hello is precisely the surprise this design removes.
  if (bot.rotationState !== "queued") return bot;
  const reason = bot.rotationReason ?? "config";
  await rotateBotSession(bot.id, {
    reason,
    expectedRevision: reason === "config" ? botConfigRevision(bot) : undefined,
    expectedRuntimeSessionId: reason === "restart" ? bot.rotationExpectedSessionId : undefined,
  });
  // Re-read either way. A rotation that lands moves the binding; one that
  // defers again refreshes the pending state; one that fails records why.
  return (await getBot(bot.id)) ?? bot;
}

/**
 * Migrate a record written before configuration was versioned.
 *
 * An older build's `runtimeRefreshPending` is a real, unapplied user edit. It
 * has no revision attached, so it is translated into one: bump the revision so
 * the gap exists, and mark it queued so it applies the way its author expected
 * rather than silently evaporating on upgrade.
 */
function migrateLegacyBotRefreshFlag(bot: Bot): Bot {
  if (!bot.runtimeRefreshPending) return bot;
  return mutateBot(bot.id, (current) => migrateLegacyBotRotationState(current)) ?? bot;
}

/** Pure half of callerBotId, split out so the id-matching logic is testable
 *  without standing up the full session-listing machinery. */
export function resolveCallerBotId(
  sessions: Pick<Session, "sessionId" | "nativeSessionId" | "botId">[],
  sid: string | null,
): string | null {
  if (!sid) return null;
  const row = sessions.find((s) => s.sessionId === sid || s.nativeSessionId === sid);
  return row?.botId ?? null;
}

/**
 * Which bot (if any) is calling this request, from the caller-identity header
 * `mcp.ts`'s own `api()` sets on every outgoing call
 * (`X-Omg-Caller-Session-Id`). Purely ambient — never accepts a client-
 * supplied override — so a bot cannot claim to be a different bot.
 *
 * `null` means "no header" == the human/browser caller, which stays
 * unrestricted (see assertCanModifyAutoAgent): the human is always the
 * backstop over every automation, bot-owned included.
 *
 * This header is trusted at the same trust boundary as everything else on
 * this local API (no auth token anywhere on /api/* today) — not a new hole,
 * just worth naming.
 */
async function callerBotId(req: Request): Promise<string | null> {
  const sid = req.headers.get("x-omg-caller-session-id")?.trim() || null;
  if (!sid) return null;
  return resolveCallerBotId(await listSessions(), sid);
}

/**
 * The single authorization policy for touching an existing automation.
 *
 * A human/browser caller (callerBotId === null) is always admin. A bot may
 * only touch its own rows — guessing another automation's id gets a 403, not
 * a silent no-op or a content leak, because this checks the row's *actual*
 * owner, never anything the request claims.
 */
export async function assertCanModifyAutoAgent(
  agent: AutoAgent,
  callerBot: string | null,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (callerBot === null) return { ok: true };
  if (agent.owner.kind === "bot" && agent.owner.botId === callerBot) return { ok: true };
  return { ok: false, status: 403, error: "not your automation" };
}

/**
 * The single place that decides which owner a POST /api/auto/agents write ends
 * up with. Split out of the route so the migration rules are unit-testable and
 * so there is one owner of "who may set which owner," not a rule per caller.
 *
 * Two asymmetric callers share one function:
 *
 *  - A BOT caller is always forced onto itself. Any `owner` in the body is
 *    ignored outright rather than validated, so a bot can never mint or move a
 *    row for a sibling bot even if it guesses a real bot id.
 *  - A HUMAN/browser caller may name any owner. This is what makes migrating
 *    an existing user-owned schedule onto an existing bot possible at all
 *    (docs/bot-owned-automations-plan.md §8) — without it, the only way to get
 *    a bot-owned row is for the bot itself to create one from scratch, which
 *    loses the prompt history of the 38 rows already in the store.
 *
 * An ABSENT body owner means "do not touch the owner": undefined, which
 * `saveAutoAgent` resolves to the existing row's owner on an edit and to
 * `{ kind: "user" }` on a create. That tri-state is load-bearing, because
 * every existing writer (the CLI, the refine endpoint, the browser form) posts
 * no owner at all and must not silently re-home a bot's routine.
 */
export function resolveRequestedAutoAgentOwner(
  callerBot: string | null,
  requested: { kind?: unknown; botId?: unknown } | null | undefined,
):
  | { ok: true; owner: AutoAgentOwner | undefined }
  | { ok: false; status: number; error: string } {
  if (callerBot) return { ok: true, owner: { kind: "bot", botId: callerBot } };
  if (requested === undefined || requested === null) return { ok: true, owner: undefined };
  const kind = typeof requested.kind === "string" ? requested.kind.trim() : "";
  if (kind === "user") return { ok: true, owner: { kind: "user" } };
  if (kind === "bot") {
    const botId = typeof requested.botId === "string" ? requested.botId.trim() : "";
    if (!botId)
      return { ok: false, status: 400, error: "owner.botId is required for a bot-owned routine" };
    return { ok: true, owner: { kind: "bot", botId } };
  }
  return {
    ok: false,
    status: 400,
    error: `unknown owner kind "${kind}" (expected "user" or "bot")`,
  };
}

/**
 * Deliver `text` into a bot's own conversation, cold-starting its session if
 * needed. The single primitive every path that puts a message into a bot's
 * conversation goes through — a human's `/api/bots/:id/messages` POST, a
 * fired bot-owned routine, and a peer-to-peer delivery from another bot — one
 * owner of "how a message reaches a bot," not two or three.
 *
 * `mode: "queue"` (not "steer") is load-bearing here: it is what makes it safe
 * for a routine nudge or a peer message to arrive while the bot is mid-turn on
 * something else — it waits its turn instead of interrupting.
 *
 * `asFirstMessage` (default true) controls whether `text` is allowed to ride
 * along inside the launch prompt itself when the session is cold-starting.
 * Peer messages pass `false`: the envelope has to go through the durable send
 * queue every time so the caller gets back the queued message's id (needed to
 * record `queueMessageId` for the peer-message ledger), never silently folded
 * into the launch prompt where no message id exists to hand back.
 */
async function deliverBotMessage(
  bot: Bot,
  text: string,
  opts: { asFirstMessage?: boolean } = {},
): Promise<{ sessionId: string; queueMessageId?: string } | { error: string; status: number }> {
  const asFirstMessage = opts.asFirstMessage ?? true;
  const ensured = await ensureBotSession(bot, asFirstMessage ? text : undefined);
  if (ensured instanceof Response) {
    const body = (await ensured.json().catch(() => null)) as { error?: string } | null;
    return { error: body?.error ?? "failed to start bot session", status: ensured.status };
  }
  const { session, delivered } = ensured;
  let queueMessageId: string | undefined;
  if (!delivered) {
    const sent = sendPromptToLiveSession(session, text, { mode: "queue" });
    if (!sent.ok) return { error: sent.error || "failed to send bot message", status: 502 };
    const id = (sent.msg as { id?: unknown } | undefined)?.id;
    if (typeof id === "string") queueMessageId = id;
  }
  await updateBot(bot.id, {
    sessionId: session.sessionId ?? bot.sessionId,
    lastMessageAt: Date.now(),
  });
  return { sessionId: session.sessionId!, queueMessageId };
}

/**
 * A background task session reporting home to a bot whose session is gone.
 *
 * Heavy work is supposed to leave the conversation: the bot spawns a task
 * session and ends its turn. That session can easily outlive the harness
 * process behind the chat — a bot idles between turns, and the box reboots,
 * reclaims memory, or the harness dies. The report then arrived at /send,
 * found no live session, and was dropped on a 404. The work was done and the
 * human never heard about it; the child was also left running, because the
 * auto-close that follows a terminal report only runs on a successful send.
 *
 * A bot is exactly the kind of target that is *supposed* to come back, and the
 * machinery to relaunch it already exists — it is what the next human message
 * would have done. So do it here too, and let the report ride in on the launch
 * prompt the way a first message does.
 *
 * Only for agent-authored sends (the caller passes `fromSessionId`): a human
 * posting to a dead session id should still get the 404 that tells them so.
 *
 * Archived ids count as the bot. A child is told its parent's session id once,
 * at spawn, and a rotation replaces that id underneath it — so after a restart
 * or a compaction the child reports to an id the record no longer names as
 * current. Matching the archive is what lets the report land in the
 * conversation it was always meant for, and it is why a restart no longer has
 * to wait for delegated children before it can run.
 */
async function reviveBotSessionForReport(
  targetSessionId: string,
  text: string,
): Promise<{ session: Session; delivered: boolean } | null> {
  const bot = (await listBots()).find((candidate) =>
    candidate.sessionId === targetSessionId ||
    !!candidate.archivedSessionIds?.includes(targetSessionId)
  );
  if (!bot?.enabled) return null;
  const ensured = await ensureBotSession(bot, text);
  if (ensured instanceof Response) return null;
  await updateBot(bot.id, {
    sessionId: ensured.session.sessionId ?? bot.sessionId,
    lastMessageAt: Date.now(),
  });
  return ensured;
}

function liveSessionIds(sessions: Session[]): Set<string> {
  const ids = new Set<string>();
  for (const session of sessions) {
    if (session.sessionId) ids.add(session.sessionId);
    if (session.nativeSessionId) ids.add(session.nativeSessionId);
  }
  return ids;
}

// Live-session enumeration goes through pgrep (~300ms). The resumable picker
// only needs live ids to hide already-running sessions — a cosmetic filter that
// tolerates a few seconds of staleness — so cache them briefly instead of
// re-running listSessions() on every keystroke/filter change in the picker.
let cachedLiveIds: { ids: Set<string>; at: number } | null = null;
const LIVE_IDS_TTL_MS = 3000;
async function liveSessionIdsCached(): Promise<Set<string>> {
  const now = Date.now();
  if (cachedLiveIds && now - cachedLiveIds.at < LIVE_IDS_TTL_MS) return cachedLiveIds.ids;
  const ids = liveSessionIds(await listSessionsCached());
  cachedLiveIds = { ids, at: Date.now() };
  return ids;
}

function claudeOauthToken(): string | null {
  return sharedClaudeOauthToken();
}

// Compact, spoken-summary-friendly snapshot of every live session, injected into
// the voice orchestrator's spawn prompt so its FIRST reply can be a proactive
// status briefing with no tool-call round-trip. Each session is classified:
//   BLOCKED  — sitting on a permission / plan / trust selector (needs the user NOW)
//   WORKING  — mid-turn
//   IDLE     — not busy, no pending prompt
// Blocked sessions carry the prompt question + option labels so she can name what
// the user has to decide. Built BEFORE the voice session is spawned, so it never
// lists itself.
// Map a user's free-text/option answer to a deterministic action on the target
// session. This is what makes a reply reach the session immediately and
// reliably, instead of waiting for the supervisor's next run to re-interpret it.
function plannedSessionAction(answer: string): {
  kind: "close" | "send" | "none";
  text?: string;
} {
  const a = (answer ?? "").trim();
  const low = a.toLowerCase();
  if (/^(close|stop|kill|terminate|shut|end\b)/.test(low) || low === "close it")
    return { kind: "close" };
  if (/^(leave|keep|ignore|do nothing|nothing|none|no\b)/.test(low))
    return { kind: "none" };
  const text = a.replace(/^continue\s*:?\s*/i, "").trim();
  return text ? { kind: "send", text } : { kind: "none" };
}

// Best available interactive prompt for a session. Prefers a structured
// AskUserQuestion read from the transcript (exact text, survives the preview /
// multi-select / wrapped layouts the pane scraper can't follow), and falls back
// to the pane-scraped selector for prompts that only live in the TUI —
// permission, plan-approval (ExitPlanMode) and trust dialogs. Both shapes share
// { question, options:[{index,label,selected}] }, so the SSE `prompt` event and
// the client render either identically.
async function resolveSessionPrompt(
  tp: string | null,
  pane: string | null,
): Promise<PanePrompt | PendingPrompt | null> {
  if (tp) {
    const pending = await pendingToolPrompt(tp);
    if (pending) return pending;
  }
  return pane ? parsePrompt(pane) : null;
}

function sseHeaders(): Record<string, string> {
  return {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
}

// ---------- server ----------

// Per-socket state for the browser terminal: which tmux session it attaches to,
// where its shell starts, and the initial geometry the client reported at
// connect time.
type TermSocketData = { sessionName: string; cwd: string; cols: number; rows: number };

// Live PTY bridges keyed by their websocket, so message/close handlers can find
// the bridge to write to / tear down.
const termBridges = new WeakMap<object, PtyBridge>();

// ---- streaming-STT bridge sockets ----
// The browser dictation path holds a websocket to /api/voice/stt-stream and streams
// 16 kHz PCM up / gets {partial,final} transcripts back. Each socket owns one
// upstream realtime-STT bridge (built in voice-providers so the API key stays
// there); the global ws handlers below find it by socket to forward audio / tear
// it down. Tagged in ws.data so open/message/close can tell it apart from the
// terminal and browser-login sockets that share these handlers.
type SttStreamSocketData = { sttStream: true };
const sttBridges = new WeakMap<object, SttStreamBridge>();

type AppSocketData = TermSocketData | SttStreamSocketData | LiveWsSocketData;

// Parse a terminal dimension from a query param, clamped to a sane range so a
// bogus value can't allocate an absurd pty winsize.
function clampDim(raw: string | null, fallback: number): number {
  const n = parseInt(raw ?? "", 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(500, n));
}

// Resolve which shell a terminal websocket/scan request wants.
//
// `?sessionId=<uuid>` asks for that agent session's OWN terminal: a dedicated
// persistent tmux session whose shell starts in the session's cwd (its
// worktree), so pulling up the terminal from a session card lands you exactly
// where that agent is working. Falling back to `?session=<name>` keeps the
// free-form global shells ("main", the login terminals) working unchanged.
async function resolveTermTarget(
  url: URL,
): Promise<{ sessionName: string; cwd: string }> {
  const sessionId = url.searchParams.get("sessionId");
  if (sessionId) {
    const sess = (await listSessionsCached().catch(() => [])).find(
      (s) => s.sessionId === sessionId,
    );
    const cwd = sess?.cwd && existsSync(sess.cwd) ? sess.cwd : homedir();
    return { sessionName: termSessionName(`s-${sessionId}`), cwd };
  }
  return {
    sessionName: termSessionName(url.searchParams.get("session") || "main"),
    cwd: homedir(),
  };
}

function prepareLoginTerminal(kind: string, command: string): string {
  const sessionId = `login-${kind}`;
  const sessionName = termSessionName(sessionId);
  if (!tmuxHasSession(sessionName)) {
    const created = Bun.spawnSync(["tmux", "new-session", "-d", "-s", sessionName, "-c", homedir()]);
    if (created.exitCode !== 0) {
      throw new Error(new TextDecoder().decode(created.stderr) || "failed to create terminal session");
    }
  }
  Bun.spawnSync(["tmux", "send-keys", "-t", `=${sessionName}`, "C-c"]);
  Bun.spawnSync(["tmux", "send-keys", "-t", `=${sessionName}`, "-l", command]);
  Bun.spawnSync(["tmux", "send-keys", "-t", `=${sessionName}`, "Enter"]);
  return sessionId;
}

export async function cmdServe() {
  const diskTmp = ensureDiskBackedTmpdir();
  if (diskTmp) {
    console.log(`lfg tmp → ${diskTmp} (disk-backed; /tmp is RAM)`);
  }
  const liveWs = createLiveWsSupport({
    evlog,
    getAgentRun: agentRunSnapshot,
    subscribeAgentRun,
  });
  const server = Bun.serve<AppSocketData>({
    port: PORT,
    hostname: HOST,
    idleTimeout: 240,
    // A ceiling on any request body, set once here rather than in each of the
    // ~58 handlers that call req.json().
    //
    // Without it a single POST could hand the process an arbitrarily large
    // buffer: a 20 MiB body was accepted and cost ~22 MB of RSS, and nothing
    // stopped a much larger one. This API has no application-layer auth and is
    // reachable through the relay, so "the caller would not do that" is not a
    // control.
    //
    // 32 MiB rather than something tighter because real uploads pass through
    // here — session artifact images and videos (see /api/sessions/:id/
    // artifacts/*). This bounds the damage; it is not a per-route policy, and
    // a route wanting a smaller limit should still check its own input.
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    websocket: {
      // The browser terminal: each socket owns a PTY attached to a persistent
      // tmux shell session. Input arrives as binary frames (raw keystrokes);
      // text frames are JSON control messages (resize). Output is streamed back
      // as binary frames — the full raw VT byte stream a faithful renderer wants.
      idleTimeout: 600,
      open(ws: ServerWebSocket<AppSocketData>) {
        if (liveWs.isLiveSocket(ws as unknown as ServerWebSocket<unknown>)) {
          liveWs.open(ws as unknown as ServerWebSocket<unknown>);
          return;
        }
        // Streaming-STT bridge socket: open the upstream realtime-STT bridge and
        // pipe its results back as {partial,final} text frames. Built synchronously
        // (the bridge queues outbound audio until its upstream connects), so the
        // first PCM frame in message() always finds a bridge.
        if ((ws.data as unknown as SttStreamSocketData)?.sttStream) {
          const send = (o: unknown) => {
            try {
              ws.send(JSON.stringify(o));
            } catch {}
          };
          const bridge = openSttStream({
            onPartial: (text) => send({ type: "partial", text }),
            onFinal: (text) => send({ type: "final", text }),
            onClose: () => {
              try {
                ws.close();
              } catch {}
            },
          });
          if (!bridge) {
            try {
              ws.close();
            } catch {}
            return;
          }
          sttBridges.set(ws, bridge);
          return;
        }
        if (!("sessionName" in ws.data)) {
          try {
            ws.close();
          } catch {}
          return;
        }
        try {
          const { sessionName, cols, rows } = ws.data;
          const cwd = ws.data.cwd || homedir();
          // `-c cwd` sets the tmux session's start-directory, so the shell (and
          // every later window/pane in it) opens where this terminal belongs —
          // the agent session's worktree for per-session terminals. It only
          // applies when tmux actually creates the session; `-A` re-attaches an
          // existing one untouched, which is what makes the shell persist.
          const bridge = new PtyBridge(
            ["tmux", "new-session", "-A", "-s", sessionName, "-c", cwd],
            { cols, rows, cwd },
          );
          bridge.onData((chunk) => {
            try {
              ws.send(chunk);
            } catch {}
          });
          bridge.onExit(() => {
            try {
              ws.close();
            } catch {}
          });
          termBridges.set(ws, bridge);
        } catch (e) {
          try {
            ws.send(`\r\n[lfg] failed to open terminal: ${(e as Error).message}\r\n`);
            ws.close();
          } catch {}
        }
      },
      message(ws: ServerWebSocket<AppSocketData>, message) {
        if (liveWs.isLiveSocket(ws as unknown as ServerWebSocket<unknown>)) {
          liveWs.message(ws as unknown as ServerWebSocket<unknown>, message);
          return;
        }
        // Streaming-STT bridge: binary frames are raw 16 kHz PCM; text frames are
        // the worker's {"type":"flush"|"eof"} control messages.
        const sttBridge = sttBridges.get(ws);
        if (sttBridge) {
          if (typeof message === "string") {
            try {
              const ctrl = JSON.parse(message) as { type?: string };
              if (ctrl.type === "flush") sttBridge.flush();
              else if (ctrl.type === "eof") sttBridge.close();
            } catch {}
          } else {
            sttBridge.pushPcm(message as Uint8Array);
          }
          return;
        }
        const bridge = termBridges.get(ws);
        if (!bridge) return;
        if (typeof message === "string") {
          // Control channel (resize). Anything unparseable is ignored.
          try {
            const ctrl = JSON.parse(message) as {
              t?: string;
              cols?: number;
              rows?: number;
            };
            if (ctrl.t === "resize" && ctrl.cols && ctrl.rows)
              bridge.resize(ctrl.cols, ctrl.rows);
          } catch {}
          return;
        }
        // Binary frame = raw keystrokes.
        bridge.write(message as Uint8Array);
      },
      close(ws: ServerWebSocket<AppSocketData>) {
        if (liveWs.isLiveSocket(ws as unknown as ServerWebSocket<unknown>)) {
          liveWs.close(ws as unknown as ServerWebSocket<unknown>);
          return;
        }
        // Streaming-STT bridge: tear the upstream realtime-STT socket down.
        const sttBridge = sttBridges.get(ws);
        if (sttBridge) {
          sttBridges.delete(ws);
          sttBridge.close();
          return;
        }
        const bridge = termBridges.get(ws);
        termBridges.delete(ws);
        // Tears down our attach client; the tmux session itself persists so the
        // shell (and any in-flight OAuth / long command) survives a reconnect.
        bridge?.close();
      },
    },
    async fetch(req, server) {
      const url = new URL(req.url);
      const path = url.pathname;
      const apiTimingStart = BOOT_API_TIMING_ENDPOINTS.has(path) ? performance.now() : 0;

      // Mark the handful of paths a PWA cold start must hit. This is the only
      // evidence available when a home-screen install shows a black window: the
      // page never runs, so nothing can report from the device side.
      pwaBootLog.recordRequest(path, req.headers);

      const response = await (async () => {
      try {
      // The shared MCP endpoint. Agents registered with `--transport http`
      // reach the same tool surface `lfg mcp` exposes over stdio, without each
      // session spawning its own copy of this process. Streamable HTTP drives
      // POST (requests), GET (server-initiated stream) and DELETE (teardown),
      // so the transport owns method handling rather than this router.
      if (path === "/mcp") {
        return await serveOmgMcpRequest(req);
      }

      // Browser-side diagnostics. This is the ingest half of the live
      // transport instrumentation in docs/live-ws-protocol.md: the client
      // emits ws_client_open / ws_client_first_msg / ws_client_reconnect, and
      // they must land in the same daily evlog file the server writes
      // ws_connect / ws_subscribe / ws_backlog to. Only the client knows the
      // close code and the retry count, so without this route a reconnect
      // cannot be read end to end.
      //
      // 8841a1a deleted this route as having zero callers. That was wrong —
      // web/src had 16. The GET reader it also deleted really did have zero
      // callers and stays deleted; read the file on disk instead.
      if (path === "/api/evlog") {
        if (req.method !== "POST") return err(405, "method not allowed");
        const declaredLength = Number(req.headers.get("content-length") ?? "0");
        if (Number.isFinite(declaredLength) && declaredLength > 64_000) {
          return err(413, "request too large");
        }
        const raw = await req.text();
        if (raw.length > 64_000) return err(413, "request too large");
        let body: Record<string, unknown> | null = null;
        try {
          const parsed: unknown = JSON.parse(raw);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            body = parsed as Record<string, unknown>;
          }
        } catch {
          // A malformed diagnostic is still worth recording as an event.
        }
        const event = typeof body?.event === "string" ? body.event : "client_event";
        evlog(event, {
          source: "browser",
          href: req.headers.get("referer") ?? undefined,
          ...(body ?? {}),
        });
        // The client fires and forgets. It never reads this body, so do not
        // hand the browser server-side filesystem paths the way the original
        // handler did.
        return json({ ok: true });
      }

      if (path === "/api/live/ws") {
        if (!isLiveWsEnabled()) return err(404, "live websocket disabled");
        const ok = server.upgrade(req, {
          data: liveWs.dataForRequest(),
        });
        if (ok) return undefined; // upgraded — Bun takes over the socket
        return err(400, "expected a websocket upgrade");
      }

      // ---- browser terminal (websocket upgrade) ----
      if (path === "/api/term") {
        const { sessionName, cwd } = await resolveTermTarget(url);
        const cols = clampDim(url.searchParams.get("cols"), 80);
        const rows = clampDim(url.searchParams.get("rows"), 24);
        const ok = server.upgrade(req, {
          data: { sessionName, cwd, cols, rows },
        });
        if (ok) return undefined; // upgraded — Bun takes over the socket
        return err(400, "expected a websocket upgrade");
      }

      // ---- streaming STT bridge (websocket upgrade) ----
      // The browser's dictation path connects here; the socket bridges its
      // raw-PCM/{flush,eof} protocol to the configured realtime-STT provider
      // (ElevenLabs Scribe v2 Realtime) in voice-providers.ts.
      if (path === "/api/voice/stt-stream") {
        const ok = server.upgrade(req, {
          data: { sttStream: true },
        });
        if (ok) return undefined; // upgraded — Bun takes over the socket
        return err(400, "expected a websocket upgrade");
      }


      // Detect links in the terminal for the tappable-chip UI. A long URL is
      // wrapped across rows in the rendered terminal (and often hard-wrapped by
      // the app, so tmux -J can't help). We reconstruct full URLs from the pane
      // by stitching full-width rows, and also read any OSC 8 hyperlink targets.
      if (path === "/api/term/scan" && req.method === "GET") {
        const { sessionName: target } = await resolveTermTarget(url);
        const plain = capturePaneScroll(target);
        if (plain == null) return json({ urls: [] });
        const urls = detectUrls({
          plain,
          escaped: capturePaneEscaped(target) ?? undefined,
          width: paneWidth(target) ?? 80,
        });
        return json({ urls });
      }

      // ---- static ----
      if (path === "/" || path === "/index.html") {
        return webIndexResponse();
      }

      // Boot beacon from index.html. sendBeacon posts text/plain, so the body
      // is a JSON *string*; parseBeacon validates it. Always 204 — a launch
      // that is already failing must never be handed another error to handle.
      if (path === "/__lfg_boot" && req.method === "POST") {
        try {
          const body = await req.text();
          const entry = pwaBootLog.parseBeacon(body, req.headers.get("user-agent") || undefined);
          if (entry) pwaBootLog.record(entry);
        } catch {
          // A truncated beacon is itself unremarkable; never fail the request.
        }
        return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
      }

      // The answer page. Open this from ANY device (laptop, or Safari on the
      // phone) after tapping the black icon — it reports how far that launch
      // actually got, which is the question six previous fixes were guessing at.
      if (path === "/__lfg_pwa_diag") {
        return pwaDiagResponse(url);
      }
      // Escape hatch for a stuck home-screen install.
      //
      // iOS keeps Safari website data and Home Screen web-app data SEPARATELY.
      // Resetting in Safari only heals Safari — the black icon keeps its own
      // service worker until the icon is deleted (or this page is opened from
      // inside that standalone app). This page detects the mode and guides.
      if (path === "/__lfg_pwa_reset") {
        const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<meta name="theme-color" content="#000000"/>
<title>lfg — reset install</title>
<style>
html,body{margin:0;min-height:100%;background:#000;color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}
main{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;text-align:left;gap:.85rem;max-width:26rem;margin:0 auto;box-sizing:border-box}
h1{font-size:1.2rem;margin:0;text-align:center}
p,li{margin:0;color:#a1a1aa;line-height:1.45;font-size:.95rem}
ol{margin:0;padding-left:1.2rem;color:#a1a1aa;line-height:1.5}
#status{color:#71717a;font-size:.85rem;min-height:1.2em;text-align:center}
.badge{display:inline-block;font-size:.7rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:.2rem .5rem;border-radius:999px;background:#27272a;color:#f4f4f5}
.badge.ok{background:#14532d;color:#bbf7d0}
.badge.warn{background:#713f12;color:#fde68a}
button{appearance:none;border:0;border-radius:999px;padding:.75rem 1.2rem;font:inherit;font-weight:600;background:#0a84ff;color:#fff;width:100%;max-width:18rem;align-self:center}
button.secondary{background:#27272a}
.row{display:flex;flex-direction:column;gap:.5rem;width:100%;align-items:center;margin-top:.25rem}
a{color:#60a5fa}
</style></head><body>
<main>
<p style="text-align:center;margin:0"><span class="badge" id="mode-badge">Detecting…</span></p>
<h1 id="title">Reset lfg install</h1>
<div id="body"></div>
<p id="status"></p>
<div class="row" id="actions"></div>
</main>
<script>
(function () {
  var standalone = false;
  try {
    standalone = window.matchMedia("(display-mode: standalone)").matches
      || window.matchMedia("(display-mode: minimal-ui)").matches
      || navigator.standalone === true;
  } catch (e) {}

  var badge = document.getElementById("mode-badge");
  var title = document.getElementById("title");
  var body = document.getElementById("body");
  var status = document.getElementById("status");
  var actions = document.getElementById("actions");
  function say(t) { if (status) status.textContent = t; }

  async function wipeThisProfile() {
    say("Working…");
    try {
      try { localStorage.clear(); } catch (e) {}
      try { sessionStorage.clear(); } catch (e) {}
      if ("serviceWorker" in navigator) {
        var regs = await navigator.serviceWorker.getRegistrations();
        say("Unregistering " + regs.length + " worker(s)…");
        await Promise.all(regs.map(function (r) { return r.unregister(); }));
      }
      if ("caches" in window) {
        var keys = await caches.keys();
        say("Clearing " + keys.length + " cache(s)…");
        await Promise.all(keys.map(function (k) { return caches.delete(k); }));
      }
      if (indexedDB && indexedDB.databases) {
        var dbs = await indexedDB.databases();
        await Promise.all((dbs || []).map(function (db) {
          return db && db.name ? new Promise(function (res) {
            var req = indexedDB.deleteDatabase(db.name);
            req.onsuccess = req.onerror = req.onblocked = function () { res(); };
          }) : Promise.resolve();
        }));
      }
      say("This browser profile is clean.");
      return true;
    } catch (e) {
      say("Finished with errors — continue with the steps below.");
      return false;
    }
  }

  if (standalone) {
    badge.textContent = "Home screen app";
    badge.className = "badge ok";
    title.textContent = "Resetting this home-screen app";
    body.innerHTML = "<p>You opened reset <strong>inside</strong> the home-screen install. That is the profile that was still black — Safari reset does not touch it on iOS.</p><p>Tap below to wipe workers/caches for <em>this</em> app, then re-open lfg.</p>";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Wipe home-screen data";
    btn.onclick = async function () {
      btn.disabled = true;
      await wipeThisProfile();
      setTimeout(function () { location.replace("/?reset=" + Date.now()); }, 500);
    };
    actions.appendChild(btn);
    // Auto-run once so a deep link from Notes just works.
    btn.click();
  } else {
    badge.textContent = "Safari browser";
    badge.className = "badge warn";
    title.textContent = "Safari is not the home-screen icon";
    body.innerHTML =
      "<p>On iPhone, Safari and the home-screen app keep <strong>separate</strong> website data. Resetting here only fixes Safari — which is why Safari already works and the icon stays black.</p>" +
      "<ol>" +
      "<li><strong>Delete</strong> the black lfg icon from your Home Screen (long-press → Remove App → Delete App). That destroys the stuck home-screen profile.</li>" +
      "<li>Tap <strong>Wipe Safari data</strong> below (optional but recommended).</li>" +
      "<li>Confirm lfg loads in Safari: <a href='/'>open lfg</a>.</li>" +
      "<li>Safari Share → <strong>Add to Home Screen</strong> (fresh icon).</li>" +
      "</ol>" +
      "<p>If you skip step 1, the old icon keeps its old service worker forever.</p>";
    var wipe = document.createElement("button");
    wipe.type = "button";
    wipe.textContent = "Wipe Safari data";
    wipe.onclick = async function () {
      wipe.disabled = true;
      await wipeThisProfile();
      wipe.textContent = "Safari data wiped";
    };
    var open = document.createElement("button");
    open.type = "button";
    open.className = "secondary";
    open.textContent = "Open lfg in Safari";
    open.onclick = function () { location.replace("/?reset=" + Date.now()); };
    actions.appendChild(wipe);
    actions.appendChild(open);
  }
})();
</script>
</body></html>`;
        return new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            // Never let a stuck worker or HTTP cache pin this escape hatch.
            "Cache-Control": "no-store, max-age=0",
          },
        });
      }
      if (path === "/sw.js") {
        let src = await Bun.file(join(WEB_DIR, "sw.js")).text();
        // Identity every deploy uniquely. Vite stamps a content hash into
        // VERSION at build time from the entry chunk name — that can stay
        // stable when only public/sw.js changes. Overwrite with index size +
        // mtime so a land that rebuilds the shell always produces a new worker
        // body, which is what triggers the browser install/activate cycle.
        let version = "0";
        try {
          const s = statSync(INDEX_PATH);
          version = `${s.size.toString(16)}-${Math.floor(s.mtimeMs).toString(16)}`;
        } catch {}
        if (src.includes("__VERSION__")) {
          src = src.replaceAll("__VERSION__", version);
        } else {
          src = src.replace(/const VERSION = "[^"]*"/, `const VERSION = "${version}"`);
        }
        src = `${src}\n/* lfg-sw-deploy:${version} */\n`;
        return new Response(src, {
          headers: {
            "Content-Type": "application/javascript; charset=utf-8",
            // no-store: iOS was reusing a cached sw.js for update checks even
            // with no-cache, which left home-screen installs on dead workers.
            "Cache-Control": "no-store, max-age=0",
            "Service-Worker-Allowed": "/",
          },
        });
      }
      const staticFile = STATIC_FILES[path];
      if (staticFile) {
        return staticAssetResponse(req, url, staticFile.path, staticFile.type);
      }

      // Hashed, content-addressed Vite bundles from the v2 build. Filenames
      // change on every build, so they're safe to cache immutably.
      if (path.startsWith("/assets/") && !path.includes("..")) {
        const filePath = join(WEB_DIR, "assets", path.slice("/assets/".length));
        const f = Bun.file(filePath);
        if (await f.exists()) {
          const type = path.endsWith(".css")
            ? "text/css; charset=utf-8"
            : path.endsWith(".js")
              ? "application/javascript; charset=utf-8"
              : "application/octet-stream";
          const headers = {
            "Content-Type": type,
            "Cache-Control": "public, max-age=31536000, immutable",
            "Vary": "Accept-Encoding",
          };
          const compressed = await compressedAssetResponse(req, filePath, headers);
          if (compressed) return compressed;
          return new Response(f, {
            headers,
          });
        }
      }

      // ---- voice STT proxy: transcribe uploaded WAV audio via the configured
      // cloud provider (ElevenLabs Scribe by default); returns { text }. Keeps
      // the device thin (no local model). The provider is chosen in Settings
      // and dispatched in voice-providers.ts.
      if (path === "/api/voice/stt" && req.method === "POST") {
        const audio = await req.arrayBuffer();
        if (!audio.byteLength) return err(400, "empty audio");
        return transcribeStt(audio);
      }

      // ---- voice provider config: which STT provider the dictation proxies
      // use. The selection lives server-side (data/voice-settings.json) so it is
      // shared across browsers rather than pinned to one localStorage. Secrets
      // stay server-side; POST
      // can persist a known provider's key to .env without returning it. GET
      // returns current settings + availability so the UI can grey out
      // unconfigured providers.
      if (path === "/api/voice/config" && req.method === "GET") {
        return json({
          settings: await getVoiceSettings(),
          providers: listProviders(),
          // Whether dictation will show words as they are spoken. False means the
          // browser will still transcribe, but only after the take ends — the UI
          // says so rather than leaving it looking broken.
          streaming: sttStreamingAvailable(),
          setup: voiceSetupInfo(),
        });
      }
      if (path === "/api/voice/config" && req.method === "POST") {
        const b = (await req.json().catch(() => null)) as
          | (Partial<VoiceSettings> & { providerId?: string; apiKey?: string })
          | null;
        if (!b) return err(400, "expected body");
        if (b.apiKey !== undefined) {
          if (!b.providerId) return err(400, "providerId is required with apiKey");
          try {
            await saveVoiceProviderKey(b.providerId, b.apiKey);
          } catch (error) {
            const message = error instanceof Error ? error.message : "";
            if (message === "unknown voice provider" || message === "invalid API key format") {
              return err(400, message);
            }
            console.error("[voice] could not save provider API key", error);
            return err(500, "could not save API key");
          }
        }
        return json({
          settings: await setVoiceSettings(b),
          providers: listProviders(),
        });
      }

      // ---- onboarding: first-run state (user profiles created in-app, step
      // progress, completion). Service-ized like voice config: the state lives
      // server-side (data/onboarding.json) so every browser/device agrees on
      // whether this install has been set up — localStorage alone can't gate a
      // shared box. The frontend combines this with users/sessions from
      // bootstrap to decide whether to show the first-run flow.
      if (path === "/api/onboarding" && req.method === "GET") {
        return json({ state: await getOnboarding(), users: userRoster() });
      }
      if (path === "/api/onboarding" && req.method === "POST") {
        const b = (await req.json().catch(() => null)) as {
          steps?: Partial<OnboardingSteps>;
          completed?: boolean;
          hostedIntroDone?: boolean;
          hostedCoach?: Partial<HostedFirstRun["coach"]>;
        } | null;
        if (!b) return err(400, "expected body");
        return json({ state: await patchOnboarding(b) });
      }
      // Create a user profile during onboarding. The profile merges into
      // userRoster() (env LFG_USERS stays primary), so the rest of the app —
      // session tagging, filters, avatars — picks it up with no special cases.
      if (path === "/api/onboarding/profile" && req.method === "POST") {
        const b = (await req.json().catch(() => null)) as {
          email?: string;
          name?: string;
        } | null;
        if (!b) return err(400, "expected { email, name? }");
        try {
          const state = await addOnboardingProfile(b);
          return json({ state, users: userRoster() });
        } catch (e) {
          return err(400, e instanceof Error ? e.message : "invalid profile");
        }
      }
      // Upload a profile photo (raw image bytes, Content-Type = image mime,
      // email in the query). Stored under data/avatars and served below —
      // takes precedence over Gravatar in userRoster().
      if (path === "/api/onboarding/avatar" && req.method === "POST") {
        const email = url.searchParams.get("email") ?? "";
        const mime = (req.headers.get("content-type") ?? "").split(";")[0]!.trim();
        try {
          const bytes = new Uint8Array(await req.arrayBuffer());
          const state = await setProfileAvatar(email, bytes, mime);
          return json({ state, users: userRoster() });
        } catch (e) {
          return err(400, e instanceof Error ? e.message : "invalid image");
        }
      }
      // ---- user icon (settings-configurable, not just onboarding-once) ----
      // `email` in the query names which roster member the caller is acting
      // as; a roster-less hosted box ignores it and keys by its paired omg
      // account instead (see iconIdentityKey in users.ts — this is the
      // hosted-side identity decision for the whole feature).
      if (path === "/api/settings/icon" && req.method === "GET") {
        const identity = iconIdentityKey(url.searchParams.get("email"));
        if (!identity.ok) return err(400, identity.reason);
        const custom = iconUrl(userIconsSync(), identity.key);
        return json({
          key: identity.key,
          avatar: custom ?? gravatar(identity.key),
          hasCustomIcon: !!custom,
        });
      }
      if (path === "/api/settings/icon" && req.method === "POST") {
        const identity = iconIdentityKey(url.searchParams.get("email"));
        if (!identity.ok) return err(400, identity.reason);
        const mime = (req.headers.get("content-type") ?? "").split(";")[0]!.trim();
        try {
          const bytes = new Uint8Array(await req.arrayBuffer());
          const { url: avatar } = await setUserIcon(identity.key, bytes, mime);
          return json({ key: identity.key, avatar, users: userRoster() });
        } catch (e) {
          return err(400, e instanceof Error ? e.message : "invalid image");
        }
      }
      if (path === "/api/settings/icon" && req.method === "DELETE") {
        const identity = iconIdentityKey(url.searchParams.get("email"));
        if (!identity.ok) return err(400, identity.reason);
        await removeUserIcon(identity.key);
        return json({
          key: identity.key,
          avatar: gravatar(identity.key),
          users: userRoster(),
        });
      }
      // Clone a git repository into LFG_REPOS_ROOT — the onboarding "set up
      // your repo" step for installs that have no repos yet.
      if (path === "/api/onboarding/repo" && req.method === "POST") {
        const b = (await req.json().catch(() => null)) as {
          url?: string;
          name?: string;
        } | null;
        if (!b || typeof b.url !== "string" || !b.url.trim()) {
          return err(400, "expected { url, name? }");
        }
        try {
          const repo = await cloneRepo(b.url, REPOS_ROOT, b.name);
          await patchOnboarding({ steps: { repo: true } });
          return json({ repo, repos: await listRepos() });
        } catch (e) {
          return err(400, e instanceof Error ? e.message : "clone failed");
        }
      }
      {
        // Serve onboarding-uploaded avatars. File names are md5(email).<ext>
        // generated server-side; the regex plus extension allowlist keeps this
        // from ever reading outside data/avatars.
        const m = path.match(/^\/api\/avatars\/([a-f0-9]{32})\.(png|jpg|webp|gif)$/);
        if (m && req.method === "GET") {
          const file = Bun.file(join(AVATARS_DIR(), `${m[1]}.${m[2]}`));
          if (!(await file.exists())) return err(404, "avatar not found");
          // A request carrying `?v=` (user-icons.ts's version cache-buster)
          // names a URL that can only ever resolve to this exact image — a
          // replace bumps the version and therefore the URL, it never
          // overwrites one a client already cached. That makes it safe to
          // cache indefinitely, unlike the unversioned legacy onboarding URLs
          // (no `?v=`), which stay on the conservative short TTL because the
          // same URL really can change under a client's feet.
          const versioned = url.searchParams.has("v");
          return new Response(file, {
            headers: {
              "Content-Type": AVATAR_MIME_BY_EXT[m[2]!] ?? "application/octet-stream",
              "Cache-Control": versioned
                ? "private, max-age=31536000, immutable"
                : "private, max-age=3600",
              "X-Content-Type-Options": "nosniff",
            },
          });
        }
      }

      // ---- coding-agent config: which session backends are shown in the
      // composer, plus lightweight setup health/actions for Settings.
      if (path === "/api/coding-agents" && req.method === "GET") {
        const refresh = url.searchParams.get("refreshModels") === "1";
        if (refresh) {
          await refreshModelCatalog({ reason: "manual", onLog: (line) => console.log(line) });
        }
        // An explicit refresh is the user asking for ground truth, so it pays
        // the full probe; the ordinary Settings read takes the cache.
        const agents = await listCodingAgentsCached({ refresh });
        return json({
          agents,
          models: listModelCatalog(agents),
          discovery: readModelDiscoveryCacheSync(),
        });
      }
      if (path === "/api/coding-agents/claude/accounts" && req.method === "GET") {
        return json({ accounts: listClaudeAccounts() });
      }
      if (path === "/api/coding-agents/claude/accounts" && req.method === "POST") {
        const account = createClaudeAccount();
        // The new account gets its own Claude config dir, so it needs its own
        // copy of the omg.dev MCP registration — otherwise its first session starts
        // with no LFG tools at all.
        await registerClaudeMcpForAccount(account.id);
        return json({ account });
      }
      {
        const m = path.match(/^\/api\/coding-agents\/claude\/accounts\/([a-f0-9-]+)$/);
        if (m && req.method === "DELETE") {
          const active = listManaged().some((session) => session.claudeAccountId === m[1]);
          if (active) return err(409, "Close sessions using this Claude account before removing it");
          return removeClaudeAccount(m[1])
            ? json({ ok: true, accounts: listClaudeAccounts() })
            : err(404, "Claude account not found");
        }
      }
      if (path === "/api/setup/checks" && req.method === "GET") {
        return json({ checks: await listSetupChecksCached() });
      }
      if (path === "/api/server/stats" && req.method === "GET") {
        return json({ stats: await serverStats() });
      }
      if (path === "/api/server/wake-tick" && req.method === "POST") {
        return handleWakeTick((l) => console.log(l));
      }
      if (path === "/api/server/session-usage" && req.method === "GET") {
        return json({ usage: await sessionUsage() });
      }
      if (path === "/api/settings") {
        if (req.method === "GET") {
          const settings = await getGlobalSettings();
          const computer = computerAgentAdmissionContext();
          return json({
            settings: computer
              ? { ...settings, maxLiveAgents: computer.limit }
              : settings,
          });
        }
        if (req.method === "POST") {
          const b = (await req.json().catch(() => null)) as Partial<GlobalSettings> | null;
          const patch: Partial<GlobalSettings> = {};
          if (typeof b?.timeZone === "string") {
            const timeZone = b.timeZone.trim();
            if (!validTimeZone(timeZone)) return err(400, `invalid timezone "${timeZone}"`);
            patch.timeZone = timeZone;
          }
          if (b?.maxLiveAgents !== undefined) {
            const computer = computerAgentAdmissionContext();
            if (computer) {
              return err(
                403,
                `${computer.plan} concurrency is managed by your Computer plan`,
              );
            }
            const max = Number(b.maxLiveAgents);
            if (!Number.isInteger(max) || max < 0 || max > MAX_LIVE_AGENTS_LIMIT)
              return err(400, `maxLiveAgents must be an integer from 0 to ${MAX_LIVE_AGENTS_LIMIT} (0 = unlimited)`);
            patch.maxLiveAgents = max;
          }
          if (b?.maxBotSchedules !== undefined) {
            const max = Number(b.maxBotSchedules);
            if (!Number.isInteger(max) || max < 1 || max > BOT_SCHEDULE_LIMIT)
              return err(400, `maxBotSchedules must be an integer from 1 to ${BOT_SCHEDULE_LIMIT}`);
            patch.maxBotSchedules = max;
          }
          // agentsPaused and idleAgentArchiveMinutes are gone (see
          // GlobalSettings) — a stored value from an older install is read and
          // silently dropped by settings.ts's sanitize(), and deliberately
          // there is no branch for either key here: an older client that still
          // PATCHes one is ignored rather than rejected with a 400, so it can't
          // be broken by a setting it doesn't know was removed.
          if (b?.transcriptView !== undefined) {
            if (!validTranscriptView(b.transcriptView))
              return err(400, "transcriptView must be full or user-lfg-output");
            patch.transcriptView = b.transcriptView;
          }
          if (b?.botAutoCompactionEnabled !== undefined) {
            if (typeof b.botAutoCompactionEnabled !== "boolean")
              return err(400, "botAutoCompactionEnabled must be a boolean");
            patch.botAutoCompactionEnabled = b.botAutoCompactionEnabled;
          }
          if (b?.botCompactionThresholdPercent !== undefined) {
            const threshold = Number(b.botCompactionThresholdPercent);
            if (
              !Number.isInteger(threshold) ||
              threshold < MIN_BOT_COMPACTION_THRESHOLD_PERCENT ||
              threshold > MAX_BOT_COMPACTION_THRESHOLD_PERCENT
            ) {
              return err(
                400,
                `botCompactionThresholdPercent must be an integer from ${MIN_BOT_COMPACTION_THRESHOLD_PERCENT} to ${MAX_BOT_COMPACTION_THRESHOLD_PERCENT}`,
              );
            }
            patch.botCompactionThresholdPercent = threshold;
          }
          if (b?.skippedUpdateVersion !== undefined) {
            if (typeof b.skippedUpdateVersion !== "string" || b.skippedUpdateVersion.length > 100)
              return err(400, "skippedUpdateVersion must be a string of 100 characters or fewer");
            patch.skippedUpdateVersion = b.skippedUpdateVersion;
          }
          const settings = await setGlobalSettings(patch);
          return json({ settings });
        }
        return err(405, "method not allowed");
      }
      if (path === "/api/bootstrap" && req.method === "GET") {
        noteListSessionsClientActivity();
        const sessionsTask = listSessionsCached().then((sessions) => {
          warmChatTranscripts(sessions);
          return sessions;
        });
        // Unmanaged callers have no trusted header, so the client tells us which
        // locally-selected roster profile it's using (the same identity it
        // already sends to /api/bots?user= and to bot message sends) — this
        // is a view preference on a box that already has no auth between its
        // local users, not a new trust boundary. A managed caller's trusted
        // header always wins over this regardless (see botViewer).
        const viewer = botViewerFromRequest(req, url.searchParams.get("user"));
        const conversationsTask = sessionsTask.then(() => {
          let conversations = listConversations();
          if (viewer.managed && viewer.identity) {
            const participantId = conversationHumanParticipantId(viewer.identity);
            conversations = conversations.filter((conversation) =>
              canReadConversation(conversation, participantId),
            );
          }
          return conversations;
        });
        // Which participant, if any, the *messages* the UI is about to render
        // belong to "me" — see viewerConversationParticipantId.
        const viewerParticipantId = viewerConversationParticipantId(viewer.identity);
        const reposTask = listRepos();
        const codingAgentsTask = listCodingAgentsCached();
        const settingsTask = getGlobalSettings();
        const tasks = {
          agents: listAgentSummaries(),
          codingAgents: codingAgentsTask,
          models: codingAgentsTask.then((agents) => listModelCatalog(agents)),
          settings: settingsTask,
          sessions: sessionsTask,
          conversations: conversationsTask,
          users: Promise.resolve(userRoster()),
          repos: reposTask,
          autoAgents: listAutoAgents(),
          findings: listFindings("open"),
          onboarding: getOnboarding(),
        };
        const taskEntries = Object.entries(tasks);
        const settled = await Promise.allSettled(taskEntries.map(([, task]) => task));
        const boot = Object.fromEntries(
          settled.map((entry, index) => [
            taskEntries[index]![0],
            entry.status === "fulfilled" ? entry.value : null,
          ]),
        ) as {
          agents?: Awaited<ReturnType<typeof listAgentSummaries>> | null;
          codingAgents?: Awaited<ReturnType<typeof listCodingAgents>> | null;
          models?: ReturnType<typeof listModelCatalog> | null;
          settings?: GlobalSettings | null;
          sessions?: Awaited<ReturnType<typeof listSessionsCached>> | null;
          conversations?: Awaited<typeof conversationsTask> | null;
          users?: ReturnType<typeof userRoster> | null;
          repos?: Awaited<ReturnType<typeof listRepos>> | null;
          autoAgents?: Awaited<ReturnType<typeof listAutoAgents>> | null;
          findings?: Awaited<ReturnType<typeof listFindings>> | null;
          onboarding?: Awaited<ReturnType<typeof getOnboarding>> | null;
        };
        return json(
          {
            agents: boot.agents ?? null,
            codingAgents: boot.codingAgents ?? null,
            models: boot.models ?? null,
            settings: boot.settings ?? null,
            sessions: boot.sessions ? boot.sessions.map(sessionListRow) : null,
            conversations: boot.conversations ?? null,
            // Not an authorization signal — never gates what the UI is allowed
            // to show. It only tells the transcript renderer which already-
            // delivered MessageAuthorRef.participantId is "mine", so a shared
            // bot conversation's message list can skip drawing a redundant
            // avatar on the viewer's own turns. See conversation-ui.ts on the
            // client for the comparison.
            viewer: { managed: viewer.managed, participantId: viewerParticipantId },
            users: boot.users ?? null,
            repos: boot.repos ?? null,
            auto: {
              agents: boot.autoAgents
                ? boot.autoAgents.map(withAutoAgentListMeta)
                : null,
              tz: boot.settings?.timeZone ?? DEFAULT_TIME_ZONE,
              findings: boot.findings ?? null,
            },
            onboarding: boot.onboarding ?? null,
            version: appVersion(),
            // Changes only when this process restarts, so it answers "is my
            // code actually running" without depending on a version string —
            // two commits can share a version, and a checkout can be bumped
            // under a process that never reloaded. Read it, deploy, restart,
            // confirm it changed. Same id /api/install?ready=1 already returns.
            bootId: SERVER_INSTANCE_ID,
            // Null on self-hosted. The live rail and admission use this to
            // keep Computer schedule rules off a normal lfg serve.
            computer: computerAgentAdmissionContext(),
          },
          { headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" } },
        );
      }
      {
        const m = path.match(/^\/api\/setup\/checks\/([a-z0-9_-]+)\/run$/);
        if (m && req.method === "POST") {
          const key = m[1];
          await runSetupAction(key);
          return json({ ok: true, checks: await listSetupChecksCached({ refresh: true }) });
        }
      }
      // Both shapes strip `keywords`: up to 4000 chars of body text per skill,
      // which was 354 KB of this response's 414 KB (102 KB of the 117 KB that
      // crossed the wire even deflated) and existed only to let the browser
      // run one substring match. `?q=` runs that same match here instead.
      if (path === "/api/skills" && req.method === "GET") {
        const repoRoots = (await listRepos().catch(() => [])).map((repo) => repo.cwd);
        const q = url.searchParams.get("q");
        if (q !== null) return json({ skills: await searchSkillCatalog(repoRoots, q) });
        return json({ skills: withoutSkillKeywords(await listSkillCatalog(repoRoots)) });
      }
      if (path === "/api/coding-agents/setup/log" && req.method === "GET") {
        return json(getCodingAgentSetupLog());
      }
      {
        // Keep the collection action ahead of the generic /:kind route below.
        // Otherwise "setup" is parsed as an agent kind and batch onboarding
        // fails with "unknown coding agent" before it reaches this handler.
        if (path === "/api/coding-agents/setup" && req.method === "POST") {
          const b = (await req.json().catch(() => null)) as { kinds?: unknown } | null;
          if (!b || !Array.isArray(b.kinds) || !b.kinds.length) {
            return err(400, "expected { kinds: [agent, ...] }");
          }
          if (!b.kinds.every((kind): kind is string => typeof kind === "string")) {
            return err(400, "agent kinds must be strings");
          }
          const kinds = [...new Set(b.kinds)];
          if (!kinds.every(isCodingAgentKind)) return err(404, "unknown coding agent");
          void runCodingAgentSetups(kinds).catch((e) =>
            console.error(`[coding-agents] batch setup failed:`, e),
          );
          const agents = await listCodingAgents();
          return json({ ok: true, agents, models: listModelCatalog(agents) });
        }
      }
      {
        const m = path.match(/^\/api\/coding-agents\/([a-z0-9_-]+)$/);
        if (m && m[1] !== "setup" && req.method === "POST") {
          const kind = m[1];
          if (!isCodingAgentKind(kind)) return err(404, "unknown coding agent");
          const b = (await req.json().catch(() => null)) as { visible?: unknown } | null;
          if (!b || typeof b.visible !== "boolean") return err(400, "expected { visible: boolean }");
          await setCodingAgentVisibility(kind, b.visible);
          const agents = await listCodingAgents();
          return json({ agents, models: listModelCatalog(agents) });
        }
      }
      {
        const m = path.match(/^\/api\/coding-agents\/([a-z0-9_-]+)\/setup$/);
        if (m && req.method === "POST") {
          const kind = m[1];
          if (!isCodingAgentKind(kind)) return err(404, "unknown coding agent");
          void runCodingAgentSetup(kind).catch((e) =>
            console.error(`[coding-agents] ${kind} setup failed:`, e),
          );
          const agents = await listCodingAgents();
          return json({ ok: true, agents, models: listModelCatalog(agents) });
        }
      }
      {
        const m = path.match(/^\/api\/coding-agents\/([a-z0-9_-]+)\/auth$/);
        if (m && req.method === "POST") {
          const kind = m[1];
          if (!isCodingAgentKind(kind)) return err(404, "unknown coding agent");
          try {
            const body = (await req.json().catch(() => null)) as {
              claudeAccountId?: unknown;
              provider?: unknown;
            } | null;
            const claudeAccountId =
              typeof body?.claudeAccountId === "string" ? body.claudeAccountId : undefined;
            // pi and jcode are signed in per model provider rather than once
            // per agent, so those kinds need to be told which one.
            const provider = typeof body?.provider === "string" ? body.provider : undefined;
            return json(await startCodingAgentAuth(kind, { claudeAccountId, piProvider: provider, provider }));
          } catch (e) {
            return err(502, e instanceof Error ? e.message : "failed to start login");
          }
        }
      }
      // Key-based providers (pi's OpenCode Zen; OpenCode's own Go and Zen) have
      // no browser flow to run — the user pastes a key and we hand it to that
      // agent's credential store. Both agents sign in per provider rather than
      // once per kind, so the agent owns the route and the body names which.
      //
      // The two id namespaces overlap — `opencode` is a provider of pi's AND of
      // OpenCode's, pointing at different credential files — so the agent in the
      // path, never the provider id, decides which store is written.
      {
        const m = path.match(/^\/api\/coding-agents\/(pi|opencode)\/api-key$/);
        if (m && req.method === "POST") {
          const agent = m[1];
          const body = (await req.json().catch(() => null)) as {
            provider?: unknown;
            key?: unknown;
          } | null;
          const provider = typeof body?.provider === "string" ? body.provider : "";
          if (typeof body?.key !== "string") return err(400, "expected { key: string }");
          try {
            if (agent === "pi") {
              if (!isPiAuthProviderId(provider)) return err(400, "unknown pi provider");
              await setPiProviderApiKey(provider, body.key);
            } else {
              if (!isOpencodeAuthProviderId(provider)) return err(400, "unknown opencode provider");
              setOpencodeProviderApiKey(provider, body.key);
            }
            return json({ ok: true, agents: await listCodingAgents() });
          } catch (e) {
            return err(400, e instanceof Error ? e.message : "could not save API key");
          }
        }
      }
      {
        const m = path.match(/^\/api\/coding-agents\/(pi|opencode|jcode)\/providers\/([a-z0-9-]+)$/);
        if (m && req.method === "DELETE") {
          const [, agent, provider] = m;
          try {
            if (agent === "pi") {
              if (!isPiAuthProviderId(provider)) return err(404, "unknown pi provider");
              await deletePiCredential(provider);
            } else if (agent === "jcode") {
              if (!isJcodeAuthProviderId(provider)) return err(404, "unknown jcode provider");
              deleteJcodeCredential(provider);
            } else {
              if (!isOpencodeAuthProviderId(provider)) return err(404, "unknown opencode provider");
              deleteOpencodeCredential(provider);
            }
            return json({ ok: true, agents: await listCodingAgents() });
          } catch (e) {
            return err(500, e instanceof Error ? e.message : "could not disconnect provider");
          }
        }
      }
      if (path === "/api/connections" && req.method === "GET") {
        return json({ connections: listToolConnections() });
      }
      if (path === "/api/connections/github/auth" && req.method === "POST") {
        try {
          return json(await startToolAuth("github"));
        } catch (e) {
          return err(
            502,
            e instanceof Error ? e.message : "failed to start GitHub login",
          );
        }
      }
      {
        const m = path.match(/^\/api\/coding-agents\/([a-z0-9_-]+)\/login-terminal$/);
        if (m && req.method === "POST") {
          const kind = m[1];
          if (!isCodingAgentKind(kind)) return err(404, "unknown coding agent");
          const command = loginCommandFor(kind);
          if (!command) return err(400, `no terminal login command for ${kind}`);
          try {
            const terminalSession = prepareLoginTerminal(kind, command);
            return json({ ok: true, terminalSession, command });
          } catch (e) {
            return err(502, e instanceof Error ? e.message : "failed to open login terminal");
          }
        }
      }
      {
        const m = path.match(/^\/api\/coding-agents\/auth\/([a-f0-9-]+)$/);
        if (m && req.method === "GET") {
          const session = getCodingAgentAuth(m[1]);
          return session ? json(session) : err(404, "login session not found");
        }
        if (m && req.method === "DELETE") {
          cancelCodingAgentAuth(m[1]);
          return json({ ok: true });
        }
      }
      {
        const m = path.match(/^\/api\/coding-agents\/auth\/([a-f0-9-]+)\/code$/);
        if (m && req.method === "POST") {
          const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
          if (!body || typeof body.code !== "string") return err(400, "expected { code: string }");
          try {
            return json(await submitCodingAgentAuthCode(m[1], body.code));
          } catch (e) {
            return err(400, e instanceof Error ? e.message : "could not submit login code");
          }
        }
      }

      // ---- extension backend proxy (optional, config-driven) ----
      // A same-origin reverse proxy for runtime UI extensions that must call a
      // private backend WITHOUT shipping its token to the browser. Fully driven
      // by env (no defaults, no hardcoded hosts) — builds that set nothing get
      // no proxy:
      //   LFG_PROXY_PREFIX    path prefix to match (e.g. "/_ext")
      //   LFG_PROXY_UPSTREAM  upstream origin to forward to
      //   LFG_PROXY_TOKEN     bearer token injected server-side
      //   LFG_PROXY_ALLOW     comma-sep allowed upstream path prefixes (empty = all)
      const proxyPrefix = process.env.LFG_PROXY_PREFIX;
      if (proxyPrefix && path.startsWith(proxyPrefix + "/")) {
        const upstream = (process.env.LFG_PROXY_UPSTREAM || "").replace(/\/$/, "");
        const tok = process.env.LFG_PROXY_TOKEN || "";
        if (!upstream || !tok) return err(503, "proxy not configured");
        const upstreamPath = path.slice(proxyPrefix.length);
        const allow = (process.env.LFG_PROXY_ALLOW || "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (allow.length && !allow.some((p) => upstreamPath.startsWith(p))) {
          return err(403, "forbidden path");
        }
        try {
          const r = await fetch(`${upstream}${upstreamPath}${url.search}`, {
            method: req.method,
            headers: {
              "Content-Type": req.headers.get("content-type") || "application/json",
              Authorization: `Bearer ${tok}`,
            },
            body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.text(),
            signal: AbortSignal.timeout(30000),
          });
          return new Response(r.body, {
            status: r.status,
            headers: {
              "Content-Type": r.headers.get("content-type") || "application/json",
              "Cache-Control": "no-store",
            },
          });
        } catch {
          return err(502, "proxy upstream unreachable");
        }
      }

      // ---- agents ----
      if (path === "/api/agents") {
        return json({ agents: await listAgentSummaries() });
      }

      {
        const m = path.match(/^\/api\/agents\/([a-z0-9_-]+)$/);
        if (m) {
          const name = m[1];
          if (req.method === "GET") {
            try {
              const a = await loadAgent(name);
              return json({
                name: a.name,
                filePath: a.filePath,
                frontmatter: a.frontmatter,
                body: a.body,
                raw: a.raw,
              });
            } catch (e) {
              return err(404, e instanceof Error ? e.message : String(e));
            }
          }
          if (req.method === "PUT") {
            const body = (await req.json().catch(() => null)) as { content?: unknown } | null;
            if (!body || typeof body.content !== "string")
              return err(400, "expected { content: string }");
            try {
              const a = await writeAgent(name, body.content);
              return json({ ok: true, name: a.name });
            } catch (e) {
              return err(400, e instanceof Error ? e.message : String(e));
            }
          }
          return err(405, "method not allowed");
        }
      }

      {
        const m = path.match(/^\/api\/agents\/([a-z0-9_-]+)\/reports$/);
        if (m) {
          const reps = await listAgentReports(m[1]);
          return json({ agent: m[1], reports: reps });
        }
      }

      {
        const m = path.match(
          /^\/api\/agents\/([a-z0-9_-]+)\/reports\/(\d{4}-\d{2}-\d{2})$/,
        );
        if (m) {
          const r = await readAgentReport(m[1], m[2]);
          if (!r) return err(404, "not found");
          return json(r);
        }
      }

      // ---- bot runtime self-management ----
      // These routes accept no owner or current-bot id. The authenticated MCP
      // session header is resolved against the server's live session registry,
      // then cross-checked with the persisted bot owner before any data moves.
      if (path === "/api/runtime/bots/peers" && req.method === "GET") {
        try {
          const sessions = await listSessions();
          const bots = await listBots();
          const actor = resolveBotRuntimeActor(callerSessionHeader(req), sessions, bots);
          return json({ bots: ownedBotPeers(actor, bots, sessions) });
        } catch (error) {
          if (error instanceof BotSelfManagementError) return err(error.status, error.message);
          throw error;
        }
      }
      if (path === "/api/runtime/bots/peer-messages" && req.method === "POST") {
        const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
        if (!body || Array.isArray(body)) return err(400, "invalid peer message");
        const allowed = new Set(["targetBotId", "text", "replyToMessageId"]);
        const unknown = Object.keys(body).filter((field) => !allowed.has(field)).sort();
        if (unknown.length) return err(400, `unsupported peer message fields: ${unknown.join(", ")}`);
        const targetBotId = typeof body.targetBotId === "string" ? body.targetBotId.trim() : "";
        const text = typeof body.text === "string" ? body.text : "";
        const replyToMessageId = body.replyToMessageId === undefined
          ? undefined
          : typeof body.replyToMessageId === "string" ? body.replyToMessageId.trim() : null;
        if (replyToMessageId === null) return err(400, "replyToMessageId must be a string");

        try {
          return await serializeBotWork(targetBotId, async () => {
            const sessions = await listSessions();
            const bots = await listBots();
            const actor = resolveBotRuntimeActor(callerSessionHeader(req), sessions, bots);
            const { message, target: reservedTarget } = reserveBotPeerMessage({
              actor,
              bots,
              targetBotId,
              text,
              replyToMessageId,
            });
            let enqueued = false;
            try {
              // Same rule as a human message: apply a rotation the owner
              // already requested before the peer turn is enqueued, so the
              // envelope is answered under the current configuration.
              //
              // Note this runs INSIDE the per-bot critical section already held
              // by this delivery, and `rotateBotSession` takes that same lock.
              // It is called through `applyPendingBotRotation` only on paths
              // that do not already hold it; here the pending state is checked
              // and the rotation is left to the message path, because
              // re-entering the lock would deadlock.
              let target = migrateLegacyBotRefreshFlag(reservedTarget);
              if (
                target.rotationState === "queued" ||
                target.rotationState === "rotating" ||
                (target.rotationState === "failed" && target.rotationReason === "config")
              ) {
                throw new BotPeerMessageError(
                  409,
                  target.rotationState === "failed"
                    ? `target bot refresh failed: ${target.rotationError || "retry the refresh"}`
                    : target.rotationReason === "restart"
                      ? "target bot restart is queued; retry after its current work completes"
                      : "target bot refresh is still settling; retry after its current turn completes",
                );
              }

              // Start or revive the persistent conversation, then hand the
              // envelope to deliverBotMessage — the same primitive a human
              // message and a fired routine go through. `asFirstMessage:
              // false` keeps a peer turn out of the launch prompt so it
              // always enters the durable send queue, which is where
              // queueMessageId (recorded on the peer-message ledger below)
              // comes from.
              const envelope = formatBotPeerMessage(message, actor.bot, target);
              const delivery = await deliverBotMessage(target, envelope, { asFirstMessage: false });
              if ("error" in delivery) {
                throw new BotPeerMessageError(delivery.status, delivery.error || "failed to start target bot");
              }
              if (!delivery.queueMessageId) {
                throw new BotPeerMessageError(502, "failed to durably enqueue peer message");
              }
              const accepted = markBotPeerMessageEnqueued(
                message.id,
                delivery.sessionId,
                delivery.queueMessageId,
              );
              enqueued = true;
              evlog("bot_peer_message_enqueued", {
                messageId: accepted.id,
                correlationId: accepted.correlationId,
                replyToMessageId: accepted.replyToMessageId,
                sourceBotId: actor.bot.id,
                targetBotId: target.id,
                owner: actor.user,
                depth: accepted.depth,
                chars: accepted.text.length,
                queueMessageId: delivery.queueMessageId,
              });
              return json({
                message: {
                  id: accepted.id,
                  correlationId: accepted.correlationId,
                  replyToMessageId: accepted.replyToMessageId ?? null,
                  sourceBotId: actor.bot.id,
                  targetBotId: target.id,
                  targetName: target.name,
                  depth: accepted.depth,
                  status: "enqueued",
                },
              }, { status: 202 });
            } finally {
              if (!enqueued) releaseBotPeerMessage(message.id);
            }
          });
        } catch (error) {
          if (error instanceof BotSelfManagementError || error instanceof BotPeerMessageError) {
            evlog("bot_peer_message_rejected", {
              targetBotId: targetBotId || null,
              status: error.status,
              reason: error.message,
              chars: text.length,
            });
            return err(error.status, error.message);
          }
          throw error;
        }
      }
      if (path === "/api/runtime/bots/owned" && req.method === "POST") {
        try {
          const sessions = await listSessions();
          const bots = await listBots();
          const actor = resolveBotRuntimeActor(callerSessionHeader(req), sessions, bots);
          const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
          if (!body || Array.isArray(body)) return err(400, "invalid bot definition");
          const unknown = unknownBotFields(body, BOT_SELF_CREATE_FIELDS);
          if (unknown.length) return err(400, `unsupported bot fields: ${unknown.join(", ")}`);
          const name = typeof body.name === "string" ? body.name.trim() : "";
          const persona = typeof body.persona === "string" ? body.persona.trim() : "";
          if (!name || !persona) return err(400, "name and persona are required");
          if (name.length > 80) return err(400, "name must be at most 80 characters");
          if (persona.length > 20_000) return err(400, "persona must be at most 20000 characters");
          const description = body.description === undefined
            ? undefined
            : typeof body.description === "string" ? body.description.trim() : null;
          if (description === null) return err(400, "description must be a string");
          if (description && description.length > 500)
            return err(400, "description must be at most 500 characters");
          const capabilities = readDeclaredCapabilities(body.capabilities);
          if (capabilities && !Array.isArray(capabilities)) return err(400, capabilities.error);
          const agentValue = typeof body.agent === "string" ? body.agent.trim() || undefined : undefined;
          const model = typeof body.model === "string" ? body.model.trim() || undefined : undefined;
          const thinkingLevel = typeof body.thinkingLevel === "string"
            ? body.thinkingLevel.trim() || undefined
            : undefined;
          const config = validateBotAgent(agentValue, model, thinkingLevel);
          if ("error" in config) return err(400, config.error);
          const cwd = actor.bot.cwd;
          if (cwd && !(await listRepos()).some((repo) => repo.cwd === cwd))
            return err(409, "calling bot workspace is no longer approved");
          const avatar = readBotAvatar(body);
          if ("error" in avatar) return err(400, avatar.error);
          const quotaPolicy = persistentBotQuotaPolicy();
          const bot = await createBot({
            name,
            persona,
            description,
            capabilities,
            shape: avatar.shape,
            colorway: avatar.colorway,
            agent: config.agent,
            model,
            thinkingLevel,
            cwd,
            owner: actor.user,
            ownerQuota: quotaPolicy,
          });
          evlog("bot_created_by_bot", {
            actorBotId: actor.bot.id,
            createdBotId: bot.id,
            owner: actor.user,
          });
          const quota = persistentBotQuota(await listBots(), actor.user, quotaPolicy);
          return json({ bot, quota }, { status: 201 });
        } catch (error) {
          if (error instanceof BotSelfManagementError) return err(error.status, error.message);
          if (error instanceof BotOwnerQuotaError)
            return json(botQuotaLimitPayload(error), { status: 409 });
          throw error;
        }
      }
      if (path === "/api/runtime/bots/self" && req.method === "PATCH") {
        try {
          const sessions = await listSessions();
          const bots = await listBots();
          const actor = resolveBotRuntimeActor(callerSessionHeader(req), sessions, bots);
          const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
          if (!body || Array.isArray(body)) return err(400, "invalid bot profile patch");
          const unknown = unknownBotFields(body, BOT_SELF_UPDATE_FIELDS);
          if (unknown.length) return err(400, `unsupported bot fields: ${unknown.join(", ")}`);
          if (!Object.keys(body).length) return err(400, "at least one editable profile field is required");
          const name = body.name === undefined
            ? actor.bot.name
            : typeof body.name === "string" ? body.name.trim() : "";
          const persona = body.persona === undefined
            ? actor.bot.persona
            : typeof body.persona === "string" ? body.persona.trim() : "";
          if (!name || !persona) return err(400, "name and persona are required");
          if (name.length > 80) return err(400, "name must be at most 80 characters");
          if (persona.length > 20_000) return err(400, "persona must be at most 20000 characters");
          const description = body.description === undefined
            ? actor.bot.description
            : typeof body.description === "string" ? body.description.trim() : null;
          if (description === null) return err(400, "description must be a string");
          if (description && description.length > 500)
            return err(400, "description must be at most 500 characters");
          const capabilities = body.capabilities === undefined
            ? actor.bot.capabilities
            : readDeclaredCapabilities(body.capabilities);
          if (capabilities && !Array.isArray(capabilities)) return err(400, capabilities.error);
          const avatar = readBotAvatar(body);
          if ("error" in avatar) return err(400, avatar.error);
          const nextConfig = {
            ...sessionBoundConfigOf(actor.bot),
            name,
            persona,
            description,
            capabilities,
          };
          const refreshRuntime = botPatchRequiresRuntimeRefresh(body) &&
            sessionBoundConfigChanged(sessionBoundConfigOf(actor.bot), nextConfig);
          const bot = await updateBot(actor.bot.id, {
            ...nextConfig,
            shape: body.shape === undefined ? actor.bot.shape : avatar.shape,
            colorway: body.colorway === undefined ? actor.bot.colorway : avatar.colorway,
            ...(refreshRuntime
              ? {
                  configRevision: nextBotConfigRevision(actor.bot),
                  rotationState: "queued" as const,
                  rotationReason: "config" as const,
                  rotationError: undefined,
                  rotationUpdatedAt: Date.now(),
                  runtimeRefreshPending: false,
                }
              : {}),
          });
          if (!bot) return err(404, "bot not found");
          evlog("bot_updated_self", {
            botId: actor.bot.id,
            owner: actor.user,
            fields: Object.keys(body).sort(),
          });
          return json({ bot });
        } catch (error) {
          if (error instanceof BotSelfManagementError) return err(error.status, error.message);
          throw error;
        }
      }

      // ---- persistent bots ----
      if (path === "/api/bots") {
        if (req.method === "GET") {
          // The roster line comes from the index, not from a live session. A
          // bot is idle between turns by definition and its harness may not be
          // running at all, and reading the last turn off the fleet made a bot
          // with a year of history show "Say hi to get started" after a reboot.
          const requestedUser = url.searchParams.get("user");
          const allBots = await listBots();
          // bots/access.ts owns who may see what. `?user=` is an identity for
          // read state, never an authorization input — conflating the two is
          // what hid a shared Computer's bots from everyone authorized on it.
          const viewer = botViewerFromRequest(req, requestedUser);
          const visibleBots = visibleBotsForViewer(allBots, viewer, rosterEmails(), requestedUser);
          const quotaOwner = botCreationOwner(viewer, requestedUser, rosterEmails());
          const quota = persistentBotQuota(
            allBots,
            quotaOwner.ok ? quotaOwner.owner : undefined,
            persistentBotQuotaPolicy(),
          );
          const bots = visibleBots.map((bot) => {
            const last = bot.sessionId ? lastIndexedAssistantMessage(bot.sessionId) : null;
            // The status is derived here rather than in the client so every
            // surface agrees on one answer. A client computing it from the
            // revision pair alone would miss an in-flight or failed rotation
            // and cheerfully render "Update available" over a running one.
            const decorated = {
              ...bot,
              configRevision: botConfigRevision(bot),
              appliedConfigRevision: botAppliedConfigRevision(bot),
              configStatus: botConfigStatus(bot),
              rotationError: bot.rotationError,
            };
            return last?.text
              ? { ...decorated, lastMessagePreview: last.text.slice(0, 400), lastMessageTs: last.ts ?? null }
              : decorated;
          });
          // Exactly one conversation per bot — the roster invariant, decided
          // here rather than left to the client.
          //
          // This used to key off every session carrying the bot's `botId`.
          // Delegated children inherit `botId`, so a bot that had spawned
          // background work contributed one conversation per subagent and the
          // roster showed it two or three times, each duplicate captioned with
          // a child's last line. `botCanonicalSessionId` owns the choice and
          // never returns a delegated session.
          //
          // Collapsing here is also what makes the roster cheap. The per
          // conversation body below reads the read-watermark file and runs two
          // index queries, so the old fan-out paid that for every subagent a
          // bot had ever spawned; on this machine that was 39 conversations
          // for 9 bots.
          const sessions = await listSessionsCached();
          // Read state is per person, so it keys on the VIEWER — Angel's unread
          // on a shared bot is hers, not a copy of the bot owner's. The trusted
          // header decides this whenever control-plane supplied one.
          const user = viewer.identity;
          const conversations = visibleBots.flatMap((bot) => {
            const sessionId = botCanonicalSessionId(bot, sessions);
            if (!sessionId) return [];
            // Ownership is anchored to the bot we already resolved from, so a
            // repaired binding that names a session the fleet no longer lists
            // still reports under its own bot instead of dropping out.
            const session = sessions.find((row) => row.sessionId === sessionId);
            const assigned = session?.assignedUser?.trim();
            const botOwner = bot.owner?.trim();
            // Both of these are the same owner-scoped view filter as the bot
            // list above, and they have to fall away on exactly the same terms.
            // Left unconditional they re-hid every conversation the list had
            // just decided was visible: on a shared machine the backing session
            // is stamped with whoever drove it, so `assigned` and `botOwner`
            // routinely disagree and the whole roster came back empty-handed.
            const scoped = !viewer.managed && localUserSplitEnabled(rosterEmails());
            if (scoped && assigned && botOwner && botReadUser(assigned) !== botReadUser(botOwner)) return [];
            const conversationUser = botReadUser(assigned || botOwner);
            if (scoped && requestedUser != null && conversationUser !== user) return [];
            const conversationId =
              bot.conversationId?.trim() ||
              session?.conversationId?.trim() ||
              sessionId;
            const cursor = latestIndexedAssistantCursor(sessionId);
            ensureBotConversationReadBaseline(user, conversationId, cursor?.rowid ?? null);
            const last = lastIndexedAssistantMessage(sessionId);
            return [{
              sessionId,
              conversationId,
              botId: bot.id,
              assignedUser: assigned ?? bot.owner ?? null,
              unread: conversationUnread(user, conversationId, cursor?.rowid ?? null),
              lastMessagePreview: last?.text?.slice(0, 400),
              lastMessageTs: last?.ts ?? null,
            }];
          });
          return json({ bots, conversations, quota });
        }
        if (req.method === "POST") {
          const body = (await req.json().catch(() => null)) as {
            name?: unknown;
            persona?: unknown;
            agent?: unknown;
            model?: unknown;
            thinkingLevel?: unknown;
            cwd?: unknown;
            user?: unknown;
            shape?: unknown;
            colorway?: unknown;
          } | null;
          const name = typeof body?.name === "string" ? body.name.trim() : "";
          const persona = typeof body?.persona === "string" ? body.persona.trim() : "";
          if (!name || !persona) return err(400, "name and persona are required");
          const agentValue = typeof body?.agent === "string" ? body.agent.trim() || undefined : undefined;
          const model = typeof body?.model === "string" ? body.model.trim() || undefined : undefined;
          const thinkingLevel = typeof body?.thinkingLevel === "string"
            ? body.thinkingLevel.trim() || undefined
            : undefined;
          const config = validateBotAgent(agentValue, model, thinkingLevel);
          if ("error" in config) return err(400, config.error);
          const cwd = typeof body?.cwd === "string" ? body.cwd.trim() || undefined : undefined;
          if (cwd && !(await listRepos()).some((repo) => repo.cwd === cwd))
            return err(400, "unknown repo");
          const requestedUser = typeof body?.user === "string" ? body.user : undefined;
          const viewer = botViewerFromRequest(req, requestedUser);
          const ownerTag = botCreationOwner(viewer, requestedUser, rosterEmails());
          if (!ownerTag.ok)
            return err(400, `unknown user "${ownerTag.unknown}" (expected one of the roster emails)`);
          const avatar = readBotAvatar(body);
          if ("error" in avatar) return err(400, avatar.error);
          let bot: Bot;
          const quotaPolicy = persistentBotQuotaPolicy();
          try {
            bot = await createBot({
              name,
              persona,
              shape: avatar.shape,
              colorway: avatar.colorway,
              agent: config.agent,
              model,
              thinkingLevel,
              cwd,
              owner: ownerTag.owner,
              ownerQuota: quotaPolicy,
            });
          } catch (error) {
            if (error instanceof BotOwnerQuotaError)
              return json(botQuotaLimitPayload(error), { status: 409 });
            throw error;
          }
          return json({
            bot,
            quota: persistentBotQuota(await listBots(), ownerTag.owner, quotaPolicy),
          });
        }
      }
      {
        const match = path.match(/^\/api\/bot-conversations\/([^/]+)\/read$/);
        if (match && req.method === "POST") {
          const sessionId = decodeURIComponent(match[1]);
          const body = (await req.json().catch(() => null)) as { user?: unknown } | null;
          const requestedUser = typeof body?.user === "string" ? body.user : undefined;
          const sessions = await listSessionsCached();
          const bots = await listBots();
          try {
            const owner = assertBotConversationAccess(
              botViewerFromRequest(req, requestedUser),
              rosterEmails(),
              requestedUser,
              sessionId,
              sessions,
              bots,
            );
            const cursor = latestIndexedAssistantCursor(sessionId);
            const conversationId =
              owner.bot.conversationId?.trim() ||
              sessions.find((row) => row.sessionId === sessionId)?.conversationId?.trim() ||
              sessionId;
            const read = markBotConversationRead(owner.user, conversationId, cursor?.rowid ?? null);
            return json({ ok: true, sessionId, conversationId, readThroughRowid: read.readThroughRowid });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return err(message.includes("another user") ? 403 : 404, message);
          }
        }
      }
      {
        const match = path.match(/^\/api\/conversations\/([^/]+)\/participants(?:\/([^/]+))?$/);
        if (match) {
          const conversationId = decodeURIComponent(match[1]);
          const participantPathId = match[2] ? decodeURIComponent(match[2]) : null;
          const conversation = getConversation(conversationId);
          if (!conversation) return err(404, "conversation not found");
          const viewer = botViewerFromRequest(req, undefined);
          if (viewer.managed) {
            const viewerParticipantId = conversationHumanParticipantId(viewer.identity);
            if (!canManageConversation(conversation, viewerParticipantId)) {
              return err(403, "conversation management access denied");
            }
          }
          if (req.method === "POST" && !participantPathId) {
            const body = (await req.json().catch(() => null)) as {
              botId?: unknown;
              historyAccess?: unknown;
            } | null;
            const botId = typeof body?.botId === "string" ? body.botId.trim() : "";
            if (!botId) return err(400, "botId is required");
            const bot = await getBot(botId);
            if (!bot || !bot.enabled) return err(404, "bot not found");
            const historyAccess = body?.historyAccess === "from_join" ? "from_join" : "all";
            const updated = upsertConversationParticipant(
              conversationId,
              conversationBotParticipant(bot, { historyAccess }),
            );
            return json({ conversation: updated });
          }
          if (req.method === "DELETE" && participantPathId) {
            const participant = conversation.participants.find((row) => row.id === participantPathId);
            if (!participant) return err(404, "participant not found");
            if (participant.role === "owner") return err(409, "conversation owner cannot leave");
            return json({
              conversation: leaveConversationParticipant(conversationId, participantPathId),
            });
          }
          return err(405, "method not allowed");
        }
      }
      {
        const match = path.match(/^\/api\/bots\/([^/]+)\/messages$/);
        if (match && req.method === "POST") {
          let bot = await getBot(decodeURIComponent(match[1]));
          if (!bot) return err(404, "bot not found");
          if (!bot.enabled) return err(409, "bot is disabled");
          const body = (await req.json().catch(() => null)) as { text?: unknown; user?: unknown } | null;
          const text = typeof body?.text === "string" ? body.text.trim() : "";
          if (!text) return err(400, "text is required");
          const requestedUser = typeof body?.user === "string" ? body.user : undefined;
          // The write route now asks the same question the read routes ask.
          // When control-plane vouched for this caller, their email decides
          // authorship and `body.user` is never consulted — see
          // bots/authorship.ts for why that ordering is the security property.
          const viewer = botViewerFromRequest(req, requestedUser);
          const tag = resolveSessionUserTag(requestedUser);
          // A managed caller's `body.user` is inert, so validating it can only
          // produce a spurious 400 on a shared Computer that also happens to
          // have a local roster. Unmanaged callers keep the original contract.
          if (!tag.ok && !viewer.managed)
            return err(400, `unknown user "${tag.unknown}" (expected one of the roster emails)`);
          // A rotation the human already asked for lands here, at the first
          // moment the bot is demonstrably reachable. Rotating before the
          // message is sent is what guarantees the message is answered under
          // the new configuration rather than the old one.
          bot = await applyPendingBotRotation(migrateLegacyBotRefreshFlag(bot));
          const botId = bot.id;
          return serializeBotWork(botId, async () => {
            const activeBot = (await getBot(botId)) ?? bot!;
            if (activeBot.rotationState === "queued") {
              return err(
                409,
                activeBot.rotationReason === "restart"
                  ? "bot restart is queued; retry after the current work completes"
                  : "bot refresh is waiting for the current turn to finish; retry in a moment",
              );
            }
            if (activeBot.rotationState === "rotating") {
              return err(
                409,
                activeBot.rotationReason === "restart"
                  ? "bot restart is in progress; retry in a moment"
                  : "bot refresh is in progress; retry in a moment",
              );
            }
            if (activeBot.rotationState === "failed" && activeBot.rotationReason === "config") {
              return err(409, `bot refresh failed: ${activeBot.rotationError || "apply the update again"}`);
            }
            // Attribute before launching: when the session has to be started,
            // this text rides inside the launch prompt instead of racing it.
            const { author, trusted } = resolveBotMessageAuthor({
              viewer,
              rosterTagUser: tag.ok ? tag.user : undefined,
              botOwner: activeBot.owner,
              envUser: process.env.OMG_USER,
            });
            const attributed = `${formatBotAttribution(author, activeBot.name)}\n\n${text}`;
            const delivery = await deliverBotMessage(activeBot, attributed);
            if ("error" in delivery) return err(delivery.status, delivery.error);
            if (trusted) {
              const profile = userRoster().find(
                (user) => user.email.trim().toLowerCase() === author.trim().toLowerCase(),
              );
              ensureConversationHuman({
                conversationId:
                  activeBot.conversationId?.trim() ||
                  (await getBot(botId))?.conversationId?.trim() ||
                  delivery.sessionId,
                identity: author,
                name: profile?.name,
                avatar: profile?.avatar,
                role: "member",
              });
            }
            return json({ sessionId: delivery.sessionId });
          });
        }
      }
      {
        // Explicit runtime lifecycle action for a persistent bot conversation.
        // This is not the configuration Apply route below. Both converge on
        // rotateBotSession so locking, safe-state admission, continuity and
        // rollback have one owner.
        const match = path.match(/^\/api\/bots\/([^/]+)\/restart$/);
        if (match && req.method === "POST") {
          const id = decodeURIComponent(match[1]);
          const existing = await getBot(id);
          if (!existing) return err(404, "bot not found", "bot_restart_unavailable");

          // Managed access was already verified by the Computer proxy, which
          // supplies this viewer header. The request body cannot choose an
          // identity. Local installs keep the same machine-level control policy
          // as every existing bot mutation.
          const viewer = botViewerFromRequest(req, undefined);
          if (!visibleBotsForViewer([existing], viewer, rosterEmails(), undefined).length) {
            return err(403, "you cannot control this bot conversation", "bot_restart_forbidden");
          }
          if (!existing.enabled) {
            return err(409, "enable this bot before restarting its runtime", "bot_restart_unavailable");
          }
          if (!existing.conversationId?.trim() && !existing.sessionId?.trim()) {
            return err(409, "start this bot conversation before restarting its runtime", "bot_restart_unavailable");
          }

          const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
          const allowed = new Set(["expectedRuntimeSessionId"]);
          const unknown = Object.keys(body ?? {}).filter((key) => !allowed.has(key)).sort();
          if (unknown.length) {
            return err(400, `unsupported restart fields: ${unknown.join(", ")}`, "bot_restart_conflict");
          }
          if (!body || !Object.hasOwn(body, "expectedRuntimeSessionId")) {
            return err(400, "expectedRuntimeSessionId is required", "bot_restart_conflict");
          }
          const rawExpected = body.expectedRuntimeSessionId;
          if (rawExpected !== null && (typeof rawExpected !== "string" || !rawExpected.trim())) {
            return err(400, "expectedRuntimeSessionId must be a non-empty string or null", "bot_restart_conflict");
          }
          const expectedRuntimeSessionId = typeof rawExpected === "string" ? rawExpected.trim() : null;
          const outcome = await rotateBotSession(id, {
            reason: "restart",
            expectedRuntimeSessionId,
          });
          const after = (await getBot(id)) ?? existing;
          const conversationId = after.conversationId?.trim() || existing.conversationId?.trim() || null;

          if (outcome.ok) {
            return json({
              ok: true,
              state: outcome.rotated ? "restarted" : "already-restarted",
              conversationId,
              runtimeSessionId: outcome.sessionId,
              previousRuntimeSessionId: outcome.rotated ? outcome.previousSessionId : null,
            });
          }
          if (outcome.deferred) {
            // Not reachable: `botRotationAdmission` admits a restart
            // unconditionally, which is the point of the action. Handled so the
            // shared rotation outcome stays exhaustive, and reported as a
            // failure rather than as a "queued" restart that nothing will drain.
            return err(503, "the restart could not start; retry in a moment", "bot_restart_failed");
          }
          return err(outcome.status, outcome.error, "bot_restart_failed");
        }
      }
      {
        // Apply a pending configuration change by rotating the bot onto a fresh
        // canonical session. The explicit half of the feature: the human decides
        // when their conversation restarts, and gets told what happened.
        const match = path.match(/^\/api\/bots\/([^/]+)\/rotate$/);
        if (match && req.method === "POST") {
          const id = decodeURIComponent(match[1]);
          const existing = await getBot(id);
          if (!existing) return err(404, "bot not found");
          const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
          const allowed = new Set(["expectedRevision"]);
          const unknown = Object.keys(body ?? {}).filter((key) => !allowed.has(key)).sort();
          if (unknown.length) return err(400, `unsupported rotate fields: ${unknown.join(", ")}`);
          if (
            body?.expectedRevision !== undefined &&
            (!Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 1)
          ) {
            return err(400, "expectedRevision must be a positive integer");
          }
          const bot = migrateLegacyBotRefreshFlag(existing);
          const retryingCompaction =
            bot.rotationReason === "compaction" &&
            !botHasPendingConfig(bot);
          const outcome = await rotateBotSession(id, {
            reason: retryingCompaction ? "compaction" : "config",
            expectedRevision: retryingCompaction
              ? undefined
              : body?.expectedRevision as number | undefined,
          });
          const after = (await getBot(id)) ?? bot;
          if (outcome.ok) {
            return json({
              ok: true,
              rotated: outcome.rotated,
              sessionId: outcome.rotated ? outcome.sessionId : outcome.sessionId,
              previousSessionId: outcome.rotated ? outcome.previousSessionId : null,
              configStatus: botConfigStatus(after),
              configRevision: botConfigRevision(after),
            });
          }
          if (outcome.deferred) {
            // 202: accepted and pending, not refused. The rotation is recorded
            // on the record and applies at the next safe moment.
            return json(
              {
                ok: true,
                rotated: false,
                queued: true,
                blocked: outcome.blocked,
                activeChildren: outcome.children.length,
                configStatus: botConfigStatus(after),
                configRevision: botConfigRevision(after),
              },
              { status: 202 },
            );
          }
          return err(outcome.status, outcome.error);
        }
      }
      {
        const match = path.match(/^\/api\/bots\/([^/]+)$/);
        if (match) {
          const id = decodeURIComponent(match[1]);
          const current = await getBot(id);
          if (!current) return err(404, "bot not found");
          if (req.method === "PATCH") {
            const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
            if (!body) return err(400, "invalid bot patch");
            const name = body.name === undefined
              ? current.name
              : typeof body.name === "string" ? body.name.trim() : "";
            const persona = body.persona === undefined
              ? current.persona
              : typeof body.persona === "string" ? body.persona.trim() : "";
            if (!name || !persona) return err(400, "name and persona are required");
            if (body.enabled !== undefined && typeof body.enabled !== "boolean")
              return err(400, "enabled must be a boolean");
            const agentValue = body.agent === undefined
              ? current.agent
              : typeof body.agent === "string" ? body.agent.trim() : "";
            const model = body.model === undefined
              ? current.model
              : typeof body.model === "string" ? body.model.trim() || undefined : undefined;
            const thinkingLevel = body.thinkingLevel === undefined
              ? current.thinkingLevel
              : typeof body.thinkingLevel === "string" ? body.thinkingLevel.trim() || undefined : undefined;
            const config = validateBotAgent(agentValue, model, thinkingLevel);
            if ("error" in config) return err(400, config.error);
            const cwd = body.cwd === undefined
              ? current.cwd
              : typeof body.cwd === "string" ? body.cwd.trim() || undefined : undefined;
            if (cwd && !(await listRepos()).some((repo) => repo.cwd === cwd))
              return err(400, "unknown repo");
            let owner = current.owner;
            if (body.user !== undefined) {
              const tag = resolveSessionUserTag(typeof body.user === "string" ? body.user : undefined);
              if (!tag.ok)
                return err(400, `unknown user "${tag.unknown}" (expected one of the roster emails)`);
              owner = tag.user;
            }
            const avatar = readBotAvatar(body);
            if ("error" in avatar) return err(400, avatar.error);
            // Version the edit by what actually changed, not by which keys the
            // form happened to submit. A cosmetic-only save must leave the
            // revision alone so the bot keeps reading "Current" and is never
            // offered a rotation that would change nothing.
            const nextConfig = {
              name,
              persona,
              description: current.description,
              capabilities: current.capabilities,
              agent: config.agent,
              model,
              thinkingLevel,
              cwd,
              owner,
            };
            const materiallyChanged = sessionBoundConfigChanged(
              sessionBoundConfigOf(current),
              nextConfig,
            );
            const bot = await updateBot(id, {
              ...nextConfig,
              shape: body.shape === undefined ? current.shape : avatar.shape,
              colorway: body.colorway === undefined ? current.colorway : avatar.colorway,
              enabled: body.enabled === undefined ? current.enabled : body.enabled,
              ...(materiallyChanged
                ? {
                    configRevision: nextBotConfigRevision(current),
                    // Editing does NOT start a rotation. The revision gap alone
                    // makes the status read "Update available", and applying it
                    // is the human's explicit call — that is the whole point of
                    // the control. Any queued-or-failed state from a previous
                    // revision is cleared here rather than left up, because it
                    // describes a target that no longer exists and would report
                    // the wrong revision's error against the new edit.
                    rotationState: "idle" as const,
                    rotationReason: undefined,
                    rotationExpectedSessionId: undefined,
                    rotationError: undefined,
                    rotationUpdatedAt: Date.now(),
                  }
                : {}),
            });
            return json({
              bot,
              configStatus: bot ? botConfigStatus(bot) : "current",
              configRevision: bot ? botConfigRevision(bot) : 1,
            });
          }
          if (req.method === "DELETE") {
            return serializeBotWork(id, async () => {
              const deleting = await getBot(id);
              if (!deleting) return err(404, "bot not found");
              const sessions = await listSessions();
              const live = sessions.find((session) =>
                session.botId === id ||
                (deleting.sessionId && (
                  session.sessionId === deleting.sessionId ||
                  session.nativeSessionId === deleting.sessionId
                ))
              );
              if (live?.sessionId) {
                const outcome = await closeLiveSession(live, live.sessionId, {
                  sessionId: live.sessionId,
                  source: "bot_delete",
                  botId: id,
                });
                if (!outcome.ok) return err(outcome.status, outcome.reason);
              }
              for (const stale of listManaged().filter((row) => row.botId === id)) {
                removeManaged(stale.tmuxName);
                assignUser(stale.tmuxName, null);
              }
              // A deleted bot can never receive its own routine nudges again —
              // leaving its rows behind would otherwise make "deleted bot with
              // live routines" the steady state instead of the rare transient
              // window the scheduler already tolerates (missing/disabled bot:
              // skip, log, stamp lastRunAt so it doesn't retry every tick).
              const removedRoutines = await deleteAutoAgentsOwnedByBot(id);
              await deleteBot(id);
              invalidateListSessionsCache();
              return json({ ok: true, removedRoutines });
            });
          }
        }
      }

      // ---- auto agents (streamlined: prompt + schedule → findings) ----
      if (path === "/api/auto/agents") {
        const callerBot = await callerBotId(req);
        if (req.method === "GET") {
          const agents = await listAutoAgents();
          const settings = await getGlobalSettings();
          // A bot caller only ever sees its own rows — this is the query
          // surface omg_list_my_routines relies on. The human/browser view
          // (no caller header) stays unfiltered admin, unchanged.
          const scoped = callerBot
            ? agents.filter((a) => a.owner.kind === "bot" && a.owner.botId === callerBot)
            : agents;
          // `?full=1` opts back into whole prompts for a caller that genuinely
          // needs them. The default is truncated because the two hot callers —
          // the list poll and the MCP listing tool — both only want enough to
          // identify a row, and the MCP one is feeding an LLM context window.
          const full = url.searchParams.get("full") === "1";
          return json({
            agents: scoped.map(full ? withAutoAgentMeta : withAutoAgentListMeta),
            tz: settings.timeZone,
          });
        }
        if (req.method === "POST") {
          const b = (await req.json().catch(() => null)) as {
            id?: string;
            name?: string;
            prompt?: string;
            schedule?: string;
            enabled?: boolean;
            cwd?: string;
            agent?: string;
            claudeAccountId?: string | null;
            model?: string;
            thinkingLevel?: string;
            tools?: string[];
            owner?: { kind?: string; botId?: string } | null;
          } | null;
          if (!b?.name || !b?.prompt || !b?.schedule) {
            return err(400, "name, prompt and schedule are required");
          }
          // Editing an existing row: look up its CURRENT owner and guard
          // before saving — the row's actual owner decides this, never
          // anything the request body claims.
          let existingForEdit: AutoAgent | null = null;
          if (b.id) {
            existingForEdit = await getAutoAgent(b.id);
            if (!existingForEdit) return err(404, "unknown auto agent");
            const allowed = await assertCanModifyAutoAgent(existingForEdit, callerBot);
            if (!allowed.ok) return err(allowed.status, allowed.error);
          }
          // A bot caller is forced onto itself; a human/browser caller may name
          // any owner, which is what makes the §8 migration of an existing
          // user-owned schedule onto an existing bot possible.
          const resolvedOwner = resolveRequestedAutoAgentOwner(callerBot, b.owner);
          if (!resolvedOwner.ok) return err(resolvedOwner.status, resolvedOwner.error);
          const owner = resolvedOwner.owner;
          // The per-bot cap and the frequency ceiling are properties of a
          // bot-owned row, not of the caller. Apply them to any row that ENDS
          // UP bot-owned, so a human-driven migration cannot smuggle a row
          // past the same limits omg_schedule_routine enforces. A row already
          // owned by that same bot is exempt from the cap: editing it in place
          // does not add a routine.
          const becomesBotOwned = owner?.kind === "bot" ? owner.botId : null;
          if (becomesBotOwned) {
            // A row must never end up owned by a bot that is gone or disabled:
            // the scheduler's delivery guard drops such an occurrence with only
            // a server log, so a migration typo would silently stop the job.
            // Skipped for a bot caller, whose own existence is already proven
            // by resolving its caller session.
            if (!callerBot) {
              const target = await getBot(becomesBotOwned);
              if (!target) return err(404, `unknown bot "${becomesBotOwned}"`);
              if (!target.enabled)
                return err(
                  400,
                  `bot "${target.name}" is disabled — enable it before it owns a routine`,
                );
            }
            const settings = await getGlobalSettings();
            const alreadyOwnedByTarget =
              existingForEdit?.owner.kind === "bot" &&
              existingForEdit.owner.botId === becomesBotOwned;
            const current = await countAutoAgentsOwnedByBot(becomesBotOwned);
            if (!alreadyOwnedByTarget && current >= settings.maxBotSchedules) {
              return err(
                409,
                callerBot
                  ? `you already have ${current}/${settings.maxBotSchedules} scheduled routines — delete one with omg_unschedule_routine before creating another`
                  : `that bot already owns ${current}/${settings.maxBotSchedules} scheduled routines — free a slot before assigning another`,
              );
            }
            if (exceedsMaxFrequency(b.schedule, settings.timeZone)) {
              return err(
                400,
                "that schedule fires too often for a bot-owned routine — the box rejects anything past a fixed frequency ceiling (about every 30 minutes)",
              );
            }
          }
          const autoAgent = b.agent?.trim() || undefined;
          if (autoAgent && !AUTO_AGENT_BACKENDS.includes(autoAgent as any)) {
            return err(400, `unknown auto agent provider "${autoAgent}"`);
          }
          const autoBackend = autoAgent || "aisdk";
          // Pinning the account a scheduled run bills to is Claude-only. Reject
          // an id for any other backend rather than storing a field its runner
          // will silently ignore.
          //
          // The tri-state matters: an ABSENT field means "don't touch the pin"
          // (the CLI and the refine endpoint save without one), while an empty
          // field means the user picked Claude · Auto and the pin must go.
          // Folding both into undefined made un-pinning impossible.
          const claudeAccountId =
            b.claudeAccountId === undefined
              ? undefined
              : (typeof b.claudeAccountId === "string" ? b.claudeAccountId.trim() : "") || null;
          if (claudeAccountId) {
            if (autoBackend !== "aisdk")
              return err(400, `claudeAccountId is not supported for ${autoBackend} auto agents`);
            if (!resolveClaudeAccount(claudeAccountId))
              return err(400, "Claude account is missing or not connected");
          }
          const model = b.model?.trim() || undefined;
          if (autoBackend === "aisdk" && model) {
            const allowed = modelsForAgent("aisdk");
            if (!allowed.includes(model))
              return err(400, `unknown model "${model}" (expected one of ${allowed.join(", ")})`);
          }
          if (autoBackend === "codex-aisdk" && model && !/^[A-Za-z0-9_.:-]{1,80}$/.test(model))
            return err(400, "invalid codex model name");
          if (autoBackend === "grok" && model) {
            const allowed = modelsForAgent("grok");
            if (!allowed.includes(model))
              return err(400, `unknown model "${model}" (expected one of ${allowed.join(", ")})`);
          }
          if (autoBackend === "cursor" && model && !/^[A-Za-z0-9_.:\/-]{1,120}$/.test(model))
            return err(400, "invalid cursor model name");
          if (autoBackend === "fx" && model && !/^[A-Za-z0-9_.:\/-]{1,120}$/.test(model))
            return err(400, "invalid fx model name");
          if (autoBackend === "opencode" && model && !/^[A-Za-z0-9_.:\/-]{1,80}$/.test(model))
            return err(400, "invalid opencode model name");
          const thinkingLevel = b.thinkingLevel?.trim() || undefined;
          if (thinkingLevel) {
            const allowed = thinkingLevelsForAgent(autoBackend);
            if (!allowed)
              return err(400, `thinkingLevel is not supported for ${autoBackend} auto agents`);
            if (!allowed.includes(thinkingLevel))
              return err(400, `unknown thinking level "${thinkingLevel}" for ${autoBackend} (expected one of ${allowed.join(", ")})`);
          }
          const agent = await saveAutoAgent({
            id: b.id,
            name: b.name,
            prompt: b.prompt,
            schedule: b.schedule,
            enabled: b.enabled !== false,
            owner,
            cwd: b.cwd,
            agent: autoAgent as any,
            claudeAccountId,
            model,
            thinkingLevel,
            tools: Array.isArray(b.tools) ? b.tools : undefined,
          });
          return json({ agent: withAutoAgentMeta(agent) });
        }
      }
      // Resolve a client-supplied cwd to a KNOWN repo before we ever chdir into
      // it for a compose/enhance pass. Unknown/blank → undefined (repo-blind,
      // tool-less generation) rather than a hard error or an arbitrary chdir.
      const resolveAutoCwd = async (cwd: unknown): Promise<string | undefined> => {
        const want = typeof cwd === "string" ? cwd.trim() : "";
        if (!want) return undefined;
        return (await listRepos()).find((r) => r.cwd === want)?.cwd;
      };
      if (path === "/api/auto/enhance-prompt" && req.method === "POST") {
        const b = (await req.json().catch(() => null)) as {
          prompt?: string;
          name?: string;
          cwd?: string;
        } | null;
        if (!b?.prompt?.trim()) return err(400, "prompt is required");
        try {
          const { enhanceAutoPrompt } = await import("../auto/enhance.ts");
          const cwd = await resolveAutoCwd(b.cwd);
          const prompt = await enhanceAutoPrompt(b.prompt, b.name, cwd, (l) =>
            console.log(l),
          );
          return json({ prompt });
        } catch (e) {
          return err(502, e instanceof Error ? e.message : String(e));
        }
      }
      // Single-box create: one freeform prompt → a full agent draft (name,
      // schedule, enhanced prompt), grounded in the selected repo when given.
      // The UI saves it via POST /api/auto/agents.
      if (path === "/api/auto/compose" && req.method === "POST") {
        const b = (await req.json().catch(() => null)) as {
          prompt?: string;
          cwd?: string;
        } | null;
        if (!b?.prompt?.trim()) return err(400, "prompt is required");
        try {
          const { composeAutoAgent } = await import("../auto/enhance.ts");
          const cwd = await resolveAutoCwd(b.cwd);
          const draft = await composeAutoAgent(b.prompt, cwd, (l) =>
            console.log(l),
          );
          return json({ draft });
        } catch (e) {
          return err(502, e instanceof Error ? e.message : String(e));
        }
      }
      {
        const m = path.match(/^\/api\/auto\/agents\/([a-z0-9_-]+)$/);
        // One agent, whole prompt included. The list deliberately truncates
        // (see AUTO_AGENT_LIST_PROMPT_CHARS), so this is where the editor gets
        // the real text back before anyone edits and re-saves it — without it,
        // opening and saving a long agent would silently store the preview.
        if (m && req.method === "GET") {
          const agent = await getAutoAgent(m[1]);
          if (!agent) return err(404, "unknown auto agent");
          return json({ agent: withAutoAgentMeta(agent) });
        }
        if (m && req.method === "DELETE") {
          const agent = await getAutoAgent(m[1]);
          if (!agent) return err(404, "unknown auto agent");
          const allowed = await assertCanModifyAutoAgent(agent, await callerBotId(req));
          if (!allowed.ok) return err(allowed.status, allowed.error);
          await deleteAutoAgent(m[1]);
          return json({ ok: true });
        }
      }
      {
        const m = path.match(/^\/api\/auto\/agents\/([a-z0-9_-]+)\/run$/);
        if (m && req.method === "POST") {
          const agent = await getAutoAgent(m[1]);
          if (!agent) return err(404, "unknown auto agent");
          const allowed = await assertCanModifyAutoAgent(agent, await callerBotId(req));
          if (!allowed.ok) return err(allowed.status, allowed.error);
          if (agent.owner.kind === "bot") {
            // A bot-owned row was never meant to run standalone — "run now"
            // delivers the same nudge the schedule would, immediately,
            // instead of calling the headless runner against it.
            const bot = await getBot(agent.owner.botId);
            if (!bot || !bot.enabled) return err(409, "the owning bot is gone or disabled");
            void deliverBotMessage(bot, routineNudgeText(agent)).then((result) => {
              if ("error" in result) console.error(`[auto] manual bot-routine run failed: ${result.error}`);
            });
            return json({ ok: true });
          }
          // fire-and-forget; the finding surfaces via the findings poll
          void runAutoAgent(agent, (l) => console.log(l)).catch((e) =>
            console.error("[auto] manual run failed:", e),
          );
          return json({ ok: true });
        }
      }
      // Feedback → a tuned agent, in place. The user is looking at a finding,
      // says what the agent should have done differently, and we rewrite that
      // agent's own instruction so the correction survives into the next
      // scheduled run. Everything else about the row (schedule, backend, cwd)
      // is carried through untouched.
      {
        const m = path.match(/^\/api\/auto\/agents\/([a-z0-9_-]+)\/refine$/);
        if (m && req.method === "POST") {
          const b = (await req.json().catch(() => null)) as {
            feedback?: string;
            findingId?: string;
          } | null;
          if (!b?.feedback?.trim()) return err(400, "feedback is required");
          const agent = await getAutoAgent(m[1]);
          if (!agent) return err(404, "unknown auto agent");
          // Only ever ground the rewrite in a finding this agent actually
          // produced — an id from another agent would teach it about work it
          // does not do.
          const findingId = b.findingId?.trim();
          const finding = findingId
            ? (await listFindings()).find((f) => f.id === findingId && f.agentId === agent.id)
            : undefined;
          try {
            const { refineAutoPrompt } = await import("../auto/enhance.ts");
            const cwd = await resolveAutoCwd(agent.cwd);
            const prompt = await refineAutoPrompt(
              {
                name: agent.name,
                prompt: agent.prompt,
                feedback: b.feedback,
                finding: finding
                  ? {
                      title: finding.title,
                      reasoning: finding.reasoning,
                      suggest: finding.suggest,
                      severity: finding.severity,
                    }
                  : undefined,
              },
              cwd,
              (l) => console.log(l),
            );
            const saved = await saveAutoAgent({
              id: agent.id,
              name: agent.name,
              prompt,
              schedule: agent.schedule,
              enabled: agent.enabled,
              cwd: agent.cwd,
              agent: agent.agent,
              model: agent.model,
              thinkingLevel: agent.thinkingLevel,
              tools: agent.tools,
            });
            return json({ agent: withAutoAgentMeta(saved) });
          } catch (e) {
            return err(502, e instanceof Error ? e.message : String(e));
          }
        }
      }
      if (path === "/api/auto/findings" && req.method === "GET") {
        const status = url.searchParams.get("status") || undefined;
        return json({ findings: await listFindings(status) });
      }

      // ── Client (frontend) error auto-report → auto-fix ────────────────────
      // The web app funnels uncaught errors here. Each report is stored, shown
      // to the human via the findings feed + push, and (for real shipped builds)
      // an Opus fix agent is dispatched. Heavily storm-guarded inside the module
      // — a render loop can't fork a fleet of agents. Always 200s so a reporting
      // failure never cascades back into the page that's already broken.
      if (path === "/api/client-error" && req.method === "POST") {
        const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
        if (!b || typeof b.message !== "string" || !b.message.trim())
          return err(400, "missing message");
        try {
          const r = await reportClientError(b as Parameters<typeof reportClientError>[0]);
          return json(r);
        } catch (e) {
          console.error("[client-error] report failed:", e);
          return json({ stored: false, reported: false, dispatched: false });
        }
      }
      if (path === "/api/client-errors" && req.method === "GET") {
        const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "200", 10) || 200, 1), 1000);
        return json({ errors: await listClientErrors(limit) });
      }

      // ── Web Push (PWA notifications) ──────────────────────────────────────
      // The VAPID public key the browser needs for pushManager.subscribe().
      if (path === "/api/push/vapid" && req.method === "GET") {
        return json({ key: await vapidPublicKey() });
      }
      // Register / refresh a browser subscription.
      if (path === "/api/push/subscribe" && req.method === "POST") {
        const b = (await req.json().catch(() => null)) as
          | (PushSubscription & { user?: string | null })
          | null;
        if (!b?.endpoint) return err(400, "missing endpoint");
        await saveSubscription(b);
        return json({ ok: true });
      }
      // Drop a subscription (user turned notifications off / re-subscribed).
      if (path === "/api/push/unsubscribe" && req.method === "POST") {
        const b = (await req.json().catch(() => null)) as { endpoint?: string } | null;
        if (b?.endpoint) await removeSubscription(b.endpoint);
        return json({ ok: true });
      }
      // Per-device notification feed: resolve this subscription's bound user and
      // return ONLY that user's pending items. The service worker calls this on
      // a (payload-less) push so it never renders another user's question.
      if (path === "/api/push/pending" && req.method === "GET") {
        const endpoint = url.searchParams.get("endpoint");
        const me = endpoint ? await subscriptionUser(endpoint) : null;
        const notification = endpoint ? await takePushNotification(endpoint) : null;
        await sweepExpiredQuestions();
        const openQs = await listQuestions("open");
        let questions = openQs;
        if (me) {
          const sessions = await listSessionsCached();
          const ownedSessionIds = new Set<string>();
          for (const session of sessions) {
            if (session.assignedUser !== me) continue;
            if (session.sessionId) ownedSessionIds.add(session.sessionId);
            if (session.nativeSessionId) ownedSessionIds.add(session.nativeSessionId);
          }
          questions = openQs.filter((question) =>
            questionVisibleToUser(question, me, ownedSessionIds)
          );
        }
        // Findings are global (not user-private), so they pass through as-is.
        const findings = await listFindings("open");
        return json({ user: me, notification, questions, findings });
      }

      // ── Ask-user (human-in-the-loop for headless agents) ──────────────────
      // List open/all questions — the UI poller and the voice agent both read
      // this so they can surface and answer what's pending.
      if (path === "/api/ask" && req.method === "GET") {
        const status = url.searchParams.get("status") as
          | "open"
          | "answered"
          | "dismissed"
          | "expired"
          | null;
        const user = url.searchParams.get("user");
        // Stale asks must not be handed to a consumer that will act on them:
        // `lfg connect` turns every open row here into an `auto.question`
        // channel event, and the omg brain can route a reply into it.
        if (status === "open" || !status) await sweepExpiredQuestions();
        let rows = await listQuestions(status ?? undefined);
        if (user) rows = rows.filter((q) => !q.user || q.user === user);
        return json({ questions: rows });
      }
      // Agent asks a question. The preferred path (MCP lfg_ask_user) is
      // fire-and-forget: pushback=true + wait=false. The agent gets the id back
      // immediately and ends its turn; when the human answers — minutes or hours
      // later — the reply is pushed into the asking session as a new user
      // message. The legacy long-poll (wait !== false) is kept for old callers
      // but is deprecated: it times out whenever the user isn't around.
      if (path === "/api/ask" && req.method === "POST") {
        const b = (await req.json().catch(() => null)) as {
          question?: string;
          options?: string[];
          agentId?: string | null;
          sessionId?: string | null;
          user?: string | null;
          pushback?: boolean;
          wait?: boolean;
          timeoutMs?: number;
        } | null;
        if (!b?.question?.trim()) return err(400, "missing question");
        const q = await addQuestion({
          question: b.question,
          options: b.options,
          agentId: b.agentId,
          sessionId: b.sessionId,
          user: b.user,
          pushback: b.pushback === true,
        });
        // Wake the user with a push (user-scoped). Voice talk-back happens when
        // they engage: open questions are surfaced in the voice snapshot below,
        // so the voice agent can read them out and answer on the user's behalf.
        // Carry the question in the push itself. A wake-only push would make
        // the worker fetch /api/push/pending, which it can only reach when the
        // app is served from this box.
        void notifyAll({
          user: q.user,
          notification: {
            title: "omg needs your input",
            body:
              q.options?.length
                ? `${q.question} — ${q.options.join(" / ")}`
                : q.question,
            url: "/",
            tag: `ask-${q.id}`,
            requireInteraction: true,
          },
        }).catch(() => {});
        // Pushback asks never block — the answer arrives via session injection.
        if (q.pushback || b.wait === false) return json({ id: q.id, status: q.status });
        // Cap the block so a stuck request can't pin a connection forever.
        const timeoutMs = Math.min(Math.max(b.timeoutMs ?? 180_000, 1_000), 600_000);
        const answered = await waitForAnswer(q.id, timeoutMs);
        if (!answered || answered.status !== "answered") {
          return json({ id: q.id, status: "open", answer: null });
        }
        return json({ id: q.id, status: "answered", answer: answered.answer });
      }
      // Poll a single question (for agents that asked with wait=0).
      {
        const m = path.match(/^\/api\/ask\/([0-9a-f]+)$/);
        if (m && req.method === "GET") {
          const q = await getQuestion(m[1]);
          if (!q) return err(404, "unknown question");
          return json({ question: q });
        }
      }
      // Dismiss a question without treating that action as an answer.
      {
        const m = path.match(/^\/api\/ask\/([0-9a-f]+)\/dismiss$/);
        if (m && req.method === "POST") {
          const q = await dismissQuestion(m[1]);
          if (!q) return err(404, "unknown question");
          return json({ question: q });
        }
      }
      // Answer a question — from the web composer OR the voice agent on the
      // user's behalf. Wakes any blocked long-poll.
      {
        const m = path.match(/^\/api\/ask\/([0-9a-f]+)\/answer$/);
        if (m && req.method === "POST") {
          const b = (await req.json().catch(() => null)) as {
            answer?: string;
            via?: "voice" | "web";
            deliver?: boolean;
          } | null;
          if (!b?.answer?.trim()) return err(400, "missing answer");
          const q = await answerQuestion(m[1], { answer: b.answer.trim(), via: b.via });
          if (!q) return err(404, "unknown or already-answered question");
          // `deliver: false` — the person answered by typing in the owning
          // session's own composer, so that message is ALREADY on its way to
          // the agent. Record the answer (this also wakes a blocked long-poll)
          // and stop: injecting it here as well would say the same sentence
          // twice, in two different shapes, to an agent that asked once.
          if (b.deliver === false) {
            await markHandled(q.id);
            return json({ question: q, delivered: false });
          }
          // Deliver the reply to the target session NOW (the answer IS the
          // user's consent), deterministically — don't wait for the supervisor's
          // next run to re-interpret it. Reuse the validated /send and /close
          // routes via a loopback call. On any failure we leave the question
          // "answered" so the supervisor's STEP 1 still backstops it.
          if (q.sessionId && q.pushback) {
            // Fire-and-forget ask: the asking agent ended its turn and is NOT
            // polling, so this injection is the only way the answer reaches it.
            // Always deliver verbatim — no interpretation, a plain "no" is a
            // real answer here. Steer mode wakes an idle session.
            //
            // formatPushbackAnswerText puts Their reply first: a live Grok
            // incident (2026-08-05) dropped trailing lines of the multi-line
            // envelope while sendq still confirmed on a head-only needle, so
            // the agent saw "answer body empty" despite a stored choice.
            const text = formatPushbackAnswerText(q);
            try {
              const r = await fetch(
                `http://127.0.0.1:${PORT}/api/sessions/${q.sessionId}/send`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ text, mode: "steer" }),
                },
              );
              if (r.ok) await markHandled(q.id);
              // On failure the question stays "answered" and is visible in the
              // ask feed; the supervisor backstop can still deliver it.
            } catch {
              // loopback failed — leave answered
            }
          } else if (q.sessionId) {
            const plan = plannedSessionAction(q.answer ?? "");
            try {
              if (plan.kind === "send") {
                const r = await fetch(
                  `http://127.0.0.1:${PORT}/api/sessions/${q.sessionId}/send`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ text: plan.text }),
                  },
                );
                if (r.ok) await markHandled(q.id);
              } else if (plan.kind === "close") {
                const r = await fetch(
                  `http://127.0.0.1:${PORT}/api/sessions/${q.sessionId}/close`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ source: "ask_answer_close" }),
                  },
                );
                if (r.ok) await markHandled(q.id);
              } else {
                await markHandled(q.id); // "leave it" — resolved, nothing to deliver
              }
            } catch {
              // loopback failed — leave answered; STEP 1 retries next run
            }
          }
          return json({ question: q });
        }
      }
      // Mark an answered question as acted-upon (the supervisor calls this after
      // it carries out the user's decision, so it doesn't act on it again).
      {
        const m = path.match(/^\/api\/ask\/([0-9a-f]+)\/handled$/);
        if (m && req.method === "POST") {
          const q = await markHandled(m[1]);
          if (!q) return err(404, "unknown or not-yet-answered question");
          return json({ question: q });
        }
      }
      {
        const m = path.match(/^\/api\/auto\/findings\/([0-9a-f]+)$/);
        if (m && req.method === "POST") {
          const b = (await req.json().catch(() => null)) as {
            // "resolved" is the only status that means the problem is gone
            // (store.ts). Omitting it here left it unreachable from the UI, so
            // findings could only ever pile up in unresolved states.
            status?: "open" | "dismissed" | "session" | "read" | "resolved";
            sessionId?: string;
          } | null;
          const patch: { status?: NonNullable<typeof b>["status"]; sessionId?: string } = {};
          if (b?.status) patch.status = b.status;
          if (b?.sessionId) patch.sessionId = b.sessionId;
          const f = await updateFinding(m[1], patch);
          if (!f) return err(404, "unknown finding");
          return json({ finding: f });
        }
      }

      // Instrumentation: which CTA the user tapped on a finding, and whether
      // they had typed an instruction first. Fire-and-forget from the client.
      {
        const m = path.match(/^\/api\/auto\/findings\/([0-9a-f]+)\/action$/);
        if (m && req.method === "POST") {
          const b = (await req.json().catch(() => null)) as {
            path?: FindingActionPath;
            hadText?: boolean;
          } | null;
          if (
            b?.path !== "reply" &&
            b?.path !== "execute" &&
            b?.path !== "copy" &&
            b?.path !== "dismiss" &&
            b?.path !== "feedback"
          )
            return err(400, "expected { path: reply|execute|copy|dismiss|feedback }");
          await logFindingAction({
            findingId: m[1],
            path: b.path,
            hadText: !!b.hadText,
          });
          return json({ ok: true });
        }
      }

      // ---- runs ----
      {
        const m = path.match(/^\/api\/agents\/([a-z0-9_-]+)\/run$/);
        if (m && req.method === "POST") {
          try {
            await loadAgent(m[1]);
          } catch (e) {
            return err(404, e instanceof Error ? e.message : String(e));
          }
          const state = await startRun(m[1]);
          return json({ runId: state.id, agent: state.agent, date: state.date });
        }
      }

      {
        const m = path.match(/^\/api\/agents\/([a-z0-9_-]+)\/runs\/([0-9a-f]+)$/);
        if (m) {
          const state = RUNS.get(m[2]);
          if (!state) return err(404, "run not found");
          if (req.headers.get("accept")?.includes("text/event-stream")) {
            const stream = new ReadableStream({
              start(controller) {
                const send = (ev: { line?: string; final?: RunState }) => {
                  if (ev.line) {
                    controller.enqueue(
                      `event: log\ndata: ${JSON.stringify(ev.line)}\n\n`,
                    );
                  }
                  if (ev.final) {
                    controller.enqueue(
                      `event: ${ev.final.status}\ndata: ${JSON.stringify({
                        status: ev.final.status,
                        result: ev.final.result,
                        error: ev.final.error,
                      })}\n\n`,
                    );
                    controller.close();
                  }
                };
                for (const l of state.logs) send({ line: l });
                if (state.status !== "running") {
                  send({ final: state });
                  return;
                }
                state.subscribers.add(send);
              },
              cancel() {
                // sub gets evicted with the run eventually
              },
            });
            return new Response(stream, { headers: sseHeaders() });
          }
          // plain JSON status
          return json({
            id: state.id,
            agent: state.agent,
            status: state.status,
            logs: state.logs,
            result: state.result,
            error: state.error,
          });
        }
      }

      // ---- actions ----
      {
        const m = path.match(
          /^\/api\/actions\/([a-z0-9_-]+)\/(\d{4}-\d{2}-\d{2})$/,
        );
        if (m && req.method === "GET") {
          const rows = await readActionsSidecar(m[1], m[2]);
          return json({ agent: m[1], date: m[2], actions: rows });
        }
      }

      if (path === "/api/actions/execute" && req.method === "POST") {
        const body = (await req.json().catch(() => null)) as {
          agent?: string;
          date?: string;
          id?: string;
          force?: boolean;
        } | null;
        if (!body?.agent || !body.date || !body.id)
          return err(400, "expected { agent, date, id }");
        try {
          const r = await executeAction(body.agent, body.date, body.id, {
            force: !!body.force,
          });
          return json(r);
        } catch (e) {
          return err(400, e instanceof Error ? e.message : String(e));
        }
      }

      // Run several selected actions inside ONE agent session (one worktree),
      // instead of one dispatched agent per action.
      if (path === "/api/actions/execute-combined" && req.method === "POST") {
        const body = (await req.json().catch(() => null)) as {
          agent?: string;
          date?: string;
          ids?: string[];
          force?: boolean;
        } | null;
        if (!body?.agent || !body.date || !Array.isArray(body.ids) || body.ids.length === 0)
          return err(400, "expected { agent, date, ids: string[] }");
        try {
          const r = await executeActionsCombined(body.agent, body.date, body.ids, {
            force: !!body.force,
          });
          return json(r);
        } catch (e) {
          return err(400, e instanceof Error ? e.message : String(e));
        }
      }

      // ---- multi-user (session tagging) ----
      if (path === "/api/users") {
        // no-cache so the browser revalidates the roster on each load and picks
        // up the rotated avatar cache-buster (see gravatar()) rather than
        // serving a stale roster from heuristic HTTP caching.
        return json({ users: userRoster() }, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-cache",
          },
        });
      }

      // ---- cloud-browser profiles ----
      // ---- running claude sessions ----
      if (path === "/api/filesystem/directories" && req.method === "GET") {
        const home = await realpath(homedir());
        const requestedPath = url.searchParams.get("path");
        const requested = requestedPath || REPOS_ROOT;
        let current: string;
        try {
          // Fresh release/blank-project installs may not have run setup.sh,
          // which normally creates LFG_REPOS_ROOT. Make the default browser
          // landing folder usable without making arbitrary missing paths.
          if (!requestedPath) await mkdir(REPOS_ROOT, { recursive: true });
          current = await realpath(resolve(requested.replace(/^~(?=\/|$)/, home)));
        } catch {
          return err(
            400,
            `Folder “${requested}” does not exist. It may have moved or been deleted. Choose another folder.`,
          );
        }
        if (current !== home && !current.startsWith(`${home}/`)) {
          return err(403, "folder browsing is limited to your home directory");
        }
        const entries = (await readdir(current, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
          .sort((a, b) => a.name.localeCompare(b.name));
        const directories = await Promise.all(
          entries.map(async (entry) => {
            const cwd = join(current, entry.name);
            const isGitRepo = await stat(join(cwd, ".git")).then(() => true).catch(() => false);
            // Reads a single dirent rather than the whole listing, so flagging
            // the strays costs the same on a node_modules as on an empty dir.
            const isEmpty = await isDirEmpty(cwd);
            return { name: entry.name, path: cwd, isGitRepo, isEmpty };
          }),
        );
        const isGitRepo = await stat(join(current, ".git")).then(() => true).catch(() => false);
        return json({
          current,
          parent: current === home ? null : dirname(current),
          isGitRepo,
          directories,
        });
      }

      if (path === "/api/projects/use-folder" && req.method === "POST") {
        const b = (await req.json().catch(() => null)) as { path?: unknown } | null;
        if (typeof b?.path !== "string") return err(400, "path is required");
        try {
          const repo = await useProjectFolder(b.path);
          return json({ repo, repos: await listRepos() });
        } catch (e) {
          return err(400, e instanceof Error ? e.message : String(e));
        }
      }

      if (path === "/api/projects/create-folder" && req.method === "POST") {
        const b = (await req.json().catch(() => null)) as {
          parent?: unknown;
          name?: unknown;
        } | null;
        if (typeof b?.parent !== "string" || typeof b?.name !== "string") {
          return err(400, "parent and name are required");
        }
        try {
          const repo = await createProjectFolder(b.parent, b.name);
          return json({ repo, repos: await listRepos() });
        } catch (e) {
          return err(400, e instanceof Error ? e.message : String(e));
        }
      }

      // Deleting the folder itself, as opposed to DELETE /api/repos which only
      // unpins it from the picker. Always plan-then-confirm: an unconfirmed
      // call is a pure read that reports what is inside, so the client can put
      // the contents in front of the user before anything is destroyed.
      if (path === "/api/projects/delete-folder" && req.method === "POST") {
        const b = (await req.json().catch(() => null)) as {
          path?: unknown;
          confirm?: unknown;
        } | null;
        if (typeof b?.path !== "string") return err(400, "path is required");
        const guards = {
          home: homedir(),
          reposRoot: REPOS_ROOT,
          worktreeRoot: WORKTREE_ROOT,
          selfRepo: SELF_REPO,
          dataDir: PATHS.data,
        };
        try {
          const plan = await planFolderDelete(b.path, guards);
          // A running agent holds the working tree open; pulling the floor out
          // from under it corrupts the session rather than tidying anything.
          // listSessionsCached() is already the live roster (it is built from
          // pgrep), so presence in it is the liveness test.
          const busy = (await listSessionsCached().catch(() => [])).filter(
            (s) => !!s.cwd && cwdIsWithin(resolve(s.cwd), plan.path),
          );
          if (busy.length > 0) {
            return err(
              409,
              `Close the ${busy.length} session${busy.length === 1 ? "" : "s"} running in ${plan.name} before deleting it`,
            );
          }
          if (b.confirm !== true) return json({ ok: false, plan });
          await deleteFolder(b.path, guards);
          // The folder may also have been pinned as a custom repo; leaving that
          // entry behind would keep a dead path in the picker.
          await removeCustomRepo(plan.path);
          // And drop any hide for it. The path is gone, so the entry can never
          // match again — it would just accumulate in hidden-repos.json, and
          // worse, silently suppress a NEW project later created at the same
          // path (deleting and recreating "scratch" is an ordinary thing to do).
          await unhideRepo(plan.path);
          return json({ ok: true, path: plan.path, name: plan.name, repos: await listRepos() });
        } catch (e) {
          if (e instanceof FolderDeleteError) return err(e.status, e.message);
          return err(400, e instanceof Error ? e.message : String(e));
        }
      }

      // One-shot command execution. See src/exec.ts for why this exists and
      // why it is capped; the short version is that a remote caller has no
      // shell on this box, and spawning a whole session to read a file is
      // absurd. Seconds here; minutes belong in a session.
      if (path === "/api/exec" && req.method === "POST") {
        const b = (await req.json().catch(() => null)) as {
          command?: unknown;
          cwd?: unknown;
          timeoutMs?: unknown;
        } | null;
        const command = typeof b?.command === "string" ? b.command.trim() : "";
        if (!command) return err(400, "expected { command }");

        // cwd resolves through the same repo allowlist that POST
        // /api/sessions/new uses, rather than accepting any absolute path.
        // Two reasons: an agent that mistypes a path gets "unknown repo"
        // instead of silently running in $HOME, and the box keeps ONE answer
        // to "where may work happen" instead of a second one here.
        const repos = await listRepos();
        const requestedCwd = typeof b?.cwd === "string" ? b.cwd.trim() : "";
        const repo = requestedCwd
          ? repoForRequestedSessionCwd(repos, requestedCwd, undefined)
          : (repos.find((r) => r.cwd === SELF_REPO) ?? repos[0]);
        if (!repo) {
          return err(
            400,
            requestedCwd
              ? `unknown repo: ${requestedCwd}`
              : "no repositories are configured on this computer",
          );
        }

        const timeoutMs = clampExecTimeout(b?.timeoutMs);
        if (typeof b?.timeoutMs === "number" && b.timeoutMs > MAX_EXEC_TIMEOUT_MS) {
          return err(400, `timeoutMs may not exceed ${MAX_EXEC_TIMEOUT_MS}`);
        }
        return json(await runExecCommand({ command, cwd: repo.cwd, timeoutMs }));
      }

      if (path === "/api/repos") {
        if (req.method === "POST") {
          const b = (await req.json().catch(() => null)) as {
            path?: unknown;
            name?: unknown;
          } | null;
          const rawPath = typeof b?.path === "string" ? b.path : "";
          if (!rawPath.trim()) return err(400, "path is required");
          const rawName = typeof b?.name === "string" ? b.name : undefined;
          try {
            await addCustomRepo(rawPath, rawName);
          } catch (e) {
            return err(400, e instanceof Error ? e.message : String(e));
          }
          return json({ repos: await listRepos() });
        }
        if (req.method === "DELETE") {
          const b = (await req.json().catch(() => null)) as { cwd?: unknown } | null;
          const cwd = typeof b?.cwd === "string" ? b.cwd : "";
          if (!cwd.trim()) return err(400, "cwd is required");
          // Unlink, not just unpin. This used to call removeCustomRepo alone,
          // which meant removing a scanned repo filtered nothing, changed no
          // file, and still answered 200 — the UI showed "Project removed" over
          // a list the project was still in.
          const before = await listRepos();
          const target = before.find((r) => r.cwd === cwd);
          // Emptying the picker leaves no valid target for a new session, and
          // the way back (Browse) lives inside the same sheet the user just
          // emptied. Refuse rather than strand them.
          if (target && before.length === 1) {
            return err(400, "that's your last project — add another before removing it");
          }
          await unlinkRepo(cwd);
          return json({ repos: await listRepos() });
        }
        return json({ repos: await listRepos() });
      }

      if (path === "/api/sessions") {
        noteListSessionsClientActivity();
        const sessions = await listSessionsCached();
        warmChatTranscripts(sessions);
        // `?full=1` opts back into the spawn command line (`cmd`) — see
        // sessionListRow for why the default leaves it out. The one caller
        // that wants it is omg_list_sessions with verbose:true.
        const full = url.searchParams.get("full") === "1";
        // `pendingLogins` is how a HOST learns this box is mid-login.
        //
        // The control plane polls this route to decide whether the machine is
        // idle enough to hibernate, and it only ever counted agent sessions. A
        // browser login is real work that lives entirely in this process, so a
        // box with a half-finished Claude sign-in answered "not busy" and was
        // hibernated under the user (2026-08-17, a paying customer).
        //
        // ADDITIVE ON PURPOSE. An older host ignores the extra field, and a
        // newer host reading an older box sees `undefined` and falls back to
        // exactly today's behaviour. Neither side needs to ship first.
        return json({
          sessions: full ? sessions : sessions.map(sessionListRow),
          pendingLogins: pendingCodingAgentLogins(),
        });
      }

      if (path === "/api/install") {
        const install = installInfo();
        if (req.method === "GET") {
          if (url.searchParams.get("ready") === "1") return json({ bootId: SERVER_INSTANCE_ID });
          // A manual "Check" click forces a fresh lookup that bypasses the
          // 5-minute release-tag cache; the passive on-load check stays cached.
          // Source installs always `git fetch`, so they're never stale.
          const force = url.searchParams.get("refresh") === "1";
          const update = install.channel === "source"
            ? await sourceUpdateStatus(PATHS.root)
            : install.channel === "release"
              ? await releaseUpdateStatus(PATHS.root, install, force)
              : null;
          // Only worth fetching once an update is actually available on a
          // channel with release tags — a "here's what changed" list for the
          // version you're already on, or for a source checkout with no
          // CHANGELOG-aligned versioning, is not useful.
          const changelog = update?.channel === "release" && update.state === "available"
            ? await changelogDelta(PATHS.root, install, force)
            : [];
          return json({ install, update, changelog, bootId: SERVER_INSTANCE_ID });
        }
        if (req.method === "POST") {
          if (install.channel !== "source" && install.channel !== "release") {
            return err(400, "UI updates are only available for Git and release installs.");
          }
          if (selfUpdateRunning) return err(409, "An omg.dev update is already running.");
          selfUpdateRunning = true;
          try {
            const result = install.channel === "source"
              ? await applySourceUpdate(PATHS.root)
              : await applyReleaseUpdate(PATHS.root, install);
            const update = result.status;
            if (update.state === "blocked") return err(409, update.message);
            if (update.state === "available") return err(500, "The update did not reach origin/main.");
            if (result.updated) scheduleRestart();
            return json({ install, update, restarting: result.updated, bootId: SERVER_INSTANCE_ID });
          } catch (e) {
            return err(500, e instanceof Error ? e.message : String(e));
          } finally {
            selfUpdateRunning = false;
          }
        }
        return err(405, "method not allowed");
      }

      // The usage sources on this box — one per Claude account plus each other
      // provider — with no network calls. Clients fetch this first to lay out
      // their rings, then pull each source independently below.
      if (path === "/api/usage/providers") {
        return json({ providers: listUsageProviders() });
      }

      // One source, fetched on its own. This is what makes a single ring (the
      // composer's) or a single account's refresh cost one round-trip instead
      // of a full sweep of every provider.
      {
        const m = path.match(/^\/api\/usage\/(.+)$/);
        if (m) {
          const id = decodeURIComponent(m[1]);
          const force = url.searchParams.get("force") === "1";
          const provider = await getProviderUsage(id, { force });
          if (!provider) return err(404, `unknown usage provider ${id}`);
          return json({ provider });
        }
      }

      // Combined usage/limits across every agent provider (Claude, Codex,
      // Cursor, Grok, OpenCode) for the Settings → Usage page. Each provider is
      // self-cached for 60s, so this only pays for whatever has gone stale.
      if (path === "/api/usage") {
        return json({ providers: await getAllUsage({ force: url.searchParams.get("force") === "1" }) });
      }

      // Claude subscription usage (5-hour + 7-day windows) via the OAuth usage
      // endpoint, authed with the local Claude Code credentials. Cached for a
      // minute so reopening the new-session dialog doesn't hammer Anthropic.
      if (path === "/api/claude/usage") {
        if (usageCache && Date.now() - usageCache.at < 60_000)
          return json(usageCache.data);
        try {
          const token = claudeOauthToken();
          if (!token) return err(503, "no Claude credentials on this box");
          const r = await fetch("https://api.anthropic.com/api/oauth/usage", {
            headers: {
              Authorization: `Bearer ${token}`,
              "anthropic-beta": "oauth-2025-04-20",
            },
          });
          if (!r.ok) return err(502, `usage endpoint returned ${r.status}`);
          const u = (await r.json()) as {
            five_hour?: { utilization?: number; resets_at?: string | null };
            seven_day?: { utilization?: number; resets_at?: string | null };
          };
          const data = {
            ok: true,
            fiveHour: { pct: u.five_hour?.utilization ?? null, resetsAt: u.five_hour?.resets_at ?? null },
            sevenDay: { pct: u.seven_day?.utilization ?? null, resetsAt: u.seven_day?.resets_at ?? null },
          };
          usageCache = { at: Date.now(), data };
          return json(data);
        } catch (e) {
          return err(502, e instanceof Error ? e.message : String(e));
        }
      }

      // Tag a session to a user (or clear with user:null). Keyed server-side by
      // the session's tmux name so the tag survives /clear sessionId rotation.
      {
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/user$/);
        if (m && req.method === "POST") {
          const body = (await req.json().catch(() => null)) as { user?: string | null } | null;
          const sess = (await listSessions()).find((s) => s.sessionId === m[1]);
          const user = body?.user ?? null;
          if (user && !rosterEmails().includes(user)) return err(400, "unknown user");
          if (sess) {
            if (!sess.tmuxName) return err(409, "session is not in a tmux pane — cannot tag");
            if (!assignUser(sess.tmuxName, user)) return err(400, "unknown user");
            // Keep the durable session-id record in sync so closing/resuming a
            // managed SDK session does not lose its owner when tmux is removed.
            updateResumableUser(m[1], user);
          } else if (!updateResumableUser(m[1], user)) {
            return err(404, "session not found");
          }
          return json({ ok: true });
        }
      }

      // Start a new lfg-managed session. Native interactive agents use a tmux
      // pane; command-file SDK agents launch as direct processes. The durable
      // managed name identifies either lifecycle boundary end-to-end.
      // Closed/rebooted-away sessions that can be brought back with `claude
      // --resume`. After the box reboots, the live list (pgrep-based) is empty
      // but every transcript survives on disk — this surfaces those so the UI
      // can offer to resume one. Excludes anything currently live.
      if (path === "/api/sessions/resumable" && req.method === "GET") {
        const liveIds = await liveSessionIdsCached();
        const limit = Number(url.searchParams.get("limit")) || 30;
        const offset = Number(url.searchParams.get("offset")) || 0;
        const search = url.searchParams.get("search")?.trim() || undefined;
        const agentParam = url.searchParams.get("agent")?.trim();
        const agent = agentParam === "claude" || agentParam === "codex" || agentParam === "opencode" || agentParam === "pi"
          ? agentParam
          : undefined;
        const project = url.searchParams.get("project")?.trim() || undefined;
        const { sessions, total, facets } = await queryResumable({
          limit,
          offset,
          search,
          agent,
          project,
          excludeIds: liveIds,
        });
        return json({ sessions, total, facets });
      }

      if (path === "/api/sessions/find" && req.method === "POST") {
        const body = (await req.json().catch(() => null)) as {
          sessionId?: unknown;
          user?: unknown;
          project?: unknown;
          text?: unknown;
          activeAfter?: unknown;
          activeBefore?: unknown;
          limit?: unknown;
          scanLimit?: unknown;
        } | null;
        const parseTime = (value: unknown, field: string): number | undefined => {
          if (value === undefined || value === null || value === "") return undefined;
          const parsed =
            typeof value === "number"
              ? value
              : typeof value === "string"
                ? Date.parse(value)
                : Number.NaN;
          if (!Number.isFinite(parsed)) throw new Error(`${field} must be an ISO 8601 timestamp`);
          return parsed;
        };
        try {
          const live = await listSessionsCached();
          return json(await findSessions({
            sessionId: typeof body?.sessionId === "string" ? body.sessionId.trim() || undefined : undefined,
            user: typeof body?.user === "string" ? body.user.trim() || undefined : undefined,
            project: typeof body?.project === "string" ? body.project.trim() || undefined : undefined,
            text: typeof body?.text === "string" ? body.text.trim() || undefined : undefined,
            activeAfter: parseTime(body?.activeAfter, "activeAfter"),
            activeBefore: parseTime(body?.activeBefore, "activeBefore"),
            limit: typeof body?.limit === "number" ? body.limit : undefined,
            scanLimit: typeof body?.scanLimit === "number" ? body.scanLimit : undefined,
          }, live));
        } catch (error) {
          return err(400, error instanceof Error ? error.message : String(error));
        }
      }

      // Resume a closed session in its original cwd as a fresh managed session,
      // preserving the full conversation. Two engines:
      //  - claude: relaunch `claude --resume <id>`; it continues into a NEW
      //    sessionId, resolved from the pidfile (like /new) and handed back.
      //  - codex: spawn a codex-aisdk harness seeded with the rollout's threadId
      //    (== the resumed id). Codex resumes the SAME thread, so the live id
      //    stays the resumed id — we return it directly.
      if (path === "/api/sessions/resume" && req.method === "POST") {
        const body = (await req.json().catch(() => null)) as {
          sessionId?: string;
          model?: string;
          user?: string;
          prompt?: string;
          /** Start even though the live-agent cap is full — self-hosted only. */
          overLimit?: boolean;
        } | null;
        const sessionId = body?.sessionId?.trim();
        if (!sessionId) return err(400, "sessionId required");
        const model = body?.model?.trim() || undefined;
        // Already running? Don't double-spawn — point the client at the live one.
        //
        // listSessions() returns HISTORICAL sessions too, so identity alone does
        // not mean "live". A session whose harness died is still listed, with
        // pid 0. Matching on identity alone made every such session permanently
        // unresumable: this branch queued the prompt into a command file no
        // process was tailing, reported alreadyLive, and never cold-started.
        // That is how a run of `database is locked` harness deaths turned into
        // sessions that could not be recovered by any supported path.
        //
        // The pid is an unambiguous signal here: every live session carries a
        // running harness pid, and every dead one reports 0.
        const live = (await listSessions()).find(
          (s) =>
            (s.sessionId === sessionId || s.nativeSessionId === sessionId) &&
            isAisdkPidAlive(s.pid),
        );
        if (live) {
          if (body?.user && live.tmuxName) assignUser(live.tmuxName, body.user);
          const prompt = body?.prompt?.trim() ?? "";
          const sent = prompt
            // Resuming a session that is already live is a follow-up, not a
            // steering action. Queue it so a status/check click does not abort
            // the active turn or any Claude sidechain Explore agents.
            ? sendPromptToLiveSession(live, prompt, { mode: "queue" })
            : { ok: true as const, msg: undefined };
          if (!sent.ok) return err(409, sent.error || "couldn't send resume prompt");
          return json({
            ok: true,
            tmuxName: live.tmuxName,
            cwd: live.cwd,
            sessionId: live.sessionId ?? sessionId,
            resumedFrom: live.nativeSessionId ?? sessionId,
            alreadyLive: true,
            sentPrompt: !!prompt,
            msg: sent.msg,
            agent: live.agent,
          });
        }
        // Past this point a resume COLD-STARTS a fresh agent process, so it must
        // clear the same pause / cap gate as a create. (The already-live branch
        // above returned early and is never gated — it spawns nothing.)
        const resumeGate = await activationGate({ overLimit: body?.overLimit === true });
        if (resumeGate instanceof Response) return resumeGate;
        try {
        const cachedResume = getCachedResumableSession(sessionId);
        const pinnedClaudeAccountId = claudeAccountIdForSession(sessionId) ?? undefined;

        // Direct-indexed SDK sessions have no lfg-owned transcript JSONL to
        // discover. Relaunch from the durable catalog and keep the same lfg key
        // so the existing SQLite history remains the conversation read model.
        if (cachedResume?.backend) {
          const cwd = await resolveResumeCwd(cachedResume.cwd, cachedResume.project);
          const tmuxName = `lfg-${randomBytes(3).toString("hex")}`;
          const resumeHandle = cachedResume.resumeHandle || sessionId;
          const tag = resolveSessionUserTag(body?.user || cachedResume.assignedUser);
          if (!tag.ok) return err(400, `unknown user "${tag.unknown}"`);
          const assignedUser = tag.user;
          // Durable session identity wins over the new-composer selection. An
          // incompatible client model is ignored instead of crossing provider
          // families (the gpt-5.6-sol -> Claude error from the resume picker).
          const resumeModel = resolveResumeModel(cachedResume.backend, cachedResume.model, model);
          addManaged({
            tmuxName,
            cwd,
            createdAt: Date.now(),
            agent: cachedResume.backend,
            runtime: "command-file",
            sessionId,
            nativeSessionId: resumeHandle,
            launchState: "launching",
            model: resumeModel,
            ...(cachedResume.backend === "aisdk"
              ? { claudeAccountId: pinnedClaudeAccountId }
              : {}),
            title: cachedResume.title,
            project: cachedResume.project || undefined,
            repoRoot: repoRootForManagedCwd(cwd),
          });
          if (assignedUser) assignUser(tmuxName, assignedUser);
          // Claude resolves `--resume <id>` against the project dir derived from
          // the cwd it launches in. When a session's worktree has been reclaimed
          // by the sweeper we resume into a fallback cwd, and the conversation —
          // still filed under the deleted worktree's path — becomes invisible.
          // Claude then exits immediately with "No conversation found with
          // session ID", killing the harness before it registers, which surfaces
          // as a resume that starts and instantly stops. Re-file it first.
          if (cachedResume.backend === "aisdk") {
            const located = ensureConversationVisibleFrom(cwd, resumeHandle);
            if (located === "copied") {
              console.log(`[resume] re-filed conversation ${resumeHandle.slice(0, 8)} under ${cwd}`);
            } else if (located === "missing") {
              console.log(`[resume] no stored conversation for ${resumeHandle.slice(0, 8)}; starting fresh`);
            }
          }
          const prompt = body?.prompt?.trim() || undefined;
          const spawned = launchCodingAgentSession({
            agent: cachedResume.backend,
            name: tmuxName,
            cwd,
            prompt,
            model: resumeModel,
            sessionId,
            resume: resumeHandle,
            omgUser: assignedUser,
            claudeAccountId: pinnedClaudeAccountId,
          });
          if (!spawned.ok) {
            removeManaged(tmuxName);
            assignUser(tmuxName, null);
            return err(502, spawned.error || "failed to resume session");
          }
          patchManaged(tmuxName, { launchState: "running" });
          updateResumableUser(sessionId, assignedUser ?? null);
          invalidateListSessionsCache();
          return json({
            ok: true,
            tmuxName,
            cwd,
            sessionId,
            resumedFrom: sessionId,
            agent: cachedResume.backend,
          });
        }

        const transcript = await resolveTranscript(sessionId);
        if (!transcript) {
          console.warn(`[resume] no transcript found for ${sessionId} — cannot resume`);
          return err(404, "no transcript found for that session");
        }
        // jcode owns a durable journal under ~/.jcode/sessions keyed by its own
        // session id, and its REPL takes `--resume <id>`. Relaunch the pane
        // against that id so a rebooted box reopens the real conversation
        // instead of falling through to the claude harness, which cannot find
        // the lfg UUID and dies with "No conversation found with session ID".
        {
          const prior = listManaged().find(
            (row) =>
              row.agent === "jcode" &&
              (row.sessionId === sessionId || row.nativeSessionId === sessionId),
          );
          const jcodeNativeId = prior?.nativeSessionId;
          if (prior && jcodeNativeId && jcodeNativeId !== sessionId) {
            // This whole branch assumes `prior` is a pre-reboot row: its pane
            // died, and we are reconnecting the durable jcode conversation to
            // a fresh one. That assumption was never checked. A stale or
            // racing resume call hits this same branch while `prior`'s pane
            // is still alive, and the code below still deletes `prior`'s
            // registry row (see the removeManaged call further down) — the
            // live pane and its worktree keep running, untouched, but the
            // session vanishes from listManaged()/omg_list_sessions with no
            // trace. Observed 2026-08-23: session 7e2ba55a's row disappeared
            // this way while its process and worktree (lfg-54ec28) survived.
            // Refuse instead of silently orphaning a live row.
            if (tmuxHasSession(prior.tmuxName)) {
              return err(409, `Session ${sessionId} is already active in pane ${prior.tmuxName}. Resume is not needed.`);
            }
            const cwd = await resolveResumeCwd(prior.cwd, prior.project ?? cachedResume?.project);
            const tmuxName = `lfg-${randomBytes(3).toString("hex")}`;
            const tag = resolveSessionUserTag(body?.user || cachedResume?.assignedUser);
            if (!tag.ok) return err(400, `unknown user "${tag.unknown}"`);
            const assignedUser = tag.user;
            const resumeModel = model || prior.model || "auto";
            await indexTranscript(transcript, sessionId);
            addManaged({
              ...prior,
              tmuxName,
              cwd,
              createdAt: Date.now(),
              agent: "jcode",
              sessionId,
              nativeSessionId: jcodeNativeId,
              launchState: "launching",
              model: resumeModel,
              repoRoot: repoRootForManagedCwd(cwd),
            });
            // The pre-reboot row is now a duplicate of the same conversation.
            if (prior.tmuxName !== tmuxName) removeManaged(prior.tmuxName);
            if (assignedUser) assignUser(tmuxName, assignedUser);
            const spawned = spawnManagedJcodeSession({
              name: tmuxName,
              cwd,
              prompt: body?.prompt?.trim() || undefined,
              model: resumeModel,
              thinkingLevel: prior.thinkingLevel,
              resume: jcodeNativeId,
              omgSessionId: sessionId,
              omgUser: assignedUser,
            });
            if (!spawned.ok) {
              removeManaged(tmuxName);
              assignUser(tmuxName, null);
              return err(502, spawned.error || "failed to resume jcode session");
            }
            patchManaged(tmuxName, { launchState: "running" });
            updateResumableUser(sessionId, assignedUser ?? null);
            invalidateListSessionsCache();
            console.log(`[resume] jcode resume ${sessionId} → pane ${tmuxName} (${jcodeNativeId})`);
            return json({
              ok: true,
              tmuxName,
              cwd,
              sessionId,
              resumedFrom: jcodeNativeId,
              agent: "jcode",
            });
          }
        }
        // Grok and Cursor both resume their native file-backed conversation in
        // place. Keep the native id as the stable LFG id, warm the transcript
        // before launch, and persist a managed row so serve restarts rediscover
        // the same live session instead of replacing it with an empty card.
        if (cachedResume?.agent === "grok" || cachedResume?.agent === "cursor") {
          const agent = cachedResume.agent;
          const cwd = await resolveResumeCwd(
            cachedResume.cwd || await cwdForTranscript(transcript).catch(() => null),
            cachedResume.project,
          );
          const tmuxName = `lfg-${randomBytes(3).toString("hex")}`;
          const tag = resolveSessionUserTag(body?.user || cachedResume.assignedUser);
          if (!tag.ok) return err(400, `unknown user "${tag.unknown}"`);
          const assignedUser = tag.user;
          const resumeModel = model || cachedResume.model || (
            agent === "grok" ? GROK_DEFAULT_MODEL() : "auto"
          );
          await indexTranscript(transcript, sessionId);
          addManaged({
            tmuxName,
            cwd,
            createdAt: Date.now(),
            agent,
            sessionId,
            nativeSessionId: sessionId,
            launchState: "launching",
            model: resumeModel,
            title: cachedResume.title,
            project: cachedResume.project || undefined,
            repoRoot: repoRootForManagedCwd(cwd),
          });
          if (assignedUser) assignUser(tmuxName, assignedUser);
          const prompt = body?.prompt?.trim() || undefined;
          // `await` covers both arms: spawnManagedCursorSession is async (it
          // must not block this thread — see createCursorChat), and awaiting
          // the sync grok result is a no-op.
          const spawned = await (agent === "grok"
            ? spawnManagedGrokSession({
                name: tmuxName,
                cwd,
                prompt,
                model: resumeModel,
                resume: sessionId,
                omgSessionId: sessionId,
                omgUser: assignedUser,
              })
            : spawnManagedCursorSession({
                name: tmuxName,
                cwd,
                prompt,
                model: resumeModel,
                nativeSessionId: sessionId,
                omgSessionId: sessionId,
                omgUser: assignedUser,
              }));
          if (!spawned.ok) {
            removeManaged(tmuxName);
            assignUser(tmuxName, null);
            return err(502, spawned.error || "failed to resume session");
          }
          patchManaged(tmuxName, { launchState: "running" });
          updateResumableUser(sessionId, assignedUser ?? null);
          invalidateListSessionsCache();
          return json({
            ok: true,
            tmuxName,
            cwd,
            sessionId,
            resumedFrom: sessionId,
            agent,
          });
        }
        // Codex rollouts live under ~/.codex/sessions — resume them through a
        // codex-aisdk harness keyed to the rollout's threadId rather than the
        // claude CLI.
        if (transcript.includes("/.codex/")) {
          const cwd = await resolveResumeCwd(
            await cwdForCodexTranscript(transcript),
            cachedResume?.project,
          );
          const tmuxName = `lfg-${randomBytes(3).toString("hex")}`;
          const key = crypto.randomUUID(); // control-plane key (names registry/cmd files)
          // The resumable catalog discovers rollout files without eagerly
          // indexing their messages. Import and seed history before spawning:
          // otherwise the harness's one-shot copy races the lazy indexer and a
          // successfully resumed Codex session opens with an empty transcript.
          await prepareFileHistoryForResume(transcript, sessionId, key);
          const r = spawnManagedCodexAisdkSession({
            name: tmuxName,
            cwd,
            prompt: body?.prompt,
            model: model ?? "gpt-5.5",
            key,
            resume: sessionId,
            omgUser: body?.user,
          });
          if (!r.ok) return err(502, r.error || "failed to resume session");
          addManaged({
            tmuxName,
            cwd,
            createdAt: Date.now(),
            agent: "codex-aisdk",
            sessionId: key,
            nativeSessionId: sessionId,
            launchState: "running",
            model: model ?? "gpt-5.5",
            title: body?.prompt?.slice(0, 72),
            project: cachedResume?.project || undefined,
            repoRoot: repoRootForManagedCwd(cwd),
          });
          if (body?.user) assignUser(tmuxName, body.user);
          // Wait for the harness to register so the session is listable. The
          // threadId is seeded up front (== resumedFrom), so it's the live id.
          for (let i = 0; i < 20 && !readAisdkEntry(key); i++)
            await new Promise((res) => setTimeout(res, 250));
          return json({
            ok: true,
            tmuxName,
            cwd,
            sessionId: key,
            resumedFrom: sessionId,
            agent: "codex-aisdk",
          });
        }

        // claude path: relaunch the managed Agent-SDK harness resuming the SAME
        // session id in place. The SDK's `resume` continues the existing
        // transcript (no fork unless forkSession is set), so the whole legacy
        // dance below it replaced — dismissing the CLI's "Resume from summary"
        // selector, polling pidfiles for the forked id, codex fallback — is gone.
        const claudeResumeModel = resolveResumeModel("aisdk", cachedResume?.model, model);
        const cwd = await resolveResumeCwd(await cwdForTranscript(transcript), cachedResume?.project);
        const tmuxName = `lfg-${randomBytes(3).toString("hex")}`;
        const resumePrompt = body?.prompt?.trim() || undefined;
        // Claude transcripts are discovered lazily just like Codex rollouts.
        // Import and seed the direct read model before launching the resumed
        // harness so every file-backed backend has the same non-empty contract.
        await prepareFileHistoryForResume(transcript, sessionId, sessionId);
        addManaged({
          tmuxName,
          cwd,
          createdAt: Date.now(),
          agent: "aisdk",
          sessionId,
          nativeSessionId: sessionId,
          launchState: "launching",
          model: claudeResumeModel,
          claudeAccountId: pinnedClaudeAccountId,
          project: cachedResume?.project || undefined,
          repoRoot: repoRootForManagedCwd(cwd),
        });
        invalidateListSessionsCache();
        if (body?.user) assignUser(tmuxName, body.user);
        const r = spawnManagedAisdkSession({
          name: tmuxName,
          cwd,
          model: claudeResumeModel,
          sessionId,
          prompt: resumePrompt,
          omgUser: body?.user,
          claudeAccountId: pinnedClaudeAccountId,
        });
        if (!r.ok) {
          removeManaged(tmuxName);
          assignUser(tmuxName, null);
          console.error(`[resume] aisdk spawn failed for ${sessionId} in ${cwd}: ${r.error}`);
          return err(502, r.error || "failed to resume session");
        }
        console.log(`[resume] agent-sdk resume ${sessionId} → pane ${tmuxName} (cwd ${cwd})`);
        return json({ ok: true, tmuxName, cwd, sessionId, resumedFrom: sessionId, agent: "aisdk" });
        } finally {
          resumeGate.release();
        }
      }

      {
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/fork$/);
        if (m && req.method === "POST") {
          const sourceId = m[1];
          const body = (await req.json().catch(() => null)) as {
            prompt?: string;
            user?: string;
            model?: string;
            thinkingLevel?: string;
            archiveSource?: boolean;
            claudeAccountId?: string;
            agent?: "claude" | "codex" | "aisdk" | "codex-aisdk" | "opencode" | "grok" | "cursor" | "hermes" | "pi" | "jcode";
          } | null;
          // Cached: this read is pure metadata (cwd, project, title, owner) for
          // a session that already exists, so a few seconds of staleness cannot
          // change the answer — but an uncached rebuild costs a few hundred ms
          // on the fork path, which the user waits through twice over because
          // fork then creates through its own internal request.
          const source = (await listSessionsCached()).find((s) => s.sessionId === sourceId);
          const cachedSource = getCachedResumableSession(sourceId);
          const transcript = await resolveTranscript(sourceId);
          if (!transcript) return err(404, "source session transcript not found");

          const transcriptCwd = transcript.includes("/.codex/")
            ? await cwdForCodexTranscript(transcript).catch(() => null)
            : await cwdForTranscript(transcript).catch(() => null);
          const sourceCwd = source?.cwd || cachedSource?.cwd || transcriptCwd || SELF_REPO;
          const repos = await listRepos();
          const repo =
            repos.find((r) => r.cwd === sourceCwd) ??
            repos.find((r) => r.project === (source?.project || cachedSource?.project)) ??
            repos.find((r) => r.project === projectName(sourceCwd));
          if (!repo) return err(400, "source session repo is not in the repo picker");

          const extra = body?.prompt?.trim();
          const title =
            source?.title ||
            source?.lastUserText ||
            source?.tmuxName ||
            source?.project ||
            sourceId;
          const prompt = [
            "You are starting a fresh agent session from an existing lfg session.",
            "",
            "This is NOT a resume. Treat the source transcript as read-only context, then follow the user's extra prompt below.",
            "",
            `Source session id: ${sourceId}`,
            `Source title: ${title}`,
            `Source cwd: ${sourceCwd}`,
            `Source transcript JSONL: ${transcript}`,
            "",
            "Read the transcript file directly before acting.",
            "",
            "User's extra prompt:",
            extra || "Review the source transcript and continue with the most useful next step.",
          ].join("\n");

          const r = await fetch(`http://127.0.0.1:${PORT}/api/sessions/new`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              cwd: repo.cwd,
              prompt,
              // Continue replaces the source session, so keep the name the
              // user already chose. A normal fork remains independently
              // titled from its own opening prompt.
              title: body?.archiveSource === true ? title : undefined,
              user: body?.user || source?.assignedUser || undefined,
              agent: body?.agent,
              model: body?.model,
              thinkingLevel: body?.thinkingLevel,
              claudeAccountId: body?.claudeAccountId,
            }),
          });
          const text = await r.text();
          if (r.ok && body?.archiveSource === true) {
            const currentSource = (await listSessions()).find((s) => s.sessionId === sourceId);
            let sourceArchived = true;
            let archiveError: string | undefined;
            if (currentSource) {
              const outcome = await closeLiveSession(currentSource, sourceId, {
                sessionId: sourceId,
                source: "session_continue",
                href: req.headers.get("referer") ?? undefined,
              });
              if (!outcome.ok) {
                sourceArchived = false;
                archiveError = outcome.reason;
              }
            }
            const created = JSON.parse(text) as Record<string, unknown>;
            return json({ ...created, sourceArchived, archiveError });
          }
          return new Response(text, {
            status: r.status,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      if (path === "/api/sessions/new" && req.method === "POST") {
        const rawIdempotencyKey = req.headers.get("Idempotency-Key")?.trim();
        if (rawIdempotencyKey && rawIdempotencyKey.length > 256)
          return err(400, "Idempotency-Key too long (max 256 characters)");
        const idempotencyKey = rawIdempotencyKey || undefined;
        const replay = idempotencyKey ? getManagedSessionCreation(idempotencyKey) : null;
        if (replay?.sessionId) return replaySessionCreation(replay);
        const body = (await req.json().catch(() => null)) as {
          cwd?: string;
          prompt?: string;
          title?: string;
          user?: string;
          worktree?: boolean;
          model?: string;
          thinkingLevel?: string;
          claudeAccountId?: string;
          parentSessionId?: string;
          spawnedBy?: string;
          /** Start even though the live-agent cap is full — self-hosted only. */
          overLimit?: boolean;
          agent?: "claude" | "codex" | "aisdk" | "codex-aisdk" | "opencode" | "jcode" | "grok" | "cursor" | "copilot" | "hermes" | "pi";
        } | null;
        const agent = resolveActiveSessionAgent(body?.agent);
        if (!agent) {
          if (body?.agent === "hermes") return err(410, "agent \"hermes\" has been removed");
          return err(400, `unknown coding agent "${body?.agent ?? ""}"`);
        }
        const requestedClaudeAccountId = body?.claudeAccountId?.trim() || undefined;
        const selectedClaudeAccount =
          agent === "aisdk"
            ? await pickClaudeAccountForNewSession({
                explicitAccountId: requestedClaudeAccountId,
                readCapacity: (account) => getProviderUsage(`claude:${account.id}`),
              })
            : null;
        if (agent === "aisdk" && requestedClaudeAccountId && !selectedClaudeAccount) {
          return err(400, "Claude account is missing or not connected");
        }
        const claudeAccountId = selectedClaudeAccount?.id;
        // Allowlist Claude models — they land on a shell argv. Unknown value =
        // hard 400, never a silent fallback to some other model. Codex model
        // names are provider/catalog driven, so validate shape instead.
        const requestedModel = body?.model?.trim() || undefined;
        const opencodeDefault =
          agent === "opencode" ? defaultModelForAgent("opencode") : undefined;
        const model =
          agent === "opencode" && requestedModel && OPENCODE_DISABLED_MODELS.has(requestedModel)
            ? opencodeDefault
            : requestedModel;
        if (agent === "aisdk" && model) {
          const allowed = modelsForAgent("aisdk");
          if (!allowed.includes(model))
            return err(400, `unknown model "${model}" (expected one of ${allowed.join(", ")})`);
        }
        if (agent === "grok" && model) {
          const allowed = modelsForAgent("grok");
          if (!allowed.includes(model))
            return err(400, `unknown model "${model}" (expected one of ${allowed.join(", ")})`);
        }
        if (agent === "pi" && model) {
          const allowed = modelsForAgent("pi");
          if (!allowed.includes(model))
            return err(400, `unknown model "${model}" (expected one of ${allowed.join(", ")})`);
        }
        if (agent === "cursor" && model && !/^[A-Za-z0-9_.:\/-]{1,120}$/.test(model))
          return err(400, "invalid cursor model name");
        if (agent === "copilot" && model) {
          const allowed = modelsForAgent("copilot");
          if (!allowed.includes(model))
            return err(400, `unknown model "${model}" (expected one of ${allowed.join(", ")})`);
        }
        // codex-aisdk drives codex through the AI SDK, so its model is a codex
        // slug (gpt-5.x-codex …) — provider/catalog driven like the tmux codex.
        // Validate by shape, same as the codex branch.
        if (agent === "codex-aisdk" && model && !/^[A-Za-z0-9_.:-]{1,80}$/.test(model))
          return err(400, "invalid codex model name");
        // opencode models are "provider/model" (e.g. anthropic/claude-sonnet-4-6),
        // so the validation shape additionally allows a slash. Catalog-driven, so
        // validate by shape rather than an allowlist.
        if (agent === "opencode" && model && !/^[A-Za-z0-9_.:\/-]{1,80}$/.test(model))
          return err(400, "invalid opencode model name");
        if (agent === "jcode" && model && !/^[A-Za-z0-9_.:\/\-[\],=]{1,160}$/.test(model))
          return err(400, "invalid jcode model name");
        const thinkingLevel = body?.thinkingLevel?.trim() || undefined;
        // Thinking mode is supported on every agent kind that exposes a
        // reasoning-effort knob: Codex (reasoning_effort) and Claude (the claude
        // CLI's --effort / the claude-code provider's `effort`). opencode is the
        // lone exception — its provider exposes no per-call thinking control
        // (effort is set in opencode's own model config instead). Validate the
        // value against THAT agent's own level set so an out-of-range value (a
        // voice-supplied `none` for Claude, or `max` for Codex) is a clean 400
        // rather than a session that boots straight into a provider error.
        if (thinkingLevel) {
          const allowed = thinkingLevelsForAgent(agent);
          if (!allowed)
            return err(400, `thinkingLevel is not supported for ${agent} sessions`);
          if (!allowed.includes(thinkingLevel))
            return err(400, `unknown thinking level "${thinkingLevel}" for ${agent} (expected one of ${allowed.join(", ")})`);
        }
        const resolvedModel = resolveModelForAgent(agent, model, thinkingLevel);
        const requestedCwd = body?.cwd?.trim() || undefined;
        const parentId = body?.parentSessionId?.trim() || undefined;
        const spawnedBy = body?.spawnedBy?.trim() || (parentId ? "subagent" : undefined);
        const liveRows = parentId ? await listSessions() : [];
        const parent = parentId
          ? liveRows.find((s) => s.sessionId === parentId || s.nativeSessionId === parentId)
          : undefined;
        if (parentId && !parent) return err(404, "parent session not found");
        // Always spawn in a trusted folder — claude shows a blocking "trust this
        // folder?" dialog for any untrusted cwd, which hangs session startup.
        // Explicit cwd wins; otherwise subagents inherit their parent project.
        // Root sessions keep the historical SELF_REPO default. If a parent is
        // present but its repo is no longer in the picker, fail loudly instead
        // of silently spawning in SELF_REPO.
        const repos = await listRepos();
        const repo = requestedCwd
          ? repoForRequestedSessionCwd(repos, requestedCwd, parent)
          : parent
            ? repoForParentSession(repos, parent)
            // Historical default is the self repo, but it is now unlinkable
            // like any other project, so fall back to any listed repo rather
            // than 400-ing every root session for a user who hid it.
            : (repos.find((r) => r.cwd === SELF_REPO) ?? repos[0]);
        if (!repo) {
          return err(
            400,
            requestedCwd
              ? "unknown repo"
              : parent
                ? "parent session repo is not in the repo picker"
                : "unknown repo",
          );
        }
        const subagentDepth = parent && spawnedBy === "subagent"
          ? childSubagentDepth(parent, liveRows)
          : null;
        if (subagentDepth && subagentDepth > MAX_LFG_SUBAGENT_DEPTH) {
          return err(
            400,
            `subagent nesting depth ${subagentDepth} exceeds the LFG limit of ${MAX_LFG_SUBAGENT_DEPTH}`,
          );
        }
        // Resolve the user tag up front and LOUDLY: an explicit unknown email is
        // a 400 (matching /api/sessions/:id/user), never a silently-unassigned
        // session. With no explicit user, inherit from the NEAREST ASSIGNED
        // ANCESTOR — not just the immediate parent, which may itself be an
        // unassigned subagent mid-chain (the historic way subagents lost their
        // user tag and became untraceable in per-user views).
        //
        // EXCEPT on a roster-less instance — see resolveSessionUserTag. Only
        // session CREATE is relaxed; the explicit assign endpoints stay strict,
        // because "assign this to X" against an empty roster has no correct
        // answer and should fail rather than silently no-op.
        const tag = resolveSessionUserTag(body?.user);
        if (!tag.ok)
          return err(400, `unknown user "${tag.unknown}" (expected one of the roster emails)`);
        let assignedUser = tag.user;
        if (!assignedUser && parent) {
          let cursor: (typeof liveRows)[number] | undefined = parent;
          const walked = new Set<string>();
          while (cursor && !cursor.assignedUser) {
            const up: string | undefined =
              cursor.parentSessionId ?? cursor.parentNativeSessionId ?? undefined;
            if (!up || walked.has(up)) break;
            walked.add(up);
            cursor = liveRows.find((s) => s.sessionId === up || s.nativeSessionId === up);
          }
          assignedUser = cursor?.assignedUser ?? undefined;
        }
        // Root sessions from the account-scoped relay do not carry a roster
        // email. Use the paired box account only as a last resort. The helper
        // returns undefined unless that account is already on this box's roster.
        // Parent lineage stays authoritative because this runs after the walk.
        if (!assignedUser) assignedUser = rosterBoxAccount();
        // Global pause / live-agent cap. Applies to every activation — main and
        // subagent alike. Fork reaches here via its internal POST to
        // /api/sessions/new, so it inherits this gate for free.
        const gate = await activationGate({
          overLimit: body?.overLimit === true,
          kind: spawnedBy === "schedule" ? "schedule" : "interactive",
        });
        if (gate instanceof Response) return gate;
        try {
        const tmuxName = `lfg-${randomBytes(3).toString("hex")}`;
        const isSubagent = spawnedBy === "subagent";
        const cwdResolved = await resolveSessionCwd(repo.cwd, tmuxName, {
          worktree: body?.worktree,
          selfRepo: SELF_REPO,
        });
        if (!cwdResolved.ok) {
          return err(502, cwdResolved.error);
        }
        const cwd = cwdResolved.cwd;
        const worktree = cwdResolved.worktree;
        let prompt = body?.prompt;
        if (spawnedBy === "subagent") {
          prompt = withOmgSubagentContract(prompt, {
            parentSessionId: parent?.sessionId ?? parent?.nativeSessionId ?? parentId,
            depth: subagentDepth,
          });
        }
        // Every provider receives one stable control-plane id. SDK/RPC drivers
        // use it as their registry key. TUI drivers use it until they expose a
        // native transcript id. This keeps provider-specific ids out of serve.
        const launchId = crypto.randomUUID();
        const createdAt = Date.now();
        const launchModel =
          agent === "grok"
            ? resolvedModel ?? GROK_DEFAULT_MODEL()
            : agent === "cursor"
              ? resolvedModel ?? "auto"
              : agent === "opencode"
                  ? resolvedModel ?? opencodeDefault
                : agent === "jcode"
                  ? resolvedModel ?? "auto"
                  : agent === "codex-aisdk"
                    ? resolvedModel ?? "gpt-5.5"
                    : agent === "aisdk"
                      ? resolvedModel ?? "opus"
                      : agent === "pi"
                        ? resolvedModel ?? PI_DEFAULT_MODEL
                        : resolvedModel;
        const requestedTitle = body?.title?.trim().slice(0, 200);
        const claim = addManaged({
          tmuxName,
          cwd,
          createdAt,
          agent,
          runtime: CODING_AGENT_ADAPTERS[agent].transport,
          sessionId: launchId,
          nativeSessionId:
            agent === "aisdk" || agent === "opencode"
              ? launchId
              : undefined,
          launchState: "launching",
          model: launchModel,
          thinkingLevel,
          claudeAccountId,
          title: requestedTitle || body?.prompt?.slice(0, 72),
          project: repo.project,
          parentSessionId: parent?.sessionId ?? parentId,
          parentNativeSessionId: parent?.nativeSessionId ?? undefined,
          parentAgent: parent?.agent,
          spawnedBy,
          repoRoot: worktree?.repoRoot,
          worktreeBranch: worktree?.branch,
        }, idempotencyKey);
        if (!claim.created) return replaySessionCreation(claim.session);
        if (claudeAccountId) bindClaudeSessionAccount(launchId, claudeAccountId);
        invalidateListSessionsCache();
        // Tag the new session before spawn so a concurrent /api/sessions refresh
        // can show the durable row under the right user filter immediately.
        if (assignedUser) assignUser(tmuxName, assignedUser);
        const r = launchCodingAgentSession({
          agent,
          name: tmuxName,
          cwd,
          prompt,
          model: launchModel,
          thinkingLevel,
          sessionId: launchId,
          omgUser: assignedUser,
          containInAgentSlice: isSubagent,
          claudeAccountId,
        });
        if (!r.ok) {
          // The caller received no committed session. Release the claim so a
          // corrected retry can create one; normal closes retain their claim.
          removeManaged(tmuxName, { forgetCreation: true });
          assignUser(tmuxName, null);
          return err(502, r.error || "failed to start session");
        }
        if (r.nativeSessionId) patchManaged(tmuxName, { nativeSessionId: r.nativeSessionId });
        if (CODING_AGENT_ADAPTERS[agent].transport === "command-file")
          patchManaged(tmuxName, { launchState: "running" });
        // The spawn (and the launchState patch above) changed what the session
        // list contains, so retire any snapshot taken during it.
        invalidateListSessionsCache();
        // Hand the caller the session row itself, not just an id. A client that
        // gets only an id has to go re-derive the row from GET /api/sessions,
        // which is a full process+transcript scan — so the create is instant
        // but the card can take seconds to appear, and the "Creating session…"
        // spinner ends before the user sees anything. managedLaunchRow builds
        // the same row listSessions would from the record we just wrote, with
        // no scan, so the card can render the moment this response lands.
        const createdRow = await (async () => {
          try {
            const record = listManaged().find((m) => m.tmuxName === tmuxName);
            if (!record) return null;
            return managedLaunchRow(record, await readTitleOverrides(), userAssignments());
          } catch {
            // Never fail a successful create over a display convenience — the
            // client falls back to refreshing the list.
            return null;
          }
        })();
        return json({
          ok: true,
          tmuxName,
          cwd,
          sessionId: launchId,
          agent,
          // The full row for the session just created (null if it could not be
          // built), so clients can render it without a list round trip.
          session: createdRow,
          parentSessionId: parent?.sessionId ?? parentId ?? null,
          subagentDepth,
          // Echo the resolved tag so callers (MCP subagent tools, CLI) can see
          // whether the child landed under the right user instead of guessing.
          assignedUser: assignedUser ?? null,
          worktree: worktree?.path ?? null,
          // Absolute deep link to this session in the web UI, advertised only
          // when the operator configured LFG_PUBLIC_URL (the root URL this
          // box's UI is reachable at — e.g. a Tailscale MagicDNS address).
          // External surfaces (relay bridges) attach it as a tappable card;
          // they are contractually forbidden from guessing URLs themselves.
          sessionUrl: publicSessionUrl(launchId),
          archivedSessionCount: gate.reclaimed ?? 0,
        });
        } finally {
          gate.release();
        }
      }

      // Move an existing session under a different parent (or detach it to a
      // root). Parentage is derived at read time from three fields on the
      // managed record, so a reparent is just a patch of those fields — but we
      // guard it: the child must be lfg-managed (only then is there a record to
      // patch), the new parent must exist, and the move must not create a cycle
      // (which would make the tree walk in agent-catalog loop forever).
      if (path === "/api/sessions/reparent" && req.method === "POST") {
        const body = (await req.json().catch(() => null)) as {
          sessionId?: string;
          parentSessionId?: string | null;
        } | null;
        const childId = body?.sessionId?.trim();
        if (!childId) return err(400, "sessionId required");
        const sessions = await listSessions();
        const matches = (s: (typeof sessions)[number], id: string) =>
          s.sessionId === id || s.nativeSessionId === id;
        const child = sessions.find((s) => matches(s, childId));
        if (!child) return err(404, "session not found");
        if (!child.managed || !child.tmuxName)
          return err(400, "session is not lfg-managed; its parentage cannot be changed");

        const newParentId = body?.parentSessionId?.trim() || null;
        if (!newParentId) {
          // Detach to a root: clear the parent fields.
          patchManaged(child.tmuxName, {
            parentSessionId: undefined,
            parentNativeSessionId: undefined,
            parentAgent: undefined,
          });
          return json({ ok: true, sessionId: childId, parentSessionId: null });
        }

        const parent = sessions.find((s) => matches(s, newParentId));
        if (!parent) return err(404, "parent session not found");
        if (matches(parent, childId)) return err(400, "cannot parent a session to itself");
        // Cycle guard: walk up from the proposed parent; if we reach the child,
        // the move would form a loop. Bounded by session count as a backstop
        // against a pre-existing cycle in the data.
        let cursor: (typeof sessions)[number] | undefined = parent;
        for (let hops = 0; cursor && hops <= sessions.length; hops++) {
          if (matches(cursor, childId)) return err(400, "reparent would create a cycle");
          const up: string | null | undefined =
            cursor.parentSessionId ?? cursor.parentNativeSessionId;
          cursor = up ? sessions.find((s) => matches(s, up)) : undefined;
        }

        patchManaged(child.tmuxName, {
          parentSessionId: parent.sessionId ?? undefined,
          parentNativeSessionId: parent.nativeSessionId ?? undefined,
          parentAgent: parent.agent ?? undefined,
        });
        return json({
          ok: true,
          sessionId: childId,
          parentSessionId: parent.sessionId ?? parent.nativeSessionId ?? newParentId,
        });
      }

      {
        // Gallery: every artifact across sessions, newest first. Powers the
        // Artifacts view so agent output is browsable in one place.
        if (path === "/api/artifacts" && req.method === "GET") {
          const limit = Math.min(Number(url.searchParams.get("limit")) || 120, 500);
          const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
          // Optional kind filter (image | video | html) applied before paging
          // so offset/total always describe the filtered set.
          const kindFilter = url.searchParams.get("kind");
          const titles = await readTitleOverrides();
          // Same as the shipped feed: index once, look up per row.
          const managedBySession = new Map<string, ManagedSession>();
          for (const session of listManaged()) {
            if (session.sessionId) managedBySession.set(session.sessionId, session);
            if (session.nativeSessionId) managedBySession.set(session.nativeSessionId, session);
          }
          const all = listAllArtifacts().filter(
            (artifact) => !kindFilter || (artifact.media ?? "image") === kindFilter,
          );
          // listAllArtifacts is oldest-first; page newest-first with an offset
          // so the gallery can load incrementally instead of all up front.
          const artifacts = all
            .slice()
            .reverse()
            .slice(offset, offset + limit)
            .map((artifact) => ({
              id: artifact.id,
              kind: artifact.media ?? "image",
              url: `/api/artifacts/${encodeURIComponent(artifact.id)}`,
              name: artifact.name,
              title: artifact.title,
              caption: artifact.caption,
              sessionId: artifact.sessionId,
              sessionTitle:
                titles[artifact.sessionId] ?? managedBySession.get(artifact.sessionId)?.title,
              agent: managedBySession.get(artifact.sessionId)?.agent,
              project: managedBySession.get(artifact.sessionId)?.project,
              sessionStartedAt: managedBySession.get(artifact.sessionId)?.createdAt,
              ts: artifact.updatedAt ?? artifact.createdAt,
              lastRefreshedAt: artifact.refresh?.lastSuccessAt,
              refreshStatus: artifact.refresh?.status,
              refreshEnabled: artifact.refresh?.enabled,
              version: artifact.version,
              size: artifact.size,
              mimeType: artifact.mimeType,
            }));
          return json({ ok: true, artifacts, total: all.length });
        }
        const m = path.match(/^\/api\/artifacts\/([a-z0-9-]+)$/);
        if (m && req.method === "GET") {
          const artifact = getImageArtifact(m[1]);
          if (!artifact) return err(404, "artifact not found");
          // `preview=1` is the ~1200px in-transcript size; `preview=thumb` is
          // the 160px size the Notification Center's 52px squares use.
          const previewParam = url.searchParams.get("preview");
          const wantsPreview = previewParam === "1" || previewParam === "thumb";
          let filePath = artifact.filePath;
          let contentType = artifact.mimeType;
          if (wantsPreview && (artifact.media ?? "image") === "image") {
            try {
              filePath = await getOrCreateImagePreview(
                artifact,
                previewParam === "thumb" ? "thumb" : "preview",
              );
              contentType = "image/webp";
            } catch (error) {
              // A corrupt/unsupported input should not leave the transcript with
              // a broken image. The immutable original remains a safe fallback.
              console.warn("artifact preview generation failed", artifact.id, error);
            }
          }
          const file = Bun.file(filePath);
          if (!(await file.exists())) return err(404, "artifact file not found");
          if (artifact.media === "html") {
            // Updatable, and normally rendered natively (shadow DOM) by the web
            // client. The lockdown headers below still matter for the opt-in
            // isolated-frame path — inline script/style only, no network, no
            // parent-frame access — and cost nothing on the native path.
            // The reporter exists only for that legacy frame path, where the
            // sandboxed document is cross-origin and postMessage is the only way
            // to communicate its height.
            const reporter =
              '<script>(function(){var last=0;var send=function(){var b=document.body;var h=Math.max(document.documentElement.scrollHeight,b?b.scrollHeight:0);if(Math.abs(h-last)>2){last=h;try{parent.postMessage({type:"lfg-artifact-height",height:h},"*")}catch(e){}}};addEventListener("load",send);setTimeout(send,60);setInterval(send,1000);try{new ResizeObserver(send).observe(document.documentElement)}catch(e){}})();</scr' + "ipt>";
            // `?thumb=1` opts out: the Artifacts gallery renders a wall of these
            // in fixed-height tiles that never resize to content, so the
            // reporter there is pure overhead — one polling timer plus a forced
            // layout every second, per tile, for as long as the page is open.
            // `?native=1` is the shadow-DOM renderer, which lays the document out
            // for real and therefore needs no reporter at all. `?thumb=1` is the
            // legacy fixed-height tile. Either way the reporter is pure overhead —
            // a polling timer plus a forced layout every second, per artifact, for
            // as long as the page is open.
            const wantsNative = url.searchParams.get("native") === "1";
            const wantsHeightReporter =
              !wantsNative && url.searchParams.get("thumb") !== "1";
            let doc = await file.text();
            if (wantsHeightReporter) {
              doc = doc.includes("</body>")
                ? doc.replace("</body>", reporter + "</body>")
                : doc + reporter;
            }
            // The same URL serves newer versions, so the *unversioned* URL can
            // never be cached. The native renderer always pins the content
            // revision it asked for (`v=<cacheKey>`), which makes that exact
            // response immutable — and lets a gallery page collapse the repeat
            // requests it would otherwise make for the same artifact.
            const pinnedRevision = wantsNative && url.searchParams.has("v");
            return new Response(doc, {
              headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": pinnedRevision
                  ? "private, max-age=31536000, immutable"
                  : "no-store",
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy":
                  "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'",
              },
            });
          }
          const baseHeaders: Record<string, string> = {
            "Content-Type": contentType,
            "Cache-Control": "private, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
            // Video seeking (and Safari playback) needs byte-range support.
            "Accept-Ranges": "bytes",
          };
          // Honor a single-range request so the <video> element can seek without
          // re-downloading the whole file. Bun.file().slice() streams the slice.
          const range = req.headers.get("range");
          const rangeMatch = range?.match(/^bytes=(\d*)-(\d*)$/);
          if (rangeMatch) {
            const total = file.size;
            const startRaw = rangeMatch[1];
            const endRaw = rangeMatch[2];
            let start = startRaw ? Number(startRaw) : 0;
            let end = endRaw ? Number(endRaw) : total - 1;
            if (!startRaw && endRaw) {
              // Suffix range: bytes=-N → the final N bytes.
              start = Math.max(0, total - Number(endRaw));
              end = total - 1;
            }
            if (
              Number.isFinite(start) &&
              Number.isFinite(end) &&
              start <= end &&
              start < total
            ) {
              end = Math.min(end, total - 1);
              return new Response(file.slice(start, end + 1), {
                status: 206,
                headers: {
                  ...baseHeaders,
                  "Content-Range": `bytes ${start}-${end}/${total}`,
                  "Content-Length": String(end - start + 1),
                },
              });
            }
            return new Response("range not satisfiable", {
              status: 416,
              headers: { ...baseHeaders, "Content-Range": `bytes */${total}` },
            });
          }
          return new Response(file, { headers: baseHeaders });
        }
      }

      {
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/origin-deliveries$/);
        if (m && req.method === "GET") {
          const limit = Number(url.searchParams.get("limit") ?? 50);
          return json({ deliveries: listOriginDeliveries(m[1], limit) });
        }
        if (m && req.method === "POST") {
          if (callerSessionHeader(req) !== m[1]) {
            return err(403, "origin delivery requires the owning omg.dev session");
          }
          const body = (await req.json().catch(() => null)) as {
            text?: string;
            mediaPaths?: string[];
            artifactIds?: string[];
          } | null;
          if (!body) return err(400, "request body required");
          try {
            const artifacts: ImageArtifact[] = [];
            for (const id of (body.artifactIds ?? []).slice(0, 3)) {
              const artifact = getImageArtifact(id);
              if (!artifact || artifact.sessionId !== m[1]) {
                throw new Error(`artifact ${id} does not belong to this session`);
              }
              if (artifact.media !== "video" && (artifact.media ?? "image") !== "image") {
                throw new Error(`artifact ${id} is not image or video media`);
              }
              artifacts.push(artifact);
            }
            for (const mediaPath of (body.mediaPaths ?? []).slice(0, Math.max(0, 3 - artifacts.length))) {
              const extension = extname(mediaPath).toLowerCase();
              const artifact = [".mp4", ".m4v", ".webm", ".mov", ".ogv"].includes(extension)
                ? createVideoArtifact({ sessionId: m[1], path: mediaPath })
                : await createImageArtifact({ sessionId: m[1], path: mediaPath });
              artifacts.push(artifact);
            }
            const media: OriginDeliveryMedia[] = artifacts.map((artifact) => ({
              path: `/api/artifacts/${artifact.id}`,
              kind: artifact.media === "video" ? "video" : "image",
              mimeType: artifact.mimeType,
            }));
            if (artifacts.length) {
              const transcriptPath = await resolveTranscript(m[1]);
              indexOriginDeliveryMedia({
                indexPath: transcriptPath ?? sessionIndexKey(m[1]),
                sessionId: m[1],
                artifacts,
              });
            }
            const delivery = createOriginDelivery({
              sessionId: m[1],
              text: body.text,
              media,
            });
            return json({ ok: true, delivery });
          } catch (e) {
            return err(400, e instanceof Error ? e.message : "could not create origin delivery");
          }
        }
      }

      {
        // Destructive artifact changes are owner-scoped just like refresh
        // configuration. Removing an HTML artifact cancels any active script
        // before its stable id and file disappear.
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/artifacts\/([a-z0-9-]+)$/);
        if (m && req.method === "DELETE") {
          if (callerSessionHeader(req) !== m[1]) {
            return err(403, "artifact deletion requires the owning omg.dev session");
          }
          const artifact = getImageArtifact(m[2]);
          if (!artifact) return err(404, "artifact not found");
          if (artifact.sessionId !== m[1]) return err(403, "artifact belongs to a different session");
          try {
            const placementPath = indexedArtifactPlacement(artifact.id);
            if (artifact.media === "html") artifactRefreshManager.cancel(artifact.id);
            // Remove the visible placement first. If file/catalog deletion
            // fails, restore exactly that placement before returning failure.
            removeIndexedArtifact(artifact.id);
            let deleted;
            try {
              deleted = deleteArtifact({ id: artifact.id, sessionId: m[1] });
            } catch (deleteError) {
              if (placementPath) indexArtifactMessage(placementPath, m[1], artifact);
              throw deleteError;
            }
            await deleteImagePreview(deleted.id);
            return json({ ok: true, artifact: deleted });
          } catch (e) {
            return err(400, e instanceof Error ? e.message : "could not delete artifact");
          }
        }
      }

      {
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/artifacts\/images$/);
        if (m && req.method === "POST") {
          const body = (await req.json().catch(() => null)) as {
            path?: string;
            caption?: string;
            alt?: string;
          } | null;
          if (!body?.path?.trim()) return err(400, "path required");
          try {
            const transcriptPath = await resolveTranscript(m[1]);
            const indexPath = transcriptPath ?? sessionIndexKey(m[1]);
            const artifact = await createImageArtifact({
              sessionId: m[1],
              path: body.path,
              caption: body.caption,
              alt: body.alt,
            });
            try {
              // One ordered append + joined artifacts row — same source the
              // transcript page reads via JOIN.
              indexArtifactMessage(indexPath, m[1], artifact);
            } catch (indexError) {
              // Creation is retry-deduped, so a retry reuses this exact blob.
              // Never acknowledge a display until metadata + placement commit
              // atomically in SQLite; otherwise the transcript can render an
              // empty or missing card.
              throw indexError;
            }
            return json({ ok: true, artifact, message: imageArtifactToMessage(artifact), indexed: true });
          } catch (e) {
            return err(400, e instanceof Error ? e.message : "could not create image artifact");
          }
        }
      }

      {
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/artifacts\/videos$/);
        if (m && req.method === "POST") {
          const body = (await req.json().catch(() => null)) as {
            path?: string;
            caption?: string;
            alt?: string;
          } | null;
          if (!body?.path?.trim()) return err(400, "path required");
          try {
            const transcriptPath = await resolveTranscript(m[1]);
            const indexPath = transcriptPath ?? sessionIndexKey(m[1]);
            const artifact = createVideoArtifact({
              sessionId: m[1],
              path: body.path,
              caption: body.caption,
              alt: body.alt,
            });
            try {
              indexArtifactMessage(indexPath, m[1], artifact);
            } catch (indexError) {
              throw indexError;
            }
            return json({ ok: true, artifact, message: imageArtifactToMessage(artifact), indexed: true });
          } catch (e) {
            return err(400, e instanceof Error ? e.message : "could not create video artifact");
          }
        }
      }

      {
        // Publish/re-publish HTML and optionally attach a server-side refresh
        // script. The script path is scoped to the owning session cwd; the
        // sandboxed iframe has no route to invoke it (no forms, network, or
        // same-origin capability under the artifact CSP).
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/artifacts\/html$/);
        if (m && req.method === "POST") {
          const body = (await req.json().catch(() => null)) as {
            html?: string;
            id?: string;
            title?: string;
            caption?: string;
            refreshScriptPath?: string | null;
            refreshArgv?: string[];
            refreshIntervalSeconds?: number;
            refreshTimeoutSeconds?: number;
            refreshEnabled?: boolean;
          } | null;
          if (!body) return err(400, "request body required");
          const hasRefreshChanges = [
            "refreshScriptPath",
            "refreshArgv",
            "refreshIntervalSeconds",
            "refreshTimeoutSeconds",
            "refreshEnabled",
          ].some((key) => Object.prototype.hasOwnProperty.call(body, key));
          if (hasRefreshChanges && callerSessionHeader(req) !== m[1]) {
            return err(403, "refresh configuration requires the owning omg.dev session");
          }
          if (!body.html?.trim() && (!body.id || !hasRefreshChanges)) {
            return err(400, "html required unless updating an existing refresh configuration");
          }
          try {
            const changes: ArtifactRefreshChanges = {
              scriptPath: body.refreshScriptPath,
              argv: body.refreshArgv,
              intervalMs: body.refreshIntervalSeconds === undefined
                ? undefined
                : body.refreshIntervalSeconds * 1_000,
              timeoutMs: body.refreshTimeoutSeconds === undefined
                ? undefined
                : body.refreshTimeoutSeconds * 1_000,
              enabled: body.refreshEnabled,
            };
            let artifact;
            if (body.html?.trim()) {
              const existing = body.id ? getImageArtifact(body.id) : null;
              let refresh = undefined;
              if (hasRefreshChanges) {
                const scopeRoot = typeof body.refreshScriptPath === "string"
                  ? await artifactOwnerCwd(m[1]) ?? undefined
                  : undefined;
                refresh = prepareArtifactRefreshConfig({
                  changes,
                  existing: existing?.refresh,
                  scopeRoot,
                });
                if (!refresh || !refresh.enabled) artifactRefreshManager.cancel(body.id ?? "");
              }
              const transcriptPath = await resolveTranscript(m[1]);
              artifact = publishHtmlArtifact({
                sessionId: m[1],
                html: body.html,
                id: body.id,
                title: body.title,
                caption: body.caption,
                refresh: hasRefreshChanges ? refresh : undefined,
              });
              indexArtifactMessage(transcriptPath ?? sessionIndexKey(m[1]), m[1], artifact);
            } else {
              const scopeRoot = typeof body.refreshScriptPath === "string"
                ? await artifactOwnerCwd(m[1]) ?? undefined
                : undefined;
              artifact = artifactRefreshManager.configure({
                id: body.id!,
                sessionId: m[1],
                scopeRoot,
                changes,
              });
            }
            return json({ ok: true, artifact, message: imageArtifactToMessage(artifact) });
          } catch (e) {
            return err(400, e instanceof Error ? e.message : "could not publish html artifact");
          }
        }
      }

      {
        // Status + manual refresh. Ownership is enforced by both the route
        // session and the durable artifact owner before host execution begins.
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/artifacts\/html\/([a-z0-9-]+)\/refresh$/);
        if (m && (req.method === "GET" || req.method === "POST")) {
          if (callerSessionHeader(req) !== m[1]) {
            return err(403, "artifact refresh requires the owning omg.dev session");
          }
          const artifact = getImageArtifact(m[2]);
          if (!artifact || artifact.media !== "html") return err(404, "html artifact not found");
          if (artifact.sessionId !== m[1]) return err(403, "artifact belongs to a different session");
          if (req.method === "GET") {
            return json({ ok: true, artifact, refresh: artifact.refresh ?? null });
          }
          try {
            const result = await artifactRefreshManager.refreshNow(m[2], m[1]);
            return json({ ...result, refresh: result.artifact.refresh ?? null });
          } catch (e) {
            return err(400, e instanceof Error ? e.message : "could not refresh html artifact");
          }
        }
      }

      {
        // The Shipped channel: agents post finished work here (title, summary,
        // media). Media are ordinary artifacts, so images/videos/live html
        // dashboards all embed the same way.
        if (path === "/api/shipped" && req.method === "GET") {
          const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
          const offset = Math.max(Number(url.searchParams.get("offset")) || 0, 0);
          const titles = await readTitleOverrides();
          // Index the registry once instead of scanning it per post: a post
          // may be keyed by either the LFG or the native session id, so both
          // point at the same record.
          const managedBySession = new Map<string, ManagedSession>();
          for (const session of listManaged()) {
            if (session.sessionId) managedBySession.set(session.sessionId, session);
            if (session.nativeSessionId) managedBySession.set(session.nativeSessionId, session);
          }
          const page = listShipPosts(limit, offset);
          const posts = page.posts.map((post) => {
            const source = post.sessionId ? managedBySession.get(post.sessionId) : undefined;
            return {
              ...post,
              project: post.project ?? source?.project,
              sessionTitle: post.sessionId
                ? (titles[post.sessionId] ?? source?.title)
                : undefined,
              // The feed's avatar/byline reflect the session that actually did
              // the work — the registry is authoritative over whatever the post
              // was stored with (lfg_ship never sends an agent kind).
              agent: source?.agent ?? post.agent,
            };
          });
          return json({ ok: true, posts, total: page.total });
        }
        if (path === "/api/shipped" && req.method === "POST") {
          const body = (await req.json().catch(() => null)) as {
            title?: string;
            summary?: string;
            id?: string;
            sessionId?: string;
            agent?: string;
            project?: string;
            mediaPaths?: Array<{ path: string; caption?: string }>;
            artifactIds?: string[];
          } | null;
          const shipTitle = body?.title?.trim();
          if (!body || !shipTitle) return err(400, "title required");
          try {
            const sourceManaged = body.sessionId
              ? listManaged().find(
                  (session) =>
                    session.sessionId === body.sessionId ||
                    session.nativeSessionId === body.sessionId,
                )
              : undefined;
            const landing = verifySelfRepoLanding(sourceManaged, SELF_REPO);
            if (!landing.ok) {
              evlog("shipped_session_landing_rejected", {
                sessionId: body.sessionId,
                reason: landing.error,
                cwd: sourceManaged?.cwd,
                branch: sourceManaged?.worktreeBranch,
              });
              return err(409, landing.error);
            }
            // Stamp the posting session's agent kind at write time so the feed
            // byline survives registry pruning; the GET hydration still prefers
            // the live registry when the session is known.
            const sourceAgent = sourceManaged?.agent;
            // Stamp what Git says about the session worktree right now. The
            // self-repo landing gate above proves delivery for this repo only;
            // every other project shipped with no source-control record at all,
            // which is how posts that were never committed became
            // indistinguishable from posts that landed and deployed.
            const code = collectShipProvenance(sourceManaged);
            const unlanded = shipBlockReason(code);
            if (unlanded && code) {
              // Refused, not annotated. A post the reader has to distrust is
              // worse than no post: "shipped" has to mean the code is in.
              evlog("shipped_unlanded_rejected", {
                sessionId: body.sessionId,
                state: code.state,
                branch: code.branch,
                head: code.head,
                dirty: code.dirty,
                ahead: code.ahead,
              });
              return err(409, unlanded);
            }
            const post = await addShipPost({
              ...body,
              code,
              agent: body.agent ?? sourceAgent,
              project: resolveShipProject(
                body.project,
                sourceManaged?.project,
                (await listRepos().catch(() => [])).map((r) => r.project),
              ),
              title: shipTitle,
            });
            const sourceSession = body.sessionId
              ? (await listSessions()).find(
                  (session) =>
                    session.sessionId === body.sessionId ||
                    session.nativeSessionId === body.sessionId,
                )
              : undefined;
            const notificationUser =
              sourceSession?.assignedUser ??
              (body.sessionId ? getCachedResumableSession(body.sessionId)?.assignedUser : undefined);
            void notifyAll({
              user: notificationUser,
              notification: {
                title: `Shipped: ${post.title}`,
                body: post.summary || "Tap to review the finished session.",
                url: post.sessionId
                  ? `/?session=${encodeURIComponent(post.sessionId)}`
                  : "/notifications",
                tag: `shipped-${post.id}-${post.rev}`,
              },
            }).catch(() => {});
            // Publishing is not a lifecycle event: the source session stays
            // exactly as it was, so there is no session outcome to report.
            return json({ ok: true, post });
          } catch (e) {
            return err(400, e instanceof Error ? e.message : "could not add shipped post");
          }
        }
      }

      {
        // Serve an attached image back to the transcript. The path the composer
        // splices into the message text is a server-local tmpdir path, so the
        // bubble can't render it directly — it asks for the basename here and
        // the bytes are resolved inside the uploads dir.
        const m = path.match(/^\/api\/uploads\/([^/]+)$/);
        if (m && req.method === "GET") {
          const resolved = resolveUploadRequest(m[1]!);
          if ("error" in resolved) return err(resolved.status, resolved.error);
          let filePath = resolved.filePath;
          let contentType = resolved.contentType;
          if (!(await Bun.file(filePath).exists())) {
            // Uploads live in tmpdir, which a reboot clears. Old transcripts
            // keep their text and the bubble degrades to a named file chip.
            return err(404, "upload not found");
          }
          const previewParam = url.searchParams.get("preview");
          if (previewParam === "1" || previewParam === "thumb") {
            try {
              filePath = await getOrCreateImagePreview(
                { id: `upload-${basename(filePath)}`, filePath },
                previewParam === "thumb" ? "thumb" : "preview",
              );
              contentType = "image/webp";
            } catch (error) {
              // Same rule as artifacts: a preview failure must not leave a
              // broken image in the transcript — serve the original instead.
              console.warn("upload preview generation failed", filePath, error);
              filePath = resolved.filePath;
              contentType = resolved.contentType;
            }
          }
          return new Response(Bun.file(filePath), {
            headers: {
              "Content-Type": contentType,
              // Upload names are unique per file, so bytes never change.
              "Cache-Control": "private, max-age=31536000, immutable",
              "X-Content-Type-Options": "nosniff",
              "Content-Security-Policy": "default-src 'none'; sandbox",
            },
          });
        }
      }

      {
        // Pre-session file attach for the home composer. The browser uploads
        // first, then includes the returned absolute paths in /api/sessions/new's
        // initial prompt.
        if (path === "/api/uploads" && req.method === "POST") {
          try {
            const filename = uploadFilename(req, url);
            const chunk = uploadChunkParams(url);
            const uploaded = chunk
              ? await persistUploadChunk(req, filename, "new-session", chunk.uploadId, chunk.offset, chunk.total)
              : await persistUpload(req, filename, "new-session");
            return json({ ok: true, ...uploaded });
          } catch (e) {
            return err(400, e instanceof Error ? e.message : "upload failed");
          }
        }
      }

      {
        // File attach: the browser POSTs raw bytes; we persist them and hand
        // back an absolute path. The client then includes that path in the
        // message text — coding agents can read local files, and Claude Code
        // treats local image paths as image input.
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/upload$/);
        if (m && req.method === "POST") {
          try {
            const filename = uploadFilename(req, url);
            const chunk = uploadChunkParams(url);
            const uploaded = chunk
              ? await persistUploadChunk(req, filename, m[1], chunk.uploadId, chunk.offset, chunk.total)
              : await persistUpload(req, filename, m[1]);
            return json({ ok: true, ...uploaded });
          } catch (e) {
            return err(400, e instanceof Error ? e.message : "upload failed");
          }
        }
      }

      {
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/send$/);
        if (m && req.method === "POST") {
          const body = (await req.json().catch(() => null)) as {
            text?: string;
            mode?: "steer" | "queue";
            fromSessionId?: string;
          } | null;
          const rawText = body?.text?.trim();
          if (!rawText) return err(400, "expected { text }");
          const sessions = await listSessionsCached();
          let sess = sessions.find(
            (s) => s.sessionId === m[1] || s.nativeSessionId === m[1],
          );
          // Attribute before delivery, so the text that rides into a relaunch
          // prompt is the same text a live session would have received.
          const sender = body?.fromSessionId
            ? sessions.find(
                (session) =>
                  session.sessionId === body.fromSessionId ||
                  session.nativeSessionId === body.fromSessionId,
              )
            : undefined;
          const text = attributedAgentUpdate(rawText, {
            fromSessionId: body?.fromSessionId,
            senderTitle: sender?.title,
            targetPersistent: sess?.persistent ?? true,
          });
          // A background child outliving its bot used to end here, with the
          // report dropped on a 404 — see reviveBotSessionForReport.
          let deliveredOnLaunch = false;
          if (!sess && body?.fromSessionId) {
            const revived = await reviveBotSessionForReport(m[1], text);
            if (revived) {
              sess = revived.session;
              deliveredOnLaunch = revived.delivered;
            }
          }
          if (!sess) return err(404, "session not found");
          let sentMsg: unknown;
          if (!deliveredOnLaunch) {
            const mode = agentUpdateSendMode(body?.mode, {
              fromSessionId: body?.fromSessionId,
              targetPersistent: sess.persistent,
            });
            const sent = sendPromptToLiveSession(sess, text, { mode });
            if (!sent.ok) return err(409, sent.error || "couldn't send message");
            sentMsg = sent.msg;
          }
          // Terminal reports also end the child lifecycle. Once this response
          // has flushed, close the managed child; its transient service reaps
          // browser/helper descendants and frees the next concurrency slot.
          if (/^\[subagent (?:complete|blocked|failed)\]/i.test(rawText) && body?.fromSessionId) {
            const senderParent = sender?.parentSessionId ?? sender?.parentNativeSessionId;
            if (sender?.managed && sender.spawnedBy === "subagent" && senderParent === m[1]) {
              setTimeout(() => {
                void fetch(`http://127.0.0.1:${PORT}/api/sessions/${body.fromSessionId}/close`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ source: "subagent-terminal-state" }),
                });
              }, 1_500);
            }
          }
          return json({ ok: true, msg: sentMsg });
        }
      }

      // Change the model of a running session mid-flight. Claude Code's own
      // `/model <alias>` slash command switches the active model for the rest of
      // the session and takes effect on the next turn — so we just inject it
      // through the confirmed-delivery queue (which treats a slash command as
      // delivered the instant it leaves the composer). If Claude raises a
      // "re-read history?" confirmation, it surfaces in the normal prompt panel
      // for the user to confirm. (Inline /model also nudges the global default,
      // but that's inert here: lfg always launches new sessions with an
      // explicit --model.)
      {
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/model$/);
        if (m && req.method === "POST") {
          const body = (await req.json().catch(() => null)) as {
            model?: string;
          } | null;
          const model = body?.model?.trim();
          if (!model) return err(400, "expected { model }");
          const sess = (await listSessions()).find((s) => s.sessionId === m[1]);
          if (!sess) return err(404, "session not found");
          if (sess.runtime === "command-file" && (sess.agent === "jcode" || sess.agent === "copilot")) {
            const allowed = modelsForAgent(sess.agent);
            if (!allowed.includes(model))
              return err(400, `unknown model "${model}" (expected one of ${allowed.join(", ")})`);
            const entry = findAisdkEntryByAnyId(m[1]);
            if (!entry) return err(409, "session control process is unavailable");
            appendAisdkCmd(entry.sessionId, { type: "set_model", model });
            if (sess.tmuxName) patchManaged(sess.tmuxName, { model });
            return json({ ok: true, model });
          }
          if (sess.agent === "opencode") {
            if (!/^[A-Za-z0-9_.:\/-]{1,80}$/.test(model))
              return err(400, "invalid opencode model name");
            if (OPENCODE_DISABLED_MODELS.has(model))
              return err(409, `${model} is disabled because the configured provider returns 403`);
            const key = findAisdkEntryByAnyId(m[1])?.sessionId ?? m[1];
            appendAisdkCmd(key, { type: "set_model", model });
            return json({ ok: true, model });
          }
          if (sess.agent !== "claude")
            return err(409, "mid-session model change is only supported for Claude sessions");
          {
            const allowed = modelsForAgent("claude");
            if (!allowed.includes(model))
              return err(400, `unknown model "${model}" (expected one of ${allowed.join(", ")})`);
          }
          if (!sess.tmuxTarget)
            return err(409, "session is not in a tmux pane — cannot change model");
          // If the session is FROZEN on an unavailable model, an injected
          // `/model` no-ops — Claude Code rejects the turn before handling the
          // slash command ("Kept model as <dead model>"). Relaunch the pane on
          // the new model instead (resumes the transcript, so the build
          // continues). For a healthy session the in-place `/model` is gentler
          // (no process restart), so keep that path for the normal case.
          if (sess.statusReason === "model_unavailable") {
            const nativeSessionId = sess.nativeSessionId ?? sess.sessionId;
            if (!nativeSessionId || !sess.cwd)
              return err(409, "cannot relaunch: session id or cwd unknown");
            const r = relaunchSessionWithModel({
              tmuxTarget: sess.tmuxTarget,
              cwd: sess.cwd,
              sessionId: nativeSessionId,
              model,
              claudeAccountId: claudeAccountIdForSession(sess.sessionId) ?? undefined,
            });
            if (!r.ok) return err(500, r.error || "relaunch failed");
            // Same 2.1+ resume gate as /api/sessions/resume — the relaunched pane
            // is a `--resume`, so answer the summary selector or the build freezes
            // at the menu instead of continuing on the new model.
            await dismissResumeSummaryGate(sess.tmuxTarget);
            return json({ ok: true, relaunched: true, model });
          }
          const msg = enqueueMessage(m[1], `/model ${model}`);
          return json({ ok: true, msg });
        }
      }

      // Change the reasoning effort used by subsequent turns of a live
      // session. Command-file SDK backends update their in-memory control
      // plane; native Claude/Grok TUIs already expose direct slash commands.
      // Cursor's effort is part of its model variant, so an idle Cursor pane is
      // resumed on the matching variant while preserving the same chat.
      {
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/thinking-level$/);
        if (m && req.method === "POST") {
          const body = (await req.json().catch(() => null)) as {
            thinkingLevel?: string;
          } | null;
          const thinkingLevel = body?.thinkingLevel?.trim();
          if (!thinkingLevel) return err(400, "expected { thinkingLevel }");
          const sess = (await listSessions()).find((s) => s.sessionId === m[1]);
          if (!sess) return err(404, "session not found");
          const supported = thinkingLevelsForAgent(sess.agent);
          // Claude Agent SDK supports `max` as a launch option, but its live
          // Settings API currently accepts only through `xhigh`.
          const allowed = sess.agent === "aisdk"
            ? supported?.filter((level) => level !== "max")
            : supported;
          if (!allowed)
            return err(409, `mid-session thinking-level change is not supported for ${sess.agent} sessions`);
          if (!allowed.includes(thinkingLevel))
            return err(400, `unknown thinking level "${thinkingLevel}" for ${sess.agent} (expected one of ${allowed.join(", ")})`);

          if (sess.agent === "aisdk" || sess.agent === "codex-aisdk" || sess.agent === "pi" || (sess.agent === "jcode" && sess.runtime === "command-file")) {
            const entry = findAisdkEntryByAnyId(m[1]);
            if (!entry) return err(409, "session control process is unavailable");
            appendAisdkCmd(entry.sessionId, { type: "set_thinking_level", thinkingLevel });
            patchAisdkEntry(entry.sessionId, { thinkingLevel });
          } else if (sess.agent === "claude" || sess.agent === "grok") {
            if (!sess.tmuxTarget)
              return err(409, "session is not in a tmux pane — cannot change thinking level");
            enqueueMessage(m[1], `/effort ${thinkingLevel}`);
          } else if (sess.agent === "cursor") {
            if (sess.busy)
              return err(409, "wait for the current Cursor turn to finish before changing thinking level");
            if (!sess.tmuxTarget || !sess.cwd || !sess.nativeSessionId || !sess.model)
              return err(409, "cannot relaunch Cursor: live pane, chat id, cwd, or model is unknown");
            if (sess.model === "auto")
              return err(409, "Cursor auto mode does not expose a selectable thinking level");
            const baseModel = sess.model.replace(/\[[^\]]*\]$/, "");
            const model = resolveModelForAgent("cursor", baseModel, thinkingLevel);
            if (!model) return err(409, "no Cursor model variant matches that thinking level");
            const relaunched = relaunchCursorSessionWithModel({
              tmuxTarget: sess.tmuxTarget,
              cwd: sess.cwd,
              nativeSessionId: sess.nativeSessionId,
              model,
            });
            if (!relaunched.ok) return err(500, relaunched.error || "Cursor relaunch failed");
            if (sess.tmuxName) patchManaged(sess.tmuxName, { model });
          } else {
            return err(409, `mid-session thinking-level change is not supported for ${sess.agent} sessions`);
          }

          if (sess.tmuxName) patchManaged(sess.tmuxName, { thinkingLevel });
          invalidateListSessionsCache();
          return json({ ok: true, thinkingLevel });
        }
      }

      {
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/queue$/);
        if (m && req.method === "GET") {
          await reconcileQueued(m[1]);
          return json({ id: m[1], queue: listQueue(m[1]) });
        }
        if (m && req.method === "DELETE") {
          return json({ ok: true, cleared: clearResolved(m[1]) });
        }
      }

      // Non-streaming transcript read — lets an orchestrator or omg.dev MCP client
      // inspect what another session is doing without holding an SSE connection.
      {
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/token-usage$/);
        if (m && req.method === "GET") {
          let transcriptPath = await resolveTranscript(m[1]);
          // Direct-indexed SDK sessions render from their synthetic lfg://
          // conversation key, while Codex's authoritative token_count events
          // remain in the native rollout transcript. Follow the native id only
          // for usage accounting; chat ordering still belongs to the index.
          if (transcriptPath?.startsWith("lfg://")) {
            const session = (await listSessionsCached()).find(
              (candidate) =>
                candidate.sessionId === m[1] || candidate.nativeSessionId === m[1],
            );
            if (session?.nativeSessionId && session.nativeSessionId !== m[1]) {
              transcriptPath =
                (await findCodexTranscriptById(session.nativeSessionId).catch(() => null)) ??
                transcriptPath;
            }
          }
          return json(await sessionTokenUsage(m[1], transcriptPath));
        }
      }

      {
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/messages$/);
        if (m && req.method === "GET") {
          const tp = await resolveTranscript(m[1]);
          if (!tp) return err(404, "session transcript not found");
          await ensureChatTranscriptCaughtUp(tp, m[1], "api-messages");
          // `rows` is additive and optional. Without it the page is the old
          // raw-message window, so an older client keeps its exact behaviour.
          // With it the page grows backward until it renders that many rows,
          // because a run of tool calls collapses into one.
          const rows = requestedRows(url);
          const deferToolArgs = requestedDeferToolArgs(url);
          if (url.searchParams.get("page") === "backward") {
            const rawLimit = parseInt(url.searchParams.get("limit") ?? "220", 10);
            const limit = Number.isFinite(rawLimit) ? rawLimit : 220;
            const rawBefore = url.searchParams.get("before");
            const before =
              rawBefore == null ? null : Math.max(0, parseInt(rawBefore, 10) || 0);
            const page = rows
              ? await indexedMessageRowPage(tp, m[1], {
                  before,
                  rows,
                  chunk: limit,
                  countRows: clientRowCounter(m[1]),
                })
              : await indexedMessagePage(tp, m[1], { before, limit });
            return json({
              id: m[1],
              total: page.total,
              nextBefore: page.nextBefore,
              messages: transcriptMessagesForClient(m[1], page.messages, { deferToolArgs }).map(msgWithHtml),
            });
          }
          const full = url.searchParams.get("full") === "1";
          const rawLimit = parseInt(url.searchParams.get("limit") ?? (full ? "0" : "30"), 10);
          const lim = full
            ? Math.max(0, Math.min(20000, Number.isFinite(rawLimit) ? rawLimit : 0))
            : Math.min(200, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 30));
          const page =
            rows && !full
              ? await indexedMessageRowPage(tp, m[1], {
                  rows,
                  chunk: lim,
                  countRows: clientRowCounter(m[1]),
                })
              : await indexedMessagePage(tp, m[1], { limit: full && lim === 0 ? 20_000 : lim });
          return json({
            id: m[1],
            total: page.total,
            nextBefore: page.nextBefore,
            messages: transcriptMessagesForClient(m[1], page.messages, { deferToolArgs }).map(msgWithHtml),
          });
        }
      }

      {
        // The other half of the deferToolArgs capability: the arguments of ONE
        // tool call, fetched when a reader opens its pill.
        //
        // A pill shows a name and a count, so the arguments are dead weight on
        // the stream until someone asks. A client that opted out of receiving
        // them inline comes here for the one it opened. The index still holds
        // the full text, so nothing is lost and search is unaffected.
        const m = path.match(
          /^\/api\/sessions\/([0-9a-fA-F-]{36})\/messages\/([^/]{1,200})\/tool-args$/,
        );
        if (m && req.method === "GET") {
          const tp = await resolveTranscript(m[1]);
          if (!tp) return err(404, "session transcript not found");
          await ensureChatTranscriptCaughtUp(tp, m[1], "api-tool-args");
          const messageId = decodeURIComponent(m[2]);
          const found = indexedToolUseArgs(tp, messageId);
          if (!found) return err(404, "tool call not found");
          return json({ id: m[1], messageId: found.messageId, name: found.name, args: found.args });
        }
      }

      {
        // Full-text search inside a session's transcript — lets the voice agent
        // (and any client) answer "what did session X say about Y?" without
        // streaming the whole history. Resolves the transcript path the same way
        // as /messages, then greps normalized prose. POST so the query can carry
        // spaces/punctuation cleanly.
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/transcript\/search$/);
        if (m && req.method === "POST") {
          const tp = await resolveTranscript(m[1]);
          if (!tp) return err(404, "session transcript not found");
          const body = (await req.json().catch(() => null)) as {
            query?: string;
            limit?: number;
          } | null;
          const query = body?.query?.trim();
          if (!query) return err(400, "expected { query }");
          const r = await searchTranscriptIndex(tp, m[1], query, { limit: body?.limit });
          return json({ id: m[1], query, ...r });
        }
      }

      {
        const m = path.match(
          /^\/api\/sessions\/([0-9a-fA-F-]{36})\/queue\/([0-9a-f]+)\/retry$/,
        );
        if (m && req.method === "POST") {
          const msg = retryMessage(m[1], m[2]);
          if (!msg) return err(404, "queued message not found");
          return json({ ok: true, msg });
        }
      }

      // Dispatch a coding agent to debug why a send failed. Only valid for a
      // failed message — it spawns an agent into the lfg repo with the
      // message text, the delivery error, and a live capture of the stuck pane.
      {
        const m = path.match(
          /^\/api\/sessions\/([0-9a-fA-F-]{36})\/queue\/([0-9a-f]+)\/debug$/,
        );
        if (m && req.method === "POST") {
          const msg = getMessage(m[1], m[2]);
          if (!msg) return err(404, "queued message not found");
          if (msg.status !== "failed")
            return err(409, "only a failed message can be debugged");
          const sess = (await listSessions()).find((s) => s.sessionId === m[1]);
          const result = await dispatchSendFixAgent({
            failSessionId: m[1],
            failTarget: sess?.tmuxTarget ?? null,
            failTitle: sess?.title,
            msgId: msg.id,
            msgText: msg.text,
            msgError: msg.error,
            msgAttempts: msg.attempts,
          });
          if (!result.ok) return err(502, result.summary);
          return json({ ok: true, ...(result.data as object) });
        }
      }

      {
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/title$/);
        if (m && req.method === "PUT") {
          const body = (await req.json().catch(() => null)) as {
            title?: string;
          } | null;
          await setSessionTitle(m[1], body?.title ?? "");
          return json({ ok: true });
        }
      }

      {
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/answer$/);
        if (m && req.method === "POST") {
          const body = (await req.json().catch(() => null)) as {
            index?: number;
          } | null;
          if (typeof body?.index !== "number")
            return err(400, "missing option index");
          const sess = (await listSessions()).find((s) => s.sessionId === m[1]);
          if (!sess) return err(404, "session not found");
          // Headless harnesses (OpenCode) surface questions on the registry and
          // accept answers via the command file — no tmux pane involved.
          if (!sess.tmuxTarget) {
            const entry = findAisdkEntryByAnyId(m[1]);
            if (!entry)
              return err(409, "session is not in a tmux pane — cannot answer");
            appendAisdkCmd(entry.sessionId, { type: "answer", index: body.index });
            return json({ ok: true });
          }
          const r = await answerPrompt(sess.tmuxTarget, body.index);
          if (!r.ok) return err(502, r.error || "answer failed");
          return json({ ok: true });
        }
      }

      {
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/dismiss$/);
        if (m && req.method === "POST") {
          const sess = (await listSessions()).find((s) => s.sessionId === m[1]);
          if (!sess) return err(404, "session not found");
          if (!sess.tmuxTarget) {
            const entry = findAisdkEntryByAnyId(m[1]);
            if (!entry)
              return err(409, "session is not in a tmux pane — cannot dismiss");
            appendAisdkCmd(entry.sessionId, { type: "dismiss" });
            return json({ ok: true });
          }
          // Skip the question without answering: Escape cancels the selector.
          const r = await dismissPrompt(sess.tmuxTarget);
          if (!r.ok) return err(502, r.error || "dismiss failed");
          return json({ ok: true });
        }
      }

      {
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/interrupt$/);
        if (m && req.method === "POST") {
          const sess = (await listSessions()).find((s) => s.sessionId === m[1]);
          if (!sess) return err(404, "session not found");
          // A single Escape stops the current turn. This doubles as "steer":
          // any message already sitting in Claude's own queue gets processed as
          // the next turn once the running one is interrupted. We deliberately
          // don't drop pending sends — that would discard the message the user
          // is steering with.
          const interrupted = interruptLiveSession(sess);
          if (!interrupted.ok)
            return err(interrupted.status ?? 502, interrupted.error || "interrupt failed");
          return json({ ok: true });
        }
      }

      {
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/diff-stat$/);
        if (m && req.method === "GET") {
          const sess = (await listSessions()).find((s) => s.sessionId === m[1]);
          if (!sess) return err(404, "session not found");
          return json({ stat: computeSessionDiffStat(sess.cwd) });
        }
      }

      {
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/diff$/);
        if (m && req.method === "GET") {
          const sess = (await listSessions()).find((s) => s.sessionId === m[1]);
          if (!sess) return err(404, "session not found");
          // ?summary=1 → fast file-list overview (no patch bodies); the viewer
          // then lazy-loads each file via /diff-file.
          const summary = url.searchParams.get("summary") === "1";
          return json({ diff: summary ? computeSessionDiffSummary(sess.cwd) : computeSessionDiff(sess.cwd) });
        }
      }

      {
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/diff-file$/);
        if (m && req.method === "GET") {
          const sess = (await listSessions()).find((s) => s.sessionId === m[1]);
          if (!sess) return err(404, "session not found");
          const p = url.searchParams.get("path");
          if (!p) return err(400, "missing path");
          const file = computeSessionFilePatch(sess.cwd, p);
          if (!file) return err(404, "no diff for path");
          return json({ file });
        }
      }

      // Files panel: flat path listing for one root. @pierre/trees virtualizes
      // the whole list, so this returns every path under `root` at once rather
      // than one directory level per request. `?root=` navigates (including up,
      // bounded by the browsing ceiling); omitted, it means the session's cwd.
      {
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/tree$/);
        if (m && req.method === "GET") {
          const sess = (await listSessions()).find((s) => s.sessionId === m[1]);
          if (!sess) return err(404, "session not found");
          const tree = listSessionTree(sess.cwd, url.searchParams.get("root"));
          if (!tree.ok) return err(403, tree.error ?? "cannot list that directory");
          return json({ tree });
        }
      }

      // One file's contents, shaped for @pierre/diffs' FileContents. Read-only:
      // a user edit reaches disk as a patch sent to the agent, never as a write
      // from here, so the agent stays the single writer of its own worktree.
      {
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/file$/);
        if (m && req.method === "GET") {
          const sess = (await listSessions()).find((s) => s.sessionId === m[1]);
          if (!sess) return err(404, "session not found");
          const p = url.searchParams.get("path");
          if (!p) return err(400, "missing path");
          const file = await readSessionFile(sess.cwd, p);
          if ("error" in file) return err(file.error === "file not found" ? 404 : 403, file.error);
          return json({ file });
        }
      }

      {
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/close$/);
        if (m && req.method === "POST") {
          const body = (await req.json().catch(() => null)) as { source?: unknown } | null;
          const rawSource = typeof body?.source === "string" ? body.source.trim() : "";
          const source = rawSource ? rawSource.slice(0, 80) : "unknown";
          const closeLog = {
            sessionId: m[1],
            source,
            href: req.headers.get("referer") ?? undefined,
          };
          const sess = (await listSessions()).find((s) => s.sessionId === m[1]);
          evlog("session_close_request", {
            ...closeLog,
            found: !!sess,
            agent: sess?.agent,
            tmuxName: sess?.tmuxName,
            managed: sess?.managed,
          });
          if (!sess) return err(404, "session not found");
          const outcome = await closeLiveSession(sess, m[1], closeLog);
          if (!outcome.ok) return err(outcome.status, outcome.reason);
          return json({ ok: true });
        }
      }

      if (path === "/api/live/status") {
        noteListSessionsClientActivity();
        const ids = (url.searchParams.get("ids") ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter((s) => /^[0-9a-fA-F-]{36}$/.test(s))
          .slice(0, 120);
        const wanted = new Set(ids);
        let iv: ReturnType<typeof setInterval> | null = null;
        let hb: ReturnType<typeof setInterval> | null = null;
        let closed = false;
        const slim = (s: Session) => ({
          sessionId: s.sessionId,
          busy: !!s.busy,
          title: s.title ?? null,
          lastUserText: s.lastUserText ?? null,
          lastActivityAt: s.lastActivityAt ?? null,
          status: s.status ?? "ok",
          statusReason: s.statusReason ?? null,
          statusDetail: s.statusDetail ?? null,
          model: s.model ?? null,
        });
        const stream = new ReadableStream({
          start(controller) {
            const send = (s: string) => {
              if (closed) return;
              try {
                controller.enqueue(s);
              } catch {
                closed = true;
              }
            };
            let lastSig = "";
            const publish = async () => {
              if (closed) return;
              const t0 = performance.now();
              const rows = (await listSessions())
                .filter((s) => s.sessionId && (!wanted.size || wanted.has(s.sessionId)))
                .map(slim);
              const sig = JSON.stringify(rows);
              const changed = sig !== lastSig;
              if (changed) {
                lastSig = sig;
                send(`event: status\ndata: ${sig}\n\n`);
              }
              evlog("live_status_tick", {
                idsCount: ids.length,
                sessions: rows.length,
                changed,
                durationMs: Math.round((performance.now() - t0) * 1000) / 1000,
              });
            };
            void publish();
            iv = setInterval(() => void publish(), 2000);
            hb = setInterval(() => send(`: hb\n\n`), 15000);
          },
          cancel() {
            closed = true;
            if (iv) clearInterval(iv);
            if (hb) clearInterval(hb);
          },
        });
        return new Response(stream, { headers: sseHeaders() });
      }

      // Multiplexed live stream: one connection tails many transcripts and
      // polls many panes. The per-session /stream endpoint opens one HTTP
      // connection each, so >6 open panes blow past the browser's per-host
      // connection cap and the oldest panes silently stop updating. This
      // folds them into a single SSE; events carry a `sid` so the client can
      // route them to the right pane.
      if (path === "/api/live/stream") {
        noteListSessionsClientActivity();
        const rid =
          (url.searchParams.get("rid") || "").replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 80) ||
          randomBytes(6).toString("hex");
        const ids = (url.searchParams.get("ids") ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter((s) => /^[0-9a-fA-F-]{36}$/.test(s))
          .slice(0, 24);
        // Per-connection capability, declared on the stream URL. Absent means
        // the old payload, so an older EventSource client is unchanged.
        const deferToolArgs = requestedDeferToolArgs(url);
        evlog("live_stream_request", { rid, ids, idsCount: ids.length, deferToolArgs });
        type LivePane = { sid: string; tp: string | null; target: string | null; agent: Session["agent"] | null };
        let panes: LivePane[] = [];

        let iv: ReturnType<typeof setInterval> | null = null;
        let pi: ReturnType<typeof setInterval> | null = null;
        let di: ReturnType<typeof setInterval> | null = null;
        let hb: ReturnType<typeof setInterval> | null = null;
        const transcriptUnsubs = new Map<string, () => void>();
        let artifactUnsub: (() => void) | null = null;
        let closed = false;
        const stream = new ReadableStream({
          start(controller) {
            const send = (s: string) => {
              if (closed) return;
              try {
                controller.enqueue(s);
              } catch {
                closed = true;
              }
            };
            send(`: open\n\n`);
            evlog("live_stream_start", { rid, idsCount: ids.length });
            const lastSig = new Map<string, string>();
            const lastMessageAt = new Map<string, number>();
            const lastStallLogAt = new Map<string, number>();
            const markMessage = (sid: string) => lastMessageAt.set(sid, Date.now());
            const traceStallIfNeeded = (p: LivePane, busy: boolean) => {
              const now = Date.now();
              if (!busy) {
                lastMessageAt.set(p.sid, now);
                return;
              }
              const idleMs = now - (lastMessageAt.get(p.sid) ?? now);
              if (idleMs < 10_000 || now - (lastStallLogAt.get(p.sid) ?? 0) < 10_000) return;
              lastStallLogAt.set(p.sid, now);
              evlog("live_stream_stall", {
                transport: "sse",
                rid,
                sid: p.sid,
                transcriptPath: p.tp,
                idleMs,
              });
            };
            artifactUnsub = subscribeIndexedArtifactMessages(({ sessionId, message }) => {
              if (closed || !ids.includes(sessionId)) return;
              markMessage(sessionId);
              send(`event: msg\ndata: ${JSON.stringify({ sid: sessionId, m: msgWithHtml(message) })}\n\n`);
            });
            const subscribeTranscriptOne = (p: LivePane, tp: string) => {
              if (transcriptUnsubs.has(p.sid)) return;
              p.tp = tp;
              transcriptUnsubs.set(
                p.sid,
                subscribeChatTranscript(tp, p.sid, (event) => {
                  if (closed) return;
                  const messages = liveTranscriptMessagesForClient(event.messages, { deferToolArgs });
                  if (messages.length) markMessage(p.sid);
                  for (const msg of messages) {
                    send(`event: msg\ndata: ${JSON.stringify({ sid: p.sid, m: msgWithHtml(msg) })}\n\n`);
                  }
                }),
              );
            };
            const ensureTranscriptOne = async (p: LivePane) => {
              if (closed) return;
              if (transcriptUnsubs.has(p.sid)) return;
              try {
                if (!p.tp) {
                  const tp = await resolveTranscript(p.sid);
                  if (!tp) return;
                  subscribeTranscriptOne(p, tp);
                  return;
                }
                subscribeTranscriptOne(p, p.tp);
              } catch (err) {
                const code = (err as { code?: string } | null)?.code;
                if (code !== "ENOENT") {
                  evlog("live_stream_ingest_error", {
                    rid,
                    sid: p.sid,
                    transcriptPath: p.tp,
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
              }
            };
            const lastBusy = new Map<string, string>();
            const lastDraft = new Map<string, DraftState>();
            const pollDraftOne = (p: LivePane) => {
              if (closed || p.target) return;
              const entry = findAisdkEntryByAnyId(p.sid);
              if (!entry || !isAisdkEntryBusy(entry)) return;
              sendAiTextDeltaPart(send, p.sid, entry, lastDraft, true);
            };
            const pollOne = async (p: LivePane) => {
              if (closed) return;
              if (!p.target) {
                // Pane-less (aisdk / codex-aisdk) session: busy comes from the
                // registry, and there are no pane-scraped prompts. For a
                // codex-aisdk session the sid may be the threadId rather than the
                // control-plane key, so look it up by either.
                const entry = findAisdkEntryByAnyId(p.sid);
                if (!entry) return;
                const busy = isAisdkEntryBusy(entry);
                const bsig = busy ? "1" : "0";
                if (bsig !== (lastBusy.get(p.sid) ?? "0")) {
                  lastBusy.set(p.sid, bsig);
                  send(`event: busy\ndata: ${JSON.stringify({ sid: p.sid, busy })}\n\n`);
                }
                traceStallIfNeeded(p, busy);
                if (busy) sendAiTextDeltaPart(send, p.sid, entry, lastDraft, true);
                else lastDraft.delete(p.sid);
                return;
              }
              const pane = capturePane(p.target);
              const prompt = await resolveSessionPrompt(p.tp, pane);
              if (closed) return;
              const sig = prompt ? JSON.stringify(prompt) : "";
              if (sig !== (lastSig.get(p.sid) ?? " ")) {
                lastSig.set(p.sid, sig);
                send(
                  `event: prompt\ndata: ${JSON.stringify({ sid: p.sid, prompt: prompt ?? null })}\n\n`,
                );
              }
              const busy = pane ? (p.agent === "jcode" ? isJcodeBusy(pane) : isBusy(pane)) : false;
              const bsig = busy ? "1" : "0";
              if (bsig !== (lastBusy.get(p.sid) ?? "0")) {
                lastBusy.set(p.sid, bsig);
                send(`event: busy\ndata: ${JSON.stringify({ sid: p.sid, busy })}\n\n`);
              }
              traceStallIfNeeded(p, busy);
            };
            const lastQ = new Map<string, string>();
            const queueOne = (p: { sid: string }) => {
              if (closed) return;
              const queue = listQueue(p.sid);
              const sig = JSON.stringify(queue);
              if (sig === (lastQ.get(p.sid) ?? "[]")) return;
              lastQ.set(p.sid, sig);
              send(`event: queue\ndata: ${JSON.stringify({ sid: p.sid, queue })}\n\n`);
            };
            const hydrateTargets = async () => {
              if (closed || !panes.length) return;
              const listT0 = performance.now();
              const all = await listSessions();
              evlog("live_stream_list_sessions", {
                rid,
                sessionCount: all.length,
                durationMs: Math.round((performance.now() - listT0) * 1000) / 1000,
                phase: "target_hydration",
              });
              const bySid = new Map(all.map((s) => [s.sessionId, s]));
              for (const p of panes) {
                const session = bySid.get(p.sid);
                p.target = session?.tmuxTarget ?? null;
                p.agent = session?.agent ?? null;
              }
            };
            (async () => {
              const resolveT0 = performance.now();
              const resolved = await Promise.all(
                ids.map(async (sid) => {
                  const sidT0 = performance.now();
                  const tp = await resolveTranscript(sid);
                  const entry = findAisdkEntryByAnyId(sid);
                  evlog("live_stream_resolve_transcript", {
                    rid,
                    sid,
                    found: !!tp,
                    durationMs: Math.round((performance.now() - sidT0) * 1000) / 1000,
                  });
                  return tp || entry
                    ? ({ sid, tp, target: null, agent: null } satisfies LivePane)
                    : null;
                }),
              );
              if (closed) return;
              panes = resolved.filter((p): p is NonNullable<typeof p> => !!p);
              const paneIds = new Set(panes.map((p) => p.sid));
              const missingIds = ids.filter((sid) => !paneIds.has(sid));
              evlog("live_stream_resolved", {
                rid,
                panesCount: panes.length,
                missingCount: missingIds.length,
                durationMs: Math.round((performance.now() - resolveT0) * 1000) / 1000,
              });
              for (const sid of missingIds) {
                send(`event: ready\ndata: ${JSON.stringify({ sid })}\n\n`);
                evlog("live_stream_ready", { rid, sid, missing: true });
              }
              await Promise.all(panes.map(async (p) => {
                try {
                  if (!p.tp) {
                    lastSig.set(p.sid, " ");
                    lastQ.set(p.sid, "[]");
                    lastBusy.set(p.sid, "?");
                    lastMessageAt.set(p.sid, Date.now());
                    pollOne(p);
                    queueOne(p);
                    return;
                  }
                  await ensureChatTranscriptCaughtUp(p.tp, p.sid, "sse-backlog");
                  const backlogT0 = performance.now();
                  const page = await indexedMessageRowPage(p.tp, p.sid, {
                    rows: LIVE_BACKLOG_ROWS,
                    chunk: 40,
                    maxMessages: LIVE_BACKLOG_MAX_MESSAGES,
                    countRows: clientRowCounter(p.sid),
                  });
                  const readMs = performance.now() - backlogT0;
                  const renderT0 = performance.now();
                  const msgs = transcriptMessagesForClient(p.sid, page.messages, {
                    deferToolArgs,
                  }).map(msgWithHtml);
                  evlog("live_stream_backlog", {
                    rid,
                    sid: p.sid,
                    messages: msgs.length,
                    nextBefore: page.nextBefore,
                    readMs: Math.round(readMs * 1000) / 1000,
                    renderMs: Math.round((performance.now() - renderT0) * 1000) / 1000,
                    totalMs: Math.round((performance.now() - backlogT0) * 1000) / 1000,
                  });
                  send(
                    `event: batch\ndata: ${JSON.stringify({
                      sid: p.sid,
                      messages: msgs,
                      nextBefore: page.nextBefore,
                    })}\n\n`,
                  );
                  subscribeTranscriptOne(p, p.tp);
                  lastMessageAt.set(p.sid, Date.now());
                  lastSig.set(p.sid, " ");
                  lastQ.set(p.sid, "[]");
                  // Seed busy with a sentinel (not "0") so the first pollOne always
                  // emits the CURRENT busy state as a baseline. Without this, a
                  // client reconnecting (e.g. after a serve restart) while holding a
                  // stale busy=true never gets a corrective event, because the new
                  // connection's implicit "0" baseline matches a now-idle session
                  // and the change-gate suppresses the emit — leaving the card stuck
                  // showing "Working".
                  lastBusy.set(p.sid, "?");
                  pollOne(p);
                  queueOne(p);
                } finally {
                  send(`event: ready\ndata: ${JSON.stringify({ sid: p.sid })}\n\n`);
                  evlog("live_stream_ready", { rid, sid: p.sid, missing: false });
                }
              }));
              void hydrateTargets().then(() => {
                for (const p of panes) {
                  pollOne(p);
                  queueOne(p);
                }
              });
              iv = setInterval(() => {
                for (const p of panes) void ensureTranscriptOne(p);
              }, 700);
              pi = setInterval(() => {
                for (const p of panes) {
                  pollOne(p);
                  queueOne(p);
                  void reconcileQueued(p.sid).then((c) => c && queueOne(p));
                }
              }, 1000);
              di = setInterval(() => {
                for (const p of panes) pollDraftOne(p);
              }, 150);
            })();
            hb = setInterval(() => send(`: hb\n\n`), 15000);
          },
          cancel() {
            closed = true;
            for (const unsub of transcriptUnsubs.values()) unsub();
            transcriptUnsubs.clear();
            artifactUnsub?.();
            if (iv) clearInterval(iv);
            if (pi) clearInterval(pi);
            if (di) clearInterval(di);
            if (hb) clearInterval(hb);
          },
        });
        return new Response(stream, { headers: sseHeaders() });
      }

      {
        const m = path.match(/^\/api\/sessions\/([0-9a-fA-F-]{36})\/stream$/);
        if (m) {
          const session = (await listSessions()).find(
            (s) => s.sessionId === m[1] || s.nativeSessionId === m[1],
          );
          const sid = session?.sessionId ?? m[1];
          const tp = await resolveTranscript(m[1]);
          if (!tp) return err(404, "session transcript not found");
          const target = session?.tmuxTarget ?? null;
          // Same per-connection capability as /api/live/stream.
          const deferToolArgs = requestedDeferToolArgs(url);
          let iv: ReturnType<typeof setInterval> | null = null;
          let pi: ReturnType<typeof setInterval> | null = null;
          let di: ReturnType<typeof setInterval> | null = null;
          let qi: ReturnType<typeof setInterval> | null = null;
          let artifactUnsub: (() => void) | null = null;
          let hb: ReturnType<typeof setInterval> | null = null;
          let transcriptUnsub: (() => void) | null = null;
          let closed = false;
          const stream = new ReadableStream({
            start(controller) {
              const send = (s: string) => {
                if (closed) return;
                try {
                  controller.enqueue(s);
                } catch {
                  closed = true;
                }
              };
              let lastMessageAt = Date.now();
              let lastStallLogAt = 0;
              const traceStallIfNeeded = (busy: boolean) => {
                const now = Date.now();
                if (!busy) {
                  lastMessageAt = now;
                  return;
                }
                const idleMs = now - lastMessageAt;
                if (idleMs < 10_000 || now - lastStallLogAt < 10_000) return;
                lastStallLogAt = now;
                evlog("live_stream_stall", {
                  transport: "sse-single",
                  sid,
                  transcriptPath: tp,
                  idleMs,
                });
              };
              artifactUnsub = subscribeIndexedArtifactMessages(({ sessionId, message }) => {
                if (closed || sessionId !== sid) return;
                lastMessageAt = Date.now();
                send(`event: msg\ndata: ${JSON.stringify(msgWithHtml(message))}\n\n`);
              });
              const ensureTranscript = async () => {
                if (closed) return;
                try {
                  if (!transcriptUnsub) {
                    transcriptUnsub = subscribeChatTranscript(tp, sid, (event) => {
                      if (closed) return;
                      const messages = liveTranscriptMessagesForClient(event.messages, { deferToolArgs });
                      if (messages.length) lastMessageAt = Date.now();
                      for (const msg of messages) send(`event: msg\ndata: ${JSON.stringify(msgWithHtml(msg))}\n\n`);
                    });
                  }
                  await ensureChatTranscriptCaughtUp(tp, sid, "sse-single-live");
                } catch (err) {
                  const code = (err as { code?: string } | null)?.code;
                  if (code !== "ENOENT") {
                    evlog("live_stream_ingest_error", {
                      transport: "sse-single",
                      sid,
                      transcriptPath: tp,
                      error: err instanceof Error ? err.message : String(err),
                    });
                  }
                }
              };
              // backlog, then tail
              (async () => {
                await ensureChatTranscriptCaughtUp(tp, sid, "sse-single-backlog");
                const page = await indexedMessageRowPage(tp, sid, {
                  rows: LIVE_BACKLOG_ROWS,
                  chunk: 40,
                  maxMessages: LIVE_BACKLOG_MAX_MESSAGES,
                  countRows: clientRowCounter(sid),
                });
                const msgs = transcriptMessagesForClient(
                  sid,
                  page.messages,
                  { deferToolArgs },
                ).map(msgWithHtml);
                for (const msg of msgs)
                  send(`event: msg\ndata: ${JSON.stringify(msg)}\n\n`);
                await ensureTranscript();
              })();
              // Poll the tmux pane for an interactive selector (permission /
              // plan prompts live in the TUI, not the transcript). Emit only on
              // change so the client can render/clear a prompt panel.
              if (target) {
                let lastSig = " ";
                // Sentinel (not "0") so the first poll emits the current busy
                // baseline — corrects a client holding a stale busy across reconnect.
                let lastBusy = "?";
                const pollPrompt = async () => {
                  if (closed) return;
                  const pane = capturePane(target);
                  const prompt = await resolveSessionPrompt(tp, pane);
                  if (closed) return;
                  const sig = prompt ? JSON.stringify(prompt) : "";
                  if (sig !== lastSig) {
                    lastSig = sig;
                    send(`event: prompt\ndata: ${prompt ? sig : "null"}\n\n`);
                  }
                  const bsig = pane && isBusy(pane) ? "1" : "0";
                  if (bsig !== lastBusy) {
                    lastBusy = bsig;
                    send(`event: busy\ndata: ${bsig === "1" ? "true" : "false"}\n\n`);
                  }
                  traceStallIfNeeded(bsig === "1");
                };
                pollPrompt();
                pi = setInterval(pollPrompt, 1000);
              } else {
                // Pane-less (aisdk / codex-aisdk) session: source busy from the
                // registry — by key or threadId (codex-aisdk's sid is the latter).
                // Sentinel baseline so the first poll always emits current state.
                let lastBusy = "?";
                const lastDraft = new Map<string, DraftState>();
                const pollBusy = () => {
                  if (closed) return;
                  const entry = findAisdkEntryByAnyId(sid);
                  if (!entry) return;
                  const busy = isAisdkEntryBusy(entry);
                  const bsig = busy ? "1" : "0";
                  if (bsig !== lastBusy) {
                    lastBusy = bsig;
                    send(`event: busy\ndata: ${busy ? "true" : "false"}\n\n`);
                  }
                  traceStallIfNeeded(busy);
                  if (!busy) lastDraft.delete(sid);
                };
                const pollDraft = () => {
                  if (closed) return;
                  const entry = findAisdkEntryByAnyId(sid);
                  if (!entry || !isAisdkEntryBusy(entry)) return;
                  sendAiTextDeltaPart(send, sid, entry, lastDraft, false);
                };
                pollBusy();
                pollDraft();
                pi = setInterval(pollBusy, 1000);
                di = setInterval(pollDraft, 150);
              }
              // Emit the outbound send-queue on change so the composer can show
              // each message's delivery status (pending/queued/delivered/failed).
              let lastQ = "[]";
              const pollQueue = () => {
                if (closed) return;
                const queue = listQueue(sid);
                const sig = JSON.stringify(queue);
                if (sig === lastQ) return;
                lastQ = sig;
                send(`event: queue\ndata: ${sig}\n\n`);
              };
              pollQueue();
              qi = setInterval(() => {
                pollQueue();
                void reconcileQueued(sid).then((c) => c && pollQueue());
              }, 1000);
              hb = setInterval(() => send(`: hb\n\n`), 15000);
            },
            cancel() {
              closed = true;
              transcriptUnsub?.();
              artifactUnsub?.();
              if (iv) clearInterval(iv);
              if (pi) clearInterval(pi);
              if (di) clearInterval(di);
              if (qi) clearInterval(qi);
              if (hb) clearInterval(hb);
            },
          });
          return new Response(stream, { headers: sseHeaders() });
        }
      }

      if (
        req.method === "GET" &&
        !path.startsWith("/api/") &&
        !path.startsWith("/assets/") &&
        req.headers.get("accept")?.includes("text/html")
      ) {
        return webIndexResponse();
      }

      return err(404, "not found");
      } finally {
        if (apiTimingStart) evlog("api_timing", { endpoint: path, durationMs: apiDurationMs(apiTimingStart) });
      }
      })();
      // Any write under /api/coding-agents can change what statusFor() probes
      // (connect an account, run setup, drop a key, log in via terminal). There
      // are a dozen such routes, so invalidate at this one choke point instead
      // of per-handler, where a newly added route would silently miss it. Runs
      // AFTER the handler so the next read re-probes the post-mutation state.
      // /api/setup/... is included because runSetupAction can install a CLI,
      // which changes the binary paths statusFor() reports.
      if (
        req.method !== "GET" &&
        (path.startsWith("/api/coding-agents") || path.startsWith("/api/setup"))
      ) {
        invalidateCodingAgentsCache();
      }
      return maybeCompressResponse(req, path, response);
    },
  });

  const recovered = await reconcileCommandFileSessions((l) => console.log(l));
  if (recovered.adopted || recovered.recovered || recovered.failed || recovered.skippedLegacy) {
    console.log(`[session-recovery] adopted=${recovered.adopted} recovered=${recovered.recovered} recoveredTmux=${recovered.recoveredTmux} failed=${recovered.failed} skippedLegacy=${recovered.skippedLegacy}`);
    invalidateListSessionsCache();
  }
  const resumedQueueMessages = resumePersistedQueues();
  if (resumedQueueMessages) {
    console.log(`[sendq] resumed=${resumedQueueMessages}`);
  }
  // Probe the coding agents once at boot so the first dashboard open reads a
  // warm cache instead of paying ~1.5 s of CLI spawns in the foreground.
  warmCodingAgentsCache();
  // Bot-owned routines fire as a nudge into the owning bot's own conversation
  // instead of running headless — deliverBotMessage is the same primitive
  // POST /api/bots/:id/messages uses for a human's message, so both converge
  // on one "how a message reaches a bot" code path.
  setBotRoutineDelivery(async (agent) => {
    if (agent.owner.kind !== "bot") return;
    const bot = await getBot(agent.owner.botId);
    if (!bot || !bot.enabled) {
      console.error(`[auto-sched] routine ${agent.id} owner bot ${agent.owner.botId} is gone or disabled — skipping`);
      return;
    }
    const prepared = await applyPendingBotRotation(migrateLegacyBotRefreshFlag(bot));
    if (prepared.rotationState === "failed" && prepared.rotationReason === "config") {
      console.error(`[auto-sched] routine ${agent.id} is waiting for bot ${bot.id} to refresh`);
      return;
    }
    const result = await serializeBotWork(bot.id, async () => {
      const current = (await getBot(bot.id)) ?? prepared;
      return deliverBotMessage(current, routineNudgeText(agent));
    });
    if ("error" in result) {
      console.error(`[auto-sched] routine ${agent.id} delivery failed: ${result.error}`);
    }
  });
  startAutoScheduler((l) => console.log(l));
  setWakeHooksBootId(SERVER_INSTANCE_ID);
  void pushWakeHooksNow();
  // Rolling CPU/RAM/network/PSI history for the settings Performance panel.
  startMetricsSampler();
  const stopArtifactRefresh = startArtifactRefreshScheduler((l) => console.log(l));
  // Refresh scripts are detached process groups so timeouts can kill their
  // descendants. Tear all of them down before the server exits on either
  // interactive or service-manager shutdown.
  const stopRefreshOnExit = () => stopArtifactRefresh();
  process.once("exit", stopRefreshOnExit);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const handler = () => {
      stopArtifactRefresh();
      process.off("exit", stopRefreshOnExit);
      process.off(signal, handler);
      process.kill(process.pid, signal);
    };
    process.once(signal, handler);
  }
  startModelDiscoveryScheduler((l) => console.log(l));
  startWorktreeSweep((l) => console.log(l));
  startTmpSweep((l) => console.log(l));
  startBotCompactionSweep();
  // Watch the fleet for busy -> idle transitions and fan "completed" events out
  // to fleet subscribers (Web Push). Idempotent + best-effort.
  startFleetWatcher();
  // Bridge those same completions to Web Push, so an installed PWA hears
  // about a landed turn with the app closed. Must follow startFleetWatcher().
  startSessionPushBridge();
  // Keep SQLite as the chat read model for every active session. Transcript
  // JSONL files are treated as an import source; live draft deltas stay
  // ephemeral until the provider writes the completed turn.
  startChatIngestMonitor(listSessionsCached);
  // Warm the resumable-session cache in the background so the first time someone
  // opens the resume picker it's already served from SQLite (no cold scan wait).
  void refreshResumableCache({ force: true }).catch(() => {});

  console.log(`lfg web → http://${server.hostname}:${server.port}`);
  console.log(`  agents dir: ${AGENTS_DIR}`);

}
