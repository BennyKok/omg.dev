export { APP_BUILDER_PRESET, APP_BUILDER_MODEL, APP_BUILDER_REVIEWER, APP_BUILDER_DESIGN_REVIEWER } from "./builder-presets.js";
export type { BrowserLoginRequest, BrowserLoginSnapshot, BrowserLoginCookie } from "./browser-login";
export type { PreviewLevel, ProjectPreview, ProjectPreviewSnapshot, SimulatorStream, SimulatorStreamProvider } from "./project-preview";
export { inlinePreviewUrl, PHONE_LEVEL_TEXT, PREVIEW_LEVEL_LABEL, PROJECT_PREVIEW_BUILD_ANDROID_MESSAGE, PROJECT_PREVIEW_RESTART_MESSAGE, PROJECT_PREVIEW_SIMULATOR_PATH, previewLevels, simulatorStatusText } from "./project-preview.js";
export type { ExpoAccountSnapshot, ExpoConnectMode, ExpoConnectState, ExpoConnectStatus } from "./expo-account";
export { EXPO_SIGNUP_LABEL, expoConnectActive, expoConnectMessage } from "./expo-account.js";
export type { KioskFrame, KioskRect } from "./computer-kiosk";
export { COMPUTER_KIOSK_PATH, keysymFor, kioskHitsInput, kioskHost, kioskLayout, NAMED_KEYSYMS } from "./computer-kiosk.js";

export type OmgSessionStatus =
  | "ok"
  | "blocked";

export type OmgSessionStatusReason =
  | "model_unavailable"
  | "out_of_credits"
  | "provider_auth"
  | "provider_error"
  | "interrupted"
  | "out_of_memory"
  | "launch_failed"
  | null;

export interface OmgSession {
  agent?: string;
  agentLabel?: string | null;
  pid?: number;
  cmd?: string;
  cwd?: string;
  /** Empty string means a chat explicitly started without a project. */
  project?: string;
  title?: string | null;
  lastUserText?: string | null;
  sessionId: string | null;
  nativeSessionId?: string | null;
  startedAt?: number | null;
  lastActivityAt?: number | null;
  last?: { role?: string; kind?: string; text?: string; ts?: number };
  tmuxTarget?: string | null;
  tmuxName?: string | null;
  managed?: boolean;
  assignedUser?: string | null;
  model?: string | null;
  builderPreset?: string | null;
  parentSessionId?: string | null;
  parentNativeSessionId?: string | null;
  parentAgent?: string | null;
  spawnedBy?: string | null;
  capabilityVersion?: string | null;
  capabilitiesStale?: boolean;
  status?: OmgSessionStatus;
  statusReason?: OmgSessionStatusReason;
  statusDetail?: string | null;
  busy?: boolean;
}

export interface OmgMessage {
  id?: string;
  role?: string;
  kind?: string;
  text?: string;
  html?: string;
  ts?: number;
  url?: string;
  artifactId?: string;
  name?: string;
  mimeType?: string;
  size?: number;
  caption?: string;
  alt?: string;
  version?: number;
  title?: string;
  pending?: boolean;
  seed?: boolean;
  catchUp?: boolean;
  /**
   * Length in characters of the tool_use arguments the server left out.
   *
   * Present only on a `tool_use` message, and only when the connection asked
   * for the `deferToolArgs` capability. `text` is then the bare tool name
   * instead of `Name: <json>`, and the arguments are fetched on demand from
   * `GET /api/sessions/:id/messages/:messageId/tool-args`.
   *
   * A client that never asks for the capability never sees this field and
   * keeps receiving the full inline text.
   */
  toolArgsLen?: number;
  /**
   * Kind `work`: one run of tool calls and thoughts, folded by the server
   * for a connection that declared the `workRows` capability. The row is
   * re-sent under the same id as the run grows; an empty list withdraws it.
   */
  steps?: OmgMessage[];
  /** An artifact: the display tool call that produced it (`workRows`). */
  tool?: OmgMessage;
}

/**
 * What a connection asks the server to do to the transcript on the wire.
 * Both are additive and optional: a client that declares neither receives
 * the raw stream every client received before they existed.
 *
 * - `workRows`: fold every run of tool_use / tool_result / thinking into one
 *   `work` message carrying its `steps`, and put a display tool call on the
 *   artifact it produced as `tool`.
 * - `deferToolArgs`: send tool_use names only (`toolArgsLen` marks the cut)
 *   and let the client fetch arguments on demand.
 */
export interface OmgLiveCapabilities {
  workRows?: boolean;
  deferToolArgs?: boolean;
}

