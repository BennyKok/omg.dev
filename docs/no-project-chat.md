# Chats without a project

On iOS, the plus tab in the project rail selects unassigned conversations.
It uses the existing session list and composer. The empty list has no hero or
project setup form. Focusing an empty composer shows Website, App, API, and
Image starter cards. A tap sends the corresponding starter prompt immediately.
Long-press a project pill or the plus tab to manage folders.

`POST /api/sessions/new-unassigned` uses the normal session creation pipeline.
It gives each conversation a persistent
`~/.local/share/omg/chats/<managed-name>` workspace. The runtime reserves
`~/.omg` for managed files, which can be root-owned on a hosted Computer.
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

## On the web

The same scope leads the web project rail as a round plus pill, before the
folders, the way it leads the rail on iOS. It is an icon and not a name
because it is not a folder, and because at the end of a rail of sixteen
folders the only way to start a no-folder chat was off the end of a scroller.
Everywhere the scope is named in prose, it is called "No project". It is also
a row in the composer's project sheet, which is the only route to it on a
phone, where the rail is not drawn. Selecting it shows only sessions with an
explicit empty project, and the composer starts its sessions through
`POST /api/sessions/new-unassigned`.

The composer resolves no folder at all in this scope. The normal fallback
chain would hand the chat the last folder the browser used, and the session
would run in a real repository while the composer said "No project". It also
does not write that empty folder back to `lfg_v2_repo`, so the next ordinary
session still opens where it did before.

An empty composer shows the same four starter cards. A click sends the
starter prompt immediately. The prompts live in
`packages/protocol/src/chat-starters.ts`, so the two clients cannot word them
differently; each client keeps its own icons, because SF Symbols and Lucide do
not share names. The iOS card rail still holds its own copy of the strings and
should adopt the shared list the next time that row is touched.

A box that predates the endpoint answers 404, and the web composer reports
that error. It deliberately does not fall back to `POST /api/sessions/new`,
which would start the chat in the default repository without saying so.

The web page re-reads `/api/repos` on its existing session poll, so a project
the agent registers mid-chat appears in the rail without a reload. No live
event carries the roster, and `/api/bootstrap` runs only on mount, so before
this the new project stayed invisible until the page was reloaded. iOS can
wait for screen focus, because its project rail is on Home and you leave the
chat to reach it. On the web the rail sits beside the open chat, so the user
watches the project get created with a stale rail in view.

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
- `bun test web/src/lib/project-filter.test.ts web/src/components/chat-starter-row.test.tsx`
- Root and mobile TypeScript checks.
- In `mobile/`, run `OMG_SIM_DEVICE="<isolated-simulator-name>" OMG_E2E_ENTRY_FILE=scripts/no-project-e2e-entry.tsx bun run test:e2e --build --plan no-project-chat --record`.

The simulator-only entry uses the full app with the demo transport. It does not
contact a real computer or launch a paid agent. The HTTP test runs the actual
request handler with only agent spawning and the repo roster stubbed.
