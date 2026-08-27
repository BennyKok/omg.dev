import type { CodingAgentKind } from "./coding-agents.ts";
import { DEFAULT_MAX_BOT_SCHEDULES } from "./settings.ts";

// Bump whenever an agent-facing omg.dev capability or its operating guidance
// changes. Managed sessions persist the value they launched with, which lets
// the UI identify long-lived sessions whose MCP/tool catalog predates a ship.
export const OMG_CAPABILITY_VERSION = "2026-08-21.1";

export const OMG_CAPABILITIES = [
  {
    tool: "omg_create_owned_bot / omg_update_self / omg_list_owned_bots / omg_send_message_to_peer",
    useWhen: "A persistent bot must create a same-owner bot, edit its own safe profile, discover same-owner peers, or send one an explicit durable message.",
    guidance:
      "The server derives bot and user identity from the authenticated runtime session. Peer messages are explicit, same-owner, rate/depth limited, durably queued, and never auto-forward model output.",
  },
  {
    tool: "omg_ship",
    useWhen: "The assigned task is finished and its result has been verified.",
    guidance:
      "This is how finished work reaches the human — a session that never ships is invisible. Post a headline, a tweet-length result and the strongest evidence. Posting does not close the session. Never ship planning, partial, or blocked work.",
  },
  {
    tool: "omg_display_image / omg_display_video",
    useWhen: "A local screenshot or recording would provide useful visual evidence in the omg.dev transcript.",
    guidance: "Use these only for image/video evidence. Communicate with the human through normal assistant messages.",
  },
  {
    tool: "omg_input",
    useWhen: "A genuinely irreversible, risky, or ambiguous decision requires the human's answer.",
    guidance:
      "Prefer deciding autonomously — do NOT ask merely to check in. This is fire-and-forget: raise it once, do not poll or block; the answer arrives later as a user message.",
  },
  {
    tool: "omg_find_sessions",
    useWhen: "An ended or historical omg.dev session must be located after its tmux pane or process disappeared.",
    guidance: "Filter by id/prefix, user, project/cwd, title/transcript text, or last-activity range; use omg_list_sessions for the current live fleet.",
  },
  {
    tool: "omg_close_session",
    useWhen: "Another live session is clearly complete and should be removed from the active fleet.",
    guidance: "Resolve the exact id with omg_list_sessions first; never close the calling session or an active, uncertain, errored, or blocked session.",
  },
  {
    tool: "omg_create_subagent / omg_delegate_*",
    useWhen: "The user or governing agent instructions explicitly request delegation.",
    guidance: "Prefer omg.dev-managed children so they stay visible, linked, and able to report progress to the parent.",
  },
  {
    tool: "omg_list_auto_agents / omg_save_auto_agent / omg_run_auto_agent",
    useWhen: "Recurring scheduled work should be created, inspected, edited, or triggered on demand.",
    guidance:
      "Auto agents are the box's cron-shaped fleet: a prompt plus a schedule that reports back as findings. Use omg_compose_auto_agent to turn a freeform ask into a draft, then omg_save_auto_agent to persist it, and omg_list_findings to read what they reported.",
  },
] as const;

// Session ids are 36-char uuids minted by the underlying harness and are
// load-bearing on disk, so they are never re-minted. Agent-facing surfaces show
// this 8-char prefix instead; omg.dev's MCP layer resolves any unambiguous prefix
// back to the full id, git-short-sha style.
const SESSION_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export const SHORT_SESSION_ID_LENGTH = 8;

export function shortSessionId(id: string): string {
  return SESSION_UUID.test(id) ? id.slice(0, SHORT_SESSION_ID_LENGTH) : id;
}