/**
 * The text of one draft the agent is streaming, accumulated for the client:
 * a reply (`text`) or reasoning (`thinking`). The two share a wire channel
 * (`ai_part`) and are told apart only by `kind`; a client that appended
 * every delta to one string drew the agent's reasoning as its answer.
 */
export interface OmgDraft {
  id: string;
  kind: "text" | "thinking";
  text: string;
  ts?: number;
}

export interface OmgAiStreamPart {
  type: "text-delta" | "text-start" | "text-end" | "error" | string;
  id?: string;
  /** Defaults to text for compatibility with older servers. */
  kind?: "text" | "thinking";
  delta?: string;
  text?: string;
  reset?: boolean;
  ts?: number;
}

export interface OmgPromptOption {
  index: number;
  label: string;
  selected?: boolean;
  /** What picking this option means, when the agent wrote it. */
  description?: string;
}

export interface OmgSessionPrompt {
  question?: string;
  /** A short label for the question, such as "Auth method". */
  header?: string;
  options: OmgPromptOption[];
}

export interface OmgQueueMessage {
  id: string;
  text: string;
  status: "pending" | "sending" | "queued" | "held" | "failed" | "delivered";
  error?: string;
  createdAt?: number;
  updatedAt?: number;
  /** False when the message waits for something other than the running turn. */
  queuedBehindTurn?: boolean;
}

/**
 * One step of a coding agent's own to-do list, normalized across agents
 * (Claude's TodoWrite and TaskCreate/TaskUpdate, Codex's todo_list).
 */
export interface OmgPlanItem {
  id: string;
  text: string;
  /** What the agent shows while the step runs ("Running tests"), when it gives one. */
  activeText?: string;
  status: "pending" | "in_progress" | "completed";
}

/** A sub-agent or background task the session started. */
export interface OmgPlanAgent {
  id: string;
  title: string;
  /** The sub-agent type ("Explore") or task type ("local_bash"), when known. */
  kind?: string;
  status: "running" | "completed" | "failed" | "stopped";
  startedAt: number;
  endedAt?: number;
  /** The latest activity line while it runs, its summary once it ends. */
  detail?: string;
}

/**
 * What a session's agent says it is doing: its to-do list and its
 * sub-agents. Written by the agent's harness, sent whole on every change.
 */
export interface OmgSessionPlan {
  /** The agent format it was read from: "claude", "codex". */
  source: string;
  updatedAt: number;
  items: OmgPlanItem[];
  agents: OmgPlanAgent[];
  /** The agent's own status, set with the omg_panel tool. */
  status?: OmgPanelStatus;
}

/** One key number in an agent's status. */
export interface OmgPanelStat {
  label: string;
  value: string;
  tone?: "good" | "warn" | "bad";
}

/** One chart in an agent's status: plain numbers, drawn by the client. */
export interface OmgPanelChart {
  title?: string;
  kind: "line" | "bar";
  unit?: string;
  points: Array<{ label: string; value: number }>;
}

/**
 * What a long-running agent wants the person to see at a glance. Data only:
 * the client renders it in its own design.
 */
export interface OmgPanelStatus {
  updatedAt: number;
  /** One line: where the work stands. */
  headline: string;
  /** Markdown. */
  text?: string;
  stats?: OmgPanelStat[];
  chart?: OmgPanelChart;
  media?: OmgPanelMedia[];
}

/** One visual in an agent's status, served as an artifact. */
export interface OmgPanelMedia {
  kind: "image" | "video" | "model" | "html";
  artifactId: string;
  /** `/api/artifacts/<id>`. */
  url: string;
  caption?: string;
  width?: number;
  height?: number;
  /** Changes when the bytes change. */
  version: number;
}

export type OmgLiveChannelKind =
  | "transcript"
  | "status"
  | "agent_run";

export interface OmgLiveChannel {
  kind: OmgLiveChannelKind;
  key: string;
  resumeFromSeq?: number;
}

/**
 * Optional capabilities a client declares on its `subscribe` frame.
 *
 * Every field is additive and defaults to the pre-capability behaviour, so a
 * client that sends none keeps the exact wire it had before.
 */
export interface OmgLiveSubscribeCapabilities {
  /**
   * Leave tool_use arguments out of transcript frames and send the bare tool
   * name instead. The client fetches the arguments of a call when a reader
   * opens it. Latches on for the life of the connection once requested.
   */
  deferToolArgs?: boolean;
}

export interface OmgStatusRow {
  sessionId: string | null;
  busy?: boolean;
  title?: string | null;
  lastUserText?: string | null;
  lastActivityAt?: number | null;
  status?: OmgSessionStatus;
  statusReason?: OmgSessionStatusReason;
  statusDetail?: string | null;
  model?: string | null;
}

