# Coding agent architecture

LFG exposes a stable product name and selects one internal driver for it.
New Claude, Codex, OpenCode, JCode, and Copilot sessions use their SDK drivers.
Grok, Cursor, and fx use their native ACP servers through the official ACP SDK.
The old native CLI drivers remain readable for live and historical compatibility.
They do not receive new sessions.

## Provider matrix

| Product | New-session key | Driver | Control transport | Recovery | Scheduled runs | Tool access | Current status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Claude | `aisdk` | Anthropic Agent SDK | Command file | Durable | Yes | MCP | Preferred. The `claude` request alias resolves here. |
| Codex | `codex-aisdk` | OpenAI Codex SDK | Command file | Durable | Yes | MCP | Preferred. The `codex` request alias resolves here. |
| OpenCode | `opencode` | OpenCode SDK | Command file | Durable | Yes | MCP | Active. |
| Pi | `pi` | Pi RPC SDK | Command file | Durable | No | Runtime contract | Active. |
| Grok | `grok` | Native ACP through `@agentclientprotocol/sdk` | Command file | Durable | Yes | MCP | Preferred. Reuses the Grok CLI login. |
| Cursor | `cursor` | Native ACP through `@agentclientprotocol/sdk` | Command file | Durable | Yes | MCP | Preferred. Reuses the Cursor CLI login. |
| fx | `fx` | Native ACP through `@agentclientprotocol/sdk` | Command file | Durable | Yes | MCP | Preferred. Reuses the fx Vercel AI Gateway credential. |
| JCode | `jcode` | `@1jehuang/jcode-sdk` | Command file | Durable | No | MCP | Preferred. Uses a private persistent SDK instance. |
| Copilot | `copilot` | `@github/copilot-sdk` | Command file | Durable | No | MCP | Preferred. The SDK bundles its JSON-RPC runtime. |
| Claude CLI | None | Native TUI | tmux | Durable | No | MCP | Deprecated. The `claude` alias now resolves to `aisdk`. |
| Codex CLI | None | Native TUI | tmux | Durable | No | MCP | Deprecated. The `codex` alias now resolves to `codex-aisdk`. |
| Hermes | None | None | None | Historical display only | No | None | Removed. Old records remain readable. |

`src/coding-agent-provider.ts` is the launch boundary.
It owns provider-specific spawn arguments and defaults.
`src/coding-agent-adapters.ts` owns identity, driver, transport, recovery, and capability metadata.
`src/agents/backends/managed-sdk-session.ts` owns the shared queue, prompt, transcript, interrupt, and recovery lifecycle.

## Claude prompt-cache maintenance

The Claude SDK harness owns the idle-cache timer in
`src/agents/backends/claude-cache-idle.ts`. It uses the SDK `requesting` status
and per-response cache-write TTL counters. The deadline is an estimate, not
a server expiry notification. Unknown TTLs do not arm a timer. Mixed TTLs use
the shorter lifetime. A resumed harness waits for a new request with a known
TTL instead of restoring a possibly stale deadline.

The harness adds a visible transcript warning after 50 minutes for a one-hour
cache, or four minutes for a five-minute cache. For a one-hour cache with at
least 200,000 input tokens, it sends `/compact` at 54 minutes if Claude reports
automatic compaction enabled. The SDK owns the summary and its persistence.
The harness confirms completion only on `compact_boundary`.

Maintenance waits while the session is busy, has a question open, or has live
background tasks. It does not run after expiry. A compaction attempt cannot
arm another attempt until the user sends a new task. Failures produce a notice
instead of an automatic retry. Interrupts, runtime replacement, and changes
to effort or fast mode invalidate the timer.

`OMG_CLAUDE_IDLE_COMPACTION=0` disables host idle compaction but keeps warnings.
The harness sets Claude's native `idleCompaction` to false for its subprocess,
so the host is the only idle-timer owner. This does not disable Claude's
normal context-limit compaction or change settings files. The terminal's
`idleCompaction` switch does not control the host timer.

