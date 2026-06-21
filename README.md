# lfg

Run and manage your AI coding agents on your own VPS.

**Website:** [lfg.apps.omg.dev](https://lfg.apps.omg.dev)

`lfg` turns a plain Linux box or macOS workstation into a control plane for
**Claude Code** and **Codex** agents. It spawns each agent in a long-lived
`tmux` session, gives you an installable web UI to start, watch, steer, and
answer them from any device, and reaches your box privately over **Tailscale** —
no public ports, no SaaS in the middle. A pluggable agent engine can also run
scheduled "insight" agents (code review, model watch, …) that produce reports
with actionable follow-ups.

- **Your agents, your machine.** Subscription `claude` OAuth or an API key — the
  box runs the agents, you keep the data.
- **Drive from anywhere.** A PWA you can install on your phone; start a session,
  watch it stream, answer its permission/plan prompts, switch models mid-run.
- **Private by default.** Binds to loopback and is served over your tailnet via
  `tailscale serve`. The local API is unauthenticated *by design* — never expose
  it publicly.

> Heads up: lfg spawns AI agents with shell access on your box. Read
> [SECURITY.md](./SECURITY.md) before exposing it to anyone.

## Requirements

The release bundle ships source + the prebuilt web UI. Public JS deps are
installed on the target machine so native/optional packages match that OS. lfg
does **not** vendor agent runtimes; it drives whatever it finds on `PATH`. The
target box needs:

| | Requirement | Notes |
| --- | --- | --- |
| **Required** | [Bun](https://bun.sh) | the runtime (`bun run serve`); no Node fallback |
| | `tmux` | every session/harness runs in a tmux pane |
| | `git` | repo scanning + git collectors |
| | `claude` on `PATH` | default agent; + `claude` OAuth or `ANTHROPIC_API_KEY` |
| **Optional** | `codex` on `PATH` | `codex` / `codex-aisdk` agents (`LFG_CODEX_PATH` to override) |
| | `opencode` on `PATH` | `opencode` agent + `opencode auth login` (`LFG_OPENCODE_PATH`) |
| | Tailscale | private tailnet ingress; not needed to run on loopback |

`setup.sh` verifies these requirements and does not install or upgrade agent
CLIs by default, because those tools own user auth/config. On Linux it installs
base system packages and Bun by default for fresh VPS use; on macOS it only
reports missing system requirements unless you explicitly opt in.

## One-command setup

On a fresh Ubuntu/Debian VPS or macOS workstation, as a normal user (not root):

```bash
curl -fsSL https://raw.githubusercontent.com/BennyKok/lfg/main/scripts/setup.sh | bash
```

or supply your [Tailscale auth key](https://login.tailscale.com/admin/settings/keys)
up front for a fully non-interactive run:

```bash
TS_AUTHKEY=tskey-auth-xxxx \
  curl -fsSL https://raw.githubusercontent.com/BennyKok/lfg/main/scripts/setup.sh | bash
```

The script is idempotent and does, in order: checks/installable system
requirements; downloads the latest **prebuilt release bundle**; installs
production dependencies on the target machine; joins your tailnet when Tailscale
is available; writes a `.env`; and runs the web UI as a background user service
(**systemd** on Linux, **launchd** on macOS). When Tailscale is connected, setup
also configures `tailscale serve` (HTTPS on your MagicDNS name, tailnet-only).
When it finishes it prints the URL and any missing agent CLI warnings.

> Pin a version with `LFG_RELEASE=v0.1.0`, or build from source instead with
> `LFG_INSTALL_MODE=source` (git clone + `bun install`).
>
> Opt-in installers are available when you explicitly want setup to mutate the
> machine: `LFG_INSTALL_SYSTEM_DEPS=1`, `LFG_INSTALL_BUN=1`,
> `LFG_INSTALL_CLAUDE=1`, `LFG_INSTALL_CODEX=1`, `LFG_INSTALL_OPENCODE=1`, and
> `LFG_UPDATE_SHELL_RC=1`.
>
> Forking? Point setup at your own repo with `LFG_REPO_SLUG=you/lfg` (release
> tarballs) and `LFG_REPO_URL=…` (source mode). Re-run setup any time with
> `lfg setup` — it re-pulls the latest release (or `git pull`s a dev checkout).

## Manual / local install

Requires [Bun](https://bun.sh), `tmux`, `git`, and the
[Claude CLI](https://docs.claude.com/en/docs/claude-code) (and optionally Codex)
on `PATH`.

Easiest — grab the prebuilt bundle, then install production deps:

```bash
mkdir -p ~/lfg && curl -fSL \
  https://github.com/BennyKok/lfg/releases/latest/download/lfg-bundle.tar.gz \
  | tar -xz --strip-components=1 -C ~/lfg
cd ~/lfg && cp .env.example .env   # edit as needed
rm -rf node_modules && bun install --production
bun run serve                      # → http://127.0.0.1:8766
```

> The bundle is slim because it does **not** vendor public `node_modules` or agent runtimes —
> lfg drives whatever `claude` / `codex` / `opencode` it finds on `PATH` (override
> via `LFG_CLAUDE_PATH` / `LFG_CODEX_PATH` / `LFG_OPENCODE_PATH`). Install the
> agent CLIs you intend to use yourself (`claude` is the default agent), or opt in
> to the setup-managed installers listed above. Unpublished/private packages can
> be bundled as `vendor/*.tgz`; public packages are installed from the registry.

From source:

```bash
git clone https://github.com/BennyKok/lfg.git && cd lfg
bun install
cp .env.example .env      # edit as needed
bun run serve             # → http://127.0.0.1:8766
```

Then authenticate Claude once (`claude`, complete the browser OAuth) or set
`ANTHROPIC_API_KEY` in `.env`.

## How it works

- **Sessions (`src/sessions.ts`, `tmux.ts`, `managed.ts`).** Each agent runs in
  a detached `tmux` session lfg owns end-to-end, so it can resolve the real
  session id, tail the transcript, inject input, answer prompts, and tear it down
  cleanly. You can still `tmux attach` to any of them.
- **Web UI (`src/commands/serve.ts`, `web/`).** A Vite/React PWA served by lfg's
  Bun server. Lists live sessions, streams each transcript over SSE, surfaces
  permission/plan prompts as tappable actions, and lets you launch new sessions
  with a model picker. The built UI ships prebuilt in `web/dist`.
- **Agents engine (`src/agents/`).** Markdown agents with YAML frontmatter
  declare *inputs* (collectors: `git_log`, `repo_files`, `github_issues`,
  `github_prs`, `openrouter_models`, `security_scan`) and a prompt. Running one
  collects the inputs and asks Claude to produce a report plus action blocks. See
  the examples in [`agents/`](./agents) and `lfg agents --help`.

## Commands

```
lfg serve                     Run the web UI + control server (default :8766)
lfg agents [list|run|show]    Run / inspect insight agents
lfg whatsapp [run|sessions]   Optional WhatsApp control sidecar
lfg setup                     (Re)provision this box
```

## Configuration

All config is environment-driven (`.env`, see [`.env.example`](./.env.example)):

| Variable | Default | Purpose |
| --- | --- | --- |
| `LFG_HOST` | `127.0.0.1` | Bind address. Keep loopback; `tailscale serve` fronts it. |
| `LFG_PORT` | `8766` | Web UI / API port. |
| `LFG_REPOS_ROOT` | `~/repos` | Directory scanned for git repos to launch agents into. |
| `LFG_REPO` | cwd | Default project repo for collectors/actions. |
| `LFG_USERS` | — | Comma-separated emails for per-user session tagging. |
| `LFG_CLAUDE_BACKEND` | `cli` | `cli` or `ai-sdk` report backend. |
| `LFG_CLAUDE_MODEL` | `opus` | Model for the `ai-sdk` backend. |
| `ANTHROPIC_API_KEY` | — | Optional, instead of `claude` OAuth. |
| `TTS_UPSTREAM` / `TTS_TOKEN` | — | Optional self-hosted voice (TTS/STT) proxy. |
| `STT_UPSTREAM` / `STT_TOKEN` | — | Optional separate STT host (e.g. Parakeet); falls back to `TTS_*`. |
| `LFG_WHATSAPP_*` | — | Optional WhatsApp sidecar (see `.env.example`). |
| `TS_AUTHKEY` | — | Setup-time only; never written to disk. |

## Optional: WhatsApp control

`lfg whatsapp` bridges a WhatsApp group to agent sessions via
[Baileys](https://github.com/WhiskeySockets/Baileys): pair a dedicated number
with the printed QR, add it to a group, and messages route to a Claude/Codex
session. It pulls in a heavier dependency, so it's off unless you configure
`LFG_WHATSAPP_*`.

## Updating

```bash
lfg setup                                   # re-pulls the latest release + restarts
lfg setup   # (in a git checkout) does git pull + bun install instead
# or, for a Linux dev checkout, manually:
git pull && bun install && systemctl --user restart lfg
# macOS dev checkout:
git pull && bun install && launchctl kickstart -k gui/$(id -u)/dev.omg.lfg
```

Releases are built **locally** with [`scripts/release.sh`](scripts/release.sh).
If you depend on unpublished/private packages, set `LFG_VENDOR_PACKAGES` to pack
those installed packages into `vendor/*.tgz` and rewrite the release manifest to
install them from the bundle:

```bash
LFG_VENDOR_PACKAGES="your-private-package @scope/private-provider" scripts/release.sh v0.1.0
scripts/release.sh            # build dist/lfg-bundle.tar.gz only
```

The [`release` workflow](.github/workflows/release.yml) is the CI equivalent,
usable only once the runner can reach that registry (e.g. via a Tailscale or
self-hosted runner + `NPM_REGISTRY`/`NPM_TOKEN` secrets).

## Security

The control API is unauthenticated and the agents have real shell access. lfg is
built to live behind Tailscale, not on the open internet. Please read
[SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)