/**
 * A list a client shows changed on the server: `repos` (GET /api/repos),
 * `pins` (GET /api/session-pins), `auto` (GET /api/auto/agents and
 * /api/auto/findings), `bots` (GET /api/bots), `ask` (GET /api/ask),
 * `threads` (GET /api/threads).
 */
export type OmgChangeTopic = "repos" | "pins" | "auto" | "bots" | "ask" | "threads" | "sessions";

export type OmgLiveMessage =
  /**
   * Re-read these lists. Never replayed on resume. A server sends one with
   * empty `topics` when a socket opens: that announces support, and a client
   * should re-read the lists once, because changes made while it was away
   * were not announced to it.
   */
  | { t: "changed"; topics: OmgChangeTopic[] }
  /**
   * Who is typing in `sid` right now, as the COMPLETE set rather than a
   * join/leave event, and never replayed on resume. A client replaces its set
   * for the session on each frame. `ids` are conversation participant ids;
   * join them against the roster the client already has.
   */
  | { t: "typing"; sid: string; ids: string[] }
  | { t: "batch"; sid: string; messages?: OmgMessage[]; nextBefore?: number | null }
  | { t: "msg"; sid: string; message?: OmgMessage; m?: OmgMessage }
  | { t: "ai_part"; sid: string; part?: OmgAiStreamPart }
  | { t: "queue"; sid: string; queue?: OmgQueueMessage[] }
  /** The session's plan as it stands (OmgSessionPlan); null when it has none. */
  | { t: "plan"; sid: string; plan?: OmgSessionPlan | null }
  | { t: "busy"; sid: string; busy?: boolean }
  | { t: "prompt"; sid: string; prompt?: OmgSessionPrompt | null }
  | {
      t: "snapshot";
      kind: OmgLiveChannelKind;
      key: string;
      sid?: string;
      seq?: number;
      messages?: OmgMessage[];
      nextBefore?: number | null;
    }
  | {
      t: "delta";
      kind: OmgLiveChannelKind;
      key: string;
      seq?: number;
      delta?: {
        t?: string;
        sid?: string;
        message?: OmgMessage;
        m?: OmgMessage;
        part?: OmgAiStreamPart;
        busy?: boolean;
        prompt?: OmgSessionPrompt | null;
        queue?: OmgQueueMessage[];
        plan?: OmgSessionPlan | null;
      };
    }
  | { t: "resumed"; kind: OmgLiveChannelKind; key: string; seq?: number; fromSeq?: number; toSeq?: number; replayed?: number }
  | { t: "gap"; kind: OmgLiveChannelKind; key: string; seq?: number }
  | { t: "status"; rows?: OmgStatusRow[]; kind?: OmgLiveChannelKind; key?: string; seq?: number }
  | { t: "ping"; id?: string }
  | { t: "pong"; id?: string }
  | { t: "error"; sid?: string; kind?: OmgLiveChannelKind; key?: string; seq?: number; message?: string; code?: string };

export interface OmgSessionsResponse {
  sessions: OmgSession[];
}

export interface OmgMessagesResponse {
  messages: OmgMessage[];
  nextBefore?: number | null;
}

export interface OmgSendResponse {
  msg?: OmgQueueMessage;
}

export type OmgTranscriptEvent =
  | { type: "snapshot"; messages: OmgMessage[]; nextBefore: number | null }
  | { type: "message"; message: OmgMessage }
  | { type: "ai_part"; part: OmgAiStreamPart }
  /** The accumulated draft after each `ai_part`; see OmgDraft. */
  | { type: "draft"; draft: OmgDraft }
  | { type: "busy"; busy: boolean }
  | { type: "prompt"; prompt: OmgSessionPrompt | null }
  /** The session's send queue as it stands; replayed to a new listener. */
  | { type: "queue"; queue: OmgQueueMessage[] }
  /** The agent's to-do list and sub-agents; replayed to a new listener. */
  | { type: "plan"; plan: OmgSessionPlan | null }
  /** Who is typing now, as the complete set of participant ids. */
  | { type: "typing"; ids: string[] }
  | { type: "error"; error: string };

/** Runtime action: publish a local folder through omg Cloud / Infra. */
export interface OmgDeployStart {
  cwd: string;
  name?: string;
  wait?: boolean;
  generateIcon?: boolean;
}

export interface OmgDeployResult {
  slug: string;
  url: string;
  status: string;
  projectId: string;
  runId: string;
  dashboardUrl: string;
}

export * from "./session-mention-token.js";
export { blockedSessionAction } from "./session-blocked.js";

export type { OmgModelPrice, OmgModelPrices } from "./model-pricing.js";
export { MODEL_CREDIT_SAMPLE, MODEL_USAGE_GROUPS, modelCreditSampleMicros, modelUsageLevel } from "./model-pricing.js";