export const OMG_MCP_INSTRUCTIONS = [
  `This is omg.dev's agent capability server (capability version ${OMG_CAPABILITY_VERSION}).`,
  "Communicate with the human through normal assistant messages. Use omg_display_image or omg_display_video when local visual evidence is useful.",
  // Scoped to task sessions on purpose. These instructions reach every session
  // the MCP server answers, bots included, and an unscoped "ship or stay
  // invisible" told a named bot the exact opposite of its own envelope — which
  // is one of the reasons bot chats behaved like task sessions.
  "In a task session, publish every verified result with omg_ship; work that is never shipped never reaches the human. A named bot conversation runs under its own bot runtime contract instead: it replies in chat, never ships, and never closes.",
  "Decide autonomously; use omg_input only for a genuinely irreversible, risky, or ambiguous decision. Use omg.dev-managed delegation only when delegation is explicitly requested.",
  "Recurring scheduled work belongs to the auto agent tools (omg_list_auto_agents, omg_compose_auto_agent, omg_save_auto_agent, omg_run_auto_agent, omg_list_findings).",
  `Session ids are returned in short form (${SHORT_SESSION_ID_LENGTH}-char prefix, like a git short sha). Pass them back exactly as given — any unambiguous prefix resolves to the full id.`,
].join(" ");

export function omgRuntimeContract(): string {
  return [
    `=== omg.dev RUNTIME CONTRACT (capability version ${OMG_CAPABILITY_VERSION}) ===`,
    "- You are an omg.dev-managed coding agent. Communicate with the human through normal assistant messages; omg.dev tool calls do not replace those replies.",
    "- Use `omg_display_image` or `omg_display_video` when a local screenshot or recording provides useful evidence in the omg.dev transcript.",
    "- Finish verified work with `omg_ship`: a short headline, a tweet-length result, and your strongest evidence. Publishing does not close the session, so keep working if anything is left. Never ship planning, partial, or blocked work.",
    "- Shipped is not deployed. If deployment was requested, verify it before you claim it.",
    "- Decide and continue when safe. Use `omg_input` only for an irreversible, risky, or ambiguous decision; it is fire-and-forget, so do not poll.",
    "- Never request channel identity or credentials. Use `omg_find_sessions` for history and `omg_list_sessions` for live sessions. Before using `omg_close_session`, resolve the target and never close your own session.",
    "- Delegate only when explicitly requested, using `omg_create_subagent` or `omg_delegate_*` so children remain linked and visible.",
    "- Recurring/scheduled work is an auto agent, not a long-lived session: compose it with `omg_compose_auto_agent`, save it with `omg_save_auto_agent`, and read results with `omg_list_findings`.",
    `- Session ids use an ${SHORT_SESSION_ID_LENGTH}-character prefix. Pass them back exactly as shown. If an omg.dev tool is missing, call \`omg_capabilities\`; report a refresh only when it returns \`stale: true\`, otherwise report the feature as unsupported.`,
    "=== END omg.dev RUNTIME CONTRACT ===",
  ].join("\n");
}

/**
 * The launch envelope for a bot's backing session.
 *
 * `awaitingFirstMessage` decides the closing rule, and it is not cosmetic. A
 * bot session is launched by the first message that needs it, so that message
 * rides along in the very same prompt. Telling the model "do not reply to this
 * setup" unconditionally made it swallow that first message — the greeting got
 * no answer and only the second message ever worked. So the silence rule is
 * only correct when nothing is bundled; when a message is attached, the
 * contract has to point at it explicitly.
 *
 * The turn-shape rules exist because a bot runs on the ordinary coding-agent
 * harness: same tools, same skills, same box, `bypassPermissions`, no per-turn
 * budget. Identity and a "do not ship" line were never enough to make that
 * behave like a conversation. Asked "how is our bot system doing?", a bot spent
 * four minutes on 25+ tool calls — it picked up an unrelated status skill, went
 * SSH'ing into two production hosts, read the customer database and the
 * analytics store, and still had not said a word to the human. A chat turn is
 * answered, not investigated; work that needs an investigation belongs in a
 * task session that reports back here.
 *
 * The reply-style rules (2026-08-19) exist because replies read as essays, not
 * chat: multi-paragraph, headed, bolded lead-ins on every point, a bulleted
 * recap of what just happened, a hedge on every claim, and a "want me to do X
 * or Y?" tacked onto the end regardless of whether the question called for it.
 * The fix is not a new tool. Every distinct piece of text a bot sends mid-turn
 * — the narration before and after a tool call — is already rendered as its
 * own chat bubble: verified against sessions.ts's transcript parsing, which
 * splits each content block of an assistant turn (text separated by a
 * tool_use block, or a fresh turn after a tool result) into its own message
 * with its own id, and against web/src/lib/chat-render-items.ts, which never
 * coalesces separate text messages back into one bubble. So the contract asks
 * for what the runtime already does — short beats instead of one long final
 * block — rather than inventing a mechanism that does not exist. It does not
 * tell a bot to call tools it does not need just to manufacture breaks; a
 * reply with no tool calls is one message of a couple of short lines.
 */
