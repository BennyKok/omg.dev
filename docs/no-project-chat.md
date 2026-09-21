# Chats without a project

On iOS, the plus tab in the project rail selects unassigned conversations.
It uses the existing session list and composer. The empty list has no hero or
project setup form. Focusing an empty composer shows Website, App, API, and
Image starter cards. A tap sends the corresponding starter prompt immediately.
Long-press a project pill or the plus tab to manage folders.

`POST /api/sessions/new-unassigned` uses the normal session creation pipeline.
It gives each conversation a persistent `~/.omg/chats/<managed-name>` workspace.
`AGENTS.md` and `CLAUDE.md` provide project-creation guidance without changing
the user's message. The workspace also receives the managed
`.agents/skills/omg-app-builder/SKILL.md` workflow. The normal selected agent
and model still run the chat.

The session's explicit `project: ""` means unassigned. A missing project field
on a legacy record still falls back to its working directory. Live, historical,
and resumed managed sessions must retain the explicit empty value.

Release the runtime endpoint before the mobile client. An older runtime returns
404 for this endpoint. It must not silently create a chat in its default repo.
This change does not add Tasks.

## From Quick Chat to a website

The agent reads current hosted SDK guidance when the user requests a web app.
It uses `omg_create_project` to create a folder and register it through the
existing project store. The folder starts with Git and a committed README.
It also commits the same app-builder skill plus short `AGENTS.md` and
`CLAUDE.md` entry points, so the initial run and future project sessions use
one build, verification, and deployment workflow.
`parent` is optional on the MCP tool and `POST /api/projects/create-folder`;
omitting it uses `LFG_REPOS_ROOT` (or `~/repos`). Existing folders are rejected.

The agent uses the returned `repo.cwd` explicitly for building and deployment.
Quick Chat keeps its original scratch cwd and empty project. Home re-probes the
existing readiness owner on focus, so a project created during chat appears
when the user returns. Future sessions can select it normally.

A hosted preview is the default outcome for a new web project. User constraints
and applicable approval requirements still apply. Instructions direct the agent to test,
commit the source, deploy with `omg_deploy` and `wait: true`, verify the live
page and backend, then return a screenshot and URL. This uses the existing
Cloud credential and `.omg/project.json` deployment link. The agent commits
that non-secret link locally after deployment so future worktrees retain the
app identity. This is guidance for
the selected coding agent, not a deterministic scaffold or deploy pipeline.
Existing scratch instructions are preserved; new instructions apply to new chats.

The project-creation simulator fixture registers a demo project while a chat
is open. It exercises roster refresh and selection, not a real deployment.
Use entry `scripts/project-creation-e2e-entry.tsx` and plan `project-creation`.

## Verification

- `bun test src/no-project-chat.test.ts src/sessions-command-file-transcript.test.ts test/no-project-http.test.ts`
- Run each `mobile/scripts/{project-filter,project-picker,home-composer}.native-check.*` separately with `bun test ./<path>`.
- Root and mobile TypeScript checks.
- In `mobile/`, run `OMG_SIM_DEVICE="<isolated-simulator-name>" OMG_E2E_ENTRY_FILE=scripts/no-project-e2e-entry.tsx bun run test:e2e --build --plan no-project-chat --record`.

The simulator-only entry uses the full app with the demo transport. It does not
contact a real computer or launch a paid agent. The HTTP test runs the actual
request handler with only agent spawning and the repo roster stubbed.
