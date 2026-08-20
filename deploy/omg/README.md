# OMG

omg.dev is the one-click hosted workspace path for the local agent control plane.

[![Deploy on omg](https://omg.dev/deploy-badge.svg?v=2)](https://omg.dev/sandbox/templates/omg)

## Flow

1. Open `https://omg.dev/sandbox/templates/omg`.
2. Sign in to OMG if prompted.
3. OMG creates a sandbox from the prebuilt `templateId: "omg"` template on port
   `8766`. The older `templateId: "lfg"` route is a compatibility alias for the
   same product.
4. The control plane starts `omg serve --host 0.0.0.0 --port 8766`.
   `lfg serve` remains a compatibility alias for the same command.
5. The browser redirects to the sandbox public URL.

The route is server-side. The infra service token is never sent to the browser.
During the preview, the route is available on free accounts while billing gates
are still being designed.

## First-run Agent Setup

The workspace is intentionally fresh. In OMG, open **Settings → Coding agents**
to check Claude, Codex, OpenCode, Jcode, and Grok setup. The screen reports the
installed binary path, auth state, and setup action where automatic install is
supported.

For Claude or Codex, complete the normal CLI login inside the workspace, or set
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` if you want API-key based operation.

You bring your own agent accounts. omg.dev does not resell tokens.

## E2E Contract

The OMG side owns the launch route and template lifecycle:

- Route: `https://omg.dev/sandbox/templates/<template-id>`
- OMG repo URL: `https://github.com/BennyKok/omg.dev`
- Template: `omg` (live). `lfg` is a compatibility alias.
- Port: `8766`
- Start command: `omg serve --host 0.0.0.0 --port 8766`

The underlying lifecycle test in the OMG repo creates the sandbox from
`templateId: "omg"`, resolves the `8766` public URL, hibernates it, wakes it with
readiness port `8766`, and verifies the URL still reaches OMG.

The hosted template definition lives in `BennyKok/vibes`
(`templates/agent-lfg` today). A vibes follow-up should make `omg serve` the
live start command and keep `lfg serve` only as an alias.