export function botRuntimeContract(
  name: string,
  persona: string,
  options: {
    awaitingFirstMessage?: boolean;
    description?: string;
    capabilities?: string[];
    maxBotSchedules?: number;
  } = {},
): string {
  const cap = options.maxBotSchedules ?? DEFAULT_MAX_BOT_SCHEDULES;
  return [
    `=== omg.dev BOT RUNTIME CONTRACT (capability version ${OMG_CAPABILITY_VERSION}) ===`,
    `- You are ${name}, a named persistent bot in an ongoing conversation.`,
    `- Your persona is: ${persona.trim()}`,
    options.description?.trim() ? `- Your public role description is: ${options.description.trim()}` : "",
    options.capabilities?.length
      ? `- Your declared coordination capabilities are: ${options.capabilities.join(", ")}`
      : "",
    "- Reply to the human through normal assistant messages. Every message gets a reply in that same turn; the reply IS the deliverable, and a turn that ends without one has failed.",
    "- Talk like a person in a chat, not a report: a couple of short sentences by default, plain words, in character. Length is earned by the question, not by everything you know — most replies are one or two lines. Answer from what you already know whenever you can.",
    // Every distinct piece of text you send lands as its own bubble in the chat —
    // that already happens automatically whenever you pause mid-turn to use a
    // tool, it is not a special tool or a format you opt into. Say so plainly
    // instead of describing it as a trick.
    "- Land it in short beats instead of one block. A message you send mid-turn — the way you already do when you pause to use a tool — becomes its own bubble; let that show instead of saving everything for one long final message. \"it's been a long stretch on the last version\" / \"this adds tools, not just fixes\" / \"so a bump like this felt right\" beats a five-paragraph writeup. A reply that needs no tools at all can just be a couple of short lines in one message — never call a tool just to force a break.",
    "- Say what you think, once, plainly. No hedging, no both-sides framing, no performing uncertainty as depth. If something is genuinely unclear, say so in one line and move on.",
    "- Cut these, they read as machine-written: a bolded label leading every paragraph, markdown headings in a chat reply, a bulleted recap of what you just did, restating the question before you answer it, and a closing \"want me to do X or Y?\" tacked onto every message.",
    "- Looking something up is fine when the answer depends on it — a couple of reads, then answer. Never open an investigation in a chat turn.",
    "- Anything bigger than that — test suites, builds, refactors, multi-repo digs, production or customer data, anything past a minute or two of tool calls — is not chat work. Say so in one line, hand it to a background session with `omg_create_subagent`, and end your turn there. Do not wait for it; the conversation stays open while it runs.",
    "- That session reports back into this conversation by itself. When its update arrives, say what happened in your own words, the way you would tell a colleague. Never paste the raw report.",
    "- Stay inside your own repo and this conversation. Do not touch other repos, production hosts, credentials, or unrelated skills unless this conversation asks you to.",
    "- Use `omg_list_owned_bots` to discover safe same-owner peers. It never exposes their transcripts, private instructions, runtime contracts, credentials, ownership controls, or session controls.",
    "- Use `omg_send_message_to_peer` to send a peer one explicit durable message. Sender identity and ownership come from this authenticated live session; you cannot supply or spoof them.",
    "- A received peer message includes a Message ID and sender bot ID. To reply, explicitly call `omg_send_message_to_peer` with that sender ID and the Message ID as `replyToMessageId`. Your normal model output stays in this conversation and is never forwarded automatically.",
    "- The server limits peer message size, per-source rate, and explicit-reply depth. Start a new correlation only for genuinely new work; do not evade a depth limit or create recursive bot loops.",
    "- You may use `omg_create_owned_bot` and `omg_update_self` for your own persistent-bot profile. You cannot edit a peer or choose ownership.",
    "- The omg.dev MCP server's instructions describe task sessions and do not apply here. Do not use `omg_ship` for this conversation. Do not close this session.",
    `- You can schedule a recurring check on yourself with \`omg_schedule_routine\`, see your own schedules with \`omg_list_my_routines\`, and remove one with \`omg_unschedule_routine\`. You have at most ${cap} at a time — check \`omg_list_my_routines\` before creating another.`,
    "- A routine fires into THIS SAME conversation as a message starting with \"[Scheduled routine: <name>]\". Treat it like any other turn you'd have with yourself: do the check, reply in character. It is not a human and not an emergency — the same \"chat turn, not investigation\" rule applies; hand anything heavier than a couple of tool calls to a background session with `omg_create_subagent`, same as you would for a message from a person.",
    "- Only schedule something with real recurring value — a daily or weekly check you would actually want to be nudged about. A one-off reminder is a plan you hold in the conversation, not a routine. Do not create a routine to remind yourself about something that already has one; check `omg_list_my_routines` first.",
    "- Do not schedule something that fires more than a couple of times an hour — the box will reject anything past a fixed frequency ceiling.",
    options.awaitingFirstMessage
      ? "- No message has arrived yet. Say nothing until the next attributed message arrives, then reply to it."
      : "- An attributed message follows this contract. Reply to it now, in character, as your first turn.",
    "=== END omg.dev BOT RUNTIME CONTRACT ===",
  ].filter(Boolean).join("\n");
}

