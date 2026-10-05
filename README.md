<a href="https://omg.dev">
  <img src="https://raw.githubusercontent.com/BennyKok/omg.dev/main/docs/images/omg-icon.png" alt="omg.dev icon" width="96" />
</a>

# omg.dev

**Not 10 interfaces. One portal for all your agents.**

Open-source parallel coding agent harness. Run agents on your computer.
Control them from one UI. Install it yourself for free, or pay us to host it.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/BennyKok/omg.dev?label=release)](https://github.com/BennyKok/omg.dev/releases)
[![Download macOS desktop preview](https://img.shields.io/badge/Download-macOS%20desktop%20preview-000000?logo=apple&logoColor=white)](https://github.com/BennyKok/omg.dev/releases/download/desktop-preview/macos-arm64-omg.dev.dmg)
[![App Store](https://img.shields.io/badge/App%20Store-omg.dev-0D96F6?logo=apple&logoColor=white)](https://apps.apple.com/us/app/omg-dev/id6800792515)
[![Discord](https://img.shields.io/badge/Discord-join%20the%20community-5865F2?logo=discord&logoColor=white)](https://omg.dev/discord)

<p align="center">
  <img src="./docs/images/omg-chat.webp" alt="omg.dev showing a list of coding-agent sessions and an active agent transcript" width="70%" />
  &nbsp;
  <img src="./docs/images/ios/home.webp" alt="omg.dev iOS app home screen: agent sessions across several repositories" width="22%" />
</p>

## Free or hosted

|                | Self-host                    | Hosted on omg.dev                                    |
| -------------- | ---------------------------- | ---------------------------------------------------- |
| **Price**      | Free (MIT)                   | Free plan to try. Paid plans from $19/mo.            |
| **Runs on**    | Your Mac or Linux machine    | A cloud computer we run for you                      |
| **You manage** | Install and updates          | Nothing                                              |
| **Start**      | [Install below](#install-on-your-computer) | [app.omg.dev](https://app.omg.dev/) · [Pricing](https://omg.dev/pricing) |

Both use the agent subscription you already pay for, such as Claude or ChatGPT.

## Install on your computer

```bash
bun install --global @omg-dev/cli && omg computer setup
```

Open [http://localhost:8766](http://localhost:8766).

Debian, Ubuntu, or macOS. No omg.dev account. On Linux, a normal user with
`sudo`. Do not run as `root`.

Open **Settings → Coding agents**. Supports Claude Code, Codex, Grok, Cursor,
omg agent, OpenCode, fx, Muse, DeepSeek, Devin, Jcode, Copilot, and Pi. Sign in
with the agent provider.

### Try the macOS desktop preview

Apple Silicon. Ships with its own runtime. No separate CLI install.

[**Download omg.dev for macOS →**](https://github.com/BennyKok/omg.dev/releases/download/desktop-preview/macos-arm64-omg.dev.dmg)

Unsigned preview. Control-click the app, choose **Open**, then **Open** again.
Or **System Settings → Privacy & Security → Open Anyway**.

## Use the hosted version

No local server. Runs in the cloud, opens in the browser. This is a paid
service with a free plan. See [pricing](https://omg.dev/pricing).

[**Start with a hosted Computer →**](https://app.omg.dev/)

iPhone: [omg.dev on the App Store](https://apps.apple.com/us/app/omg-dev/id6800792515)

## Built for every role

PMs, engineers, growth, and sales share the same sessions.

<table>
  <tr>
    <td width="50%">
      <img src="./docs/images/personas/pm-1600.webp" alt="omg.dev Board: Needs you, Working, Idle and Shipped columns of agent sessions" />
      <p><strong>PM.</strong> Needs you, Working, Idle, Shipped.</p>
    </td>
    <td width="50%">
      <img src="./docs/images/personas/engineer-1600.webp" alt="omg.dev session with the diff view open, showing a patch file by file" />
      <p><strong>Engineer.</strong> Worktree diff, then merge.</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="./docs/images/personas/growth-1600.webp" alt="omg.dev chat where an agent answers with an interactive funnel chart from the database" />
      <p><strong>Growth.</strong> Ask in chat. Chart from your database.</p>
    </td>
    <td width="50%">
      <img src="./docs/images/personas/sales-1600.webp" alt="omg.dev chat turning call recordings into objections, risk per deal and follow-ups" />
      <p><strong>Sales.</strong> Calls to objections, risk, follow-ups.</p>
    </td>
  </tr>
</table>

<p align="center">
  <img src="./docs/images/ios/home.webp" alt="omg.dev iOS: every task on one board" width="30%" />
  <img src="./docs/images/ios/live-activity.webp" alt="omg.dev iOS Live Activity: agent sessions that need you, are working, or are done" width="30%" />
  <img src="./docs/images/ios/widget.webp" alt="omg.dev iOS home-screen widget with a needs-you summary" width="30%" />
</p>

## What you get

- Several coding-agent sessions in parallel.
- Transcripts and follow-ups in the web UI.
- Chat, Bots, Schedules, and Notifications in one place.
- Managed sessions keep running when the UI disconnects.
- Your existing agent subscriptions or API keys.

## Remote access and security

The local server binds to `127.0.0.1` and has no built-in authentication. Do
not expose it to the public internet.

Phone access through Tailscale:

```bash
OMG_TAILSCALE_SERVE=1 omg computer setup
```

Sign in to Tailscale if setup asks. See [remote access](./docs/remote-access.md)
and [SECURITY.md](./SECURITY.md) before you share access.

## Manage a local install

```bash
omg computer status    # check the install
omg computer update    # install the latest release
omg doctor             # create a sanitized diagnostic report
omg computer uninstall # remove omg.dev and keep sessions and config
```

## Develop from source

```bash
git clone https://github.com/BennyKok/omg.dev.git
cd omg.dev
bun install
cp .env.example .env
bun run serve
```

API is at [http://localhost:8766](http://localhost:8766). For the UI, run
`cd web && bun run dev` in another terminal. `bun run serve` alone needs a
built `web/dist`.

Desktop shell: [desktop development](./desktop/README.md).

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before a pull request. Help:
[Discord](https://omg.dev/discord).

## License

[MIT](./LICENSE)
