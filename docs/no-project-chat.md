# Chats without a project

On iOS, the plus tab in the project rail selects unassigned conversations.
It uses the existing session list and composer. The empty list has no hero or
project setup form. Focusing an empty composer shows Website, App, API, and
Image starter cards. A tap sends the corresponding starter prompt immediately.
Long-press a project pill or the plus tab to manage folders.

`POST /api/sessions/new-unassigned` uses the normal session creation pipeline.
It gives each conversation a persistent `~/.omg/chats/<managed-name>` workspace.
`AGENTS.md` and `CLAUDE.md` provide project-creation guidance without changing
the user's message. The normal selected agent and model still run the chat.

The session's explicit `project: ""` means unassigned. A missing project field
on a legacy record still falls back to its working directory. Live, historical,
and resumed managed sessions must retain the explicit empty value.

Release the runtime endpoint before the mobile client. An older runtime returns
404 for this endpoint. It must not silently create a chat in its default repo.
This change does not add Tasks or automatically register generated projects.

## Verification

- `bun test src/no-project-chat.test.ts src/sessions-command-file-transcript.test.ts test/no-project-http.test.ts`
- Run each `mobile/scripts/{project-filter,project-picker,home-composer}.native-check.*` separately with `bun test ./<path>`.
- Root and mobile TypeScript checks.
- In `mobile/`, run `OMG_SIM_DEVICE="<isolated-simulator-name>" OMG_E2E_ENTRY_FILE=scripts/no-project-e2e-entry.tsx bun run test:e2e --build --plan no-project-chat --record`.

The simulator-only entry uses the full app with the demo transport. It does not
contact a real computer or launch a paid agent. The HTTP test runs the actual
request handler with only agent spawning and the repo roster stubbed.