Anthropic documents terminal idle compaction in the
[Claude Code 2.1.299 changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md#21299).
The SDK does not expose a dedicated cache-expiry event in version 0.3.206.

## Queue durability

LFG stores outbound queue rows in `data/lfg.sqlite`.
The `send_queue_messages` table stores text, status, attempts, timestamps, and ordering state.
The UI hydrates these rows after navigation and after an LFG server restart.
The server resumes safe `pending` sends during startup.
It marks an interrupted `sending` row as failed to prevent a duplicate user turn.
SDK and ACP command-file rows stay `queued` until transcript reconciliation confirms delivery.

fx (Vercel Labs) publishes no TypeScript SDK for its agent core.
`fx acp` is its only structured surface, so ACP is both the supported route and
the cheapest one.

fx bills differently from every other provider here.
Its only credentials are `VERCEL_OIDC_TOKEN`, `AI_GATEWAY_API_KEY`, `fx login`
and a stored key, and all four resolve to Vercel AI Gateway.
Running `anthropic/claude-opus-5` under fx therefore spends AI Gateway credit.
It does not use a Claude Pro/Max, ChatGPT Plus/Pro, or Cursor subscription, and
fx implements no OAuth flow other than Vercel's.
Attach provider API keys to the Gateway account (Vercel BYOK) to bill them
instead; consumer subscriptions have no API surface the Gateway can consume.

Its MCP capability is HTTP and SSE, never stdio.
That is the shape `omgAcpMcpServers` already emits, so the omg.dev MCP server is
handed to fx inside `session/new` and needs no entry in `~/.fx/mcp.json`.
fx treats an MCP server it cannot reach as a fatal error and fails `session/new`
with `Required MCP server 'omg' failed to start`.
The URL points at the same LFG process that spawns the session, so it is up
whenever a launch happens.
fx opens every ACP session in its `ask` mode, which requests permission before
each change.
LFG selects the `code` mode right after the session opens, because `fx acp`
takes no launch flag equivalent to Grok's `--always-approve` or Cursor's
`--trust`.
Any permission request fx still raises reaches the shared prompt UI.
For fewer prompts, set `permission_mode` in `~/.fx/settings.json`.

Cursor also provides `@cursor/sdk`.
That SDK requires a Cursor API key and uses separate SDK billing.
LFG uses Cursor ACP by default because ACP can reuse the existing CLI login.
The ACP adapter maps Cursor permission, question, and plan requests to the shared prompt UI.

## Shared contract

Every active provider declares these fields:

- Stable product identity.
- Internal driver type.
- Control transport.
- Recovery level.
- Interrupt behavior.
- Question support.
- Model and thinking change behavior.
- Scheduled-run support.
- Tool-access mode.
- One normalized launch method.

Provider keys are storage compatibility values.
They are not product names.
Public surfaces should show `claude`, `codex`, and the other product names.

## Workspace contract

New sessions use `resolveSessionCwd` for every provider.
Git repositories get one session worktree under `LFG_WORKTREE_ROOT` by default.
The default root is `~/lfg-worktrees`.
Each worktree uses the branch `session_<tmuxName>`.

A cold resume currently reuses the stored directory when it exists.
If that directory was removed, `resolveResumeCwd` can fall back to the project checkout.
This fallback is the remaining workspace inconsistency.
The next migration must persist a workspace identity and create a replacement worktree before resume.

Worktree cleanup is asynchronous.
It removes only LFG-owned worktrees.
It keeps worktrees with uncommitted changes, live processes, or recent activity.

## Migration rules

1. Accept `claude` and `codex` as API aliases during the compatibility period.
2. Store new Claude sessions as `aisdk` and new Codex sessions as `codex-aisdk`.
3. Reject Hermes for new sessions, subagents, MCP delegation, and scheduled execution.
4. Keep historical readers for old CLI and Hermes records.
5. Add new providers through `CodingAgentProvider` before adding route branches.
6. Prefer SDK or RPC drivers. Use a terminal driver only when no usable SDK exists.
