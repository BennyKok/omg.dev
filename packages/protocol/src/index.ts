export type OmgSessionStatus =
  | "ok"
  | "blocked";

export type OmgSessionStatusReason =
  | "model_unavailable"
  | "out_of_credits"
  | "provider_auth"
  | "provider_error"
  | null;

export interface OmgSession {
  agent?: string;
  agentLabel?: string | null;
  pid?: number;
  cmd?: string;
  cwd?: string;
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
}

export interface OmgSessionPrompt {
  question?: string;
  options: OmgPromptOption[];
}

export interface OmgQueueMessage {
  id: string;
  text: string;
  status: "pending" | "sending" | "queued" | "failed" | "delivered";
  error?: string;
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

export type OmgLiveMessage =
  | { t: "batch"; sid: string; messages?: OmgMessage[]; nextBefore?: number | null }
  | { t: "msg"; sid: string; message?: OmgMessage; m?: OmgMessage }
  | { t: "ai_part"; sid: string; part?: OmgAiStreamPart }
  | { t: "queue"; sid: string; queue?: OmgQueueMessage[] }
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
  | { type: "busy"; busy: boolean }
  | { type: "prompt"; prompt: OmgSessionPrompt | null }
  | { type: "error"; error: string };