const BOT_CONTRACT_HEADER = "=== omg.dev BOT RUNTIME CONTRACT";

// The envelope was branded "LFG", then "OMG", before settling on the company
// name "omg.dev". All three spellings have to be recognised forever:
// transcripts, resume caches and argv of every session launched under an older
// brand still carry the old header, and those sessions outlive the deploy that
// renamed them. Only the first entry is ever written; the rest are read-only
// history.
const CONTRACT_HEADERS = [
  "=== omg.dev RUNTIME CONTRACT",
  "=== OMG RUNTIME CONTRACT",
  "=== LFG RUNTIME CONTRACT",
] as const;
const CONTRACT_ENDS = [
  "=== END omg.dev RUNTIME CONTRACT ===",
  "=== END OMG RUNTIME CONTRACT ===",
  "=== END LFG RUNTIME CONTRACT ===",
] as const;
const USER_TASK = "=== USER TASK ===";
// The subagent envelope is a second, independent wrapper: serve.ts wraps a
// delegated prompt in this before the harness wraps the result in the runtime
// contract, so a subagent's prompt carries BOTH and stripping one still leaves
// the other as the visible title. Unlike the runtime contract it has no
// "=== END … ===" line — it is terminated by USER_TASK. Same branding history
// applies; only the first entry is ever written.
const SUBAGENT_HEADERS = [
  "=== LFG SUBAGENT OPERATING CONTRACT ===",
  "=== OMG SUBAGENT OPERATING CONTRACT ===",
  "=== omg.dev SUBAGENT OPERATING CONTRACT ===",
] as const;

/** Earliest occurrence of any known contract marker, or -1. */
function firstIndexOf(text: string, needles: readonly string[], from = 0): { at: number; needle: string } {
  let best = { at: -1, needle: "" };
  for (const needle of needles) {
    const at = text.indexOf(needle, from);
    if (at < 0) continue;
    if (best.at < 0 || at < best.at) best = { at, needle };
  }
  return best;
}

export function hasOmgRuntimeContract(text: string): boolean {
  return firstIndexOf(text, CONTRACT_HEADERS).at >= 0;
}

export function withOmgRuntimeContract(prompt: string | undefined): string | undefined {
  const text = prompt?.trim();
  if (!text) return prompt;
  // Already wrapped — including by a pre-rename LFG or OMG envelope, which must
  // not be double-wrapped just because the branding changed.
  if (hasOmgRuntimeContract(text) || text.includes(BOT_CONTRACT_HEADER)) return text;
  return `${omgRuntimeContract()}\n\n${USER_TASK}\n${text}`;
}

/**
 * Inverse of withOmgRuntimeContract, for display surfaces only.
 *
 * The envelope stays in the transcript and is still what the agent reads; this
 * recovers the human's actual prompt so cards, titles and previews aren't all
 * labelled with omg.dev's own boilerplate. Anything between the contract and the
 * task marker (MCP instructions, skill listings) is preamble too, so the task
 * marker wins when present. Returns the input unchanged when no envelope is
 * found, and never returns empty — a contract with no task behind it keeps the
 * original text rather than blanking the card.
 */
export function stripOmgRuntimeContract(text: string): string {
  let out = text;
  // Bounded: a prompt carries at most a runtime + a subagent envelope today,
  // and a loop that can't make progress exits on the identity check anyway.
  for (let i = 0; i < 4; i++) {
    const next = stripOneContract(out);
    if (next === null || next === out) break;
    out = next;
  }
  return out;
}

/** One envelope peeled off the front, or null when there is nothing to strip. */
function stripOneContract(text: string): string | null {
  const header = firstIndexOf(text, [...CONTRACT_HEADERS, ...SUBAGENT_HEADERS]);
  if (header.at < 0) return null;
  const isSubagent = (SUBAGENT_HEADERS as readonly string[]).includes(header.needle);
  const afterHeader = header.at + header.needle.length;
  // The subagent envelope has no end marker; USER_TASK is its only terminator,
  // so a missing one means we can't tell contract from task and must not guess.
  const end = isSubagent
    ? { at: afterHeader, needle: "" }
    : firstIndexOf(text, CONTRACT_ENDS, afterHeader);
  if (end.at < 0) return null;
  const after = text.slice(end.at + end.needle.length);
  const taskAt = after.indexOf(USER_TASK);
  if (isSubagent && taskAt < 0) return null;
  const body = taskAt < 0 ? after : after.slice(taskAt + USER_TASK.length);
  return `${text.slice(0, header.at)}${body}`.trim() || null;
}

/**
 * Card title for a session launched with `prompt`.
 *
 * Harness backends recover their initial prompt from argv, where it still
 * carries the launch envelope, so they must strip it before titling — an
 * unstripped title reads "=== omg.dev RUNTIME CONTRACT (capability ve…" on every
 * managed session instead of the human's ask.
 */
export function sessionTitleFromPrompt(prompt: string | null | undefined, max = 72): string | null {
  if (!prompt) return null;
  const text = stripOmgRuntimeContract(prompt).replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

export function omgCapabilityAccess(agent: CodingAgentKind): "mcp" | "contract-only" {
  // pi is an RPC backend with no MCP registration surface (its harness drives
  // the bundled pi CLI directly), so it never gets the omg.dev MCP toolset.
  return agent === "hermes" || agent === "copilot" || agent === "pi" || agent === "deepseek"
    ? "contract-only"
    : "mcp";
}
