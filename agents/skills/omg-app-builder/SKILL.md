---
name: omg-app-builder
description: Build and deliver a new website, web app, API, or Expo app created through omg.dev New Project or Quick Chat. Use for initial product creation and first deployment, not routine maintenance of an established project.
metadata:
  short-description: Build and deliver a new omg.dev app
---

# Build and deliver an omg.dev app

Turn the user's product description into a working, verified result. Keep setup work with the agent. Ask only about product choices that materially change the result.

Ask one question per question call, and put at most one decision in it. A second question in the same call is not shown to the user on every client. If the user has not said what the app should do, ask that in plain words and wait for the answer. Do not build a placeholder product in its place. If a question times out, ask again once in a normal message and end the turn.

## Establish the project

- In Quick Chat, call `omg_create_project` once with a short descriptive name. Set `template` to `expo` for an Expo or universal mobile app. The Expo template already contains a working todo flow with data stored on the phone, Expo Router, Liquid Glass, Lucide icons, web support, and EAS configuration. Use the returned `repo.cwd` for every command, edit, test, and deployment. Inspect `omg_list_repos` before retrying an uncertain create call.
- In a New Project session, the current directory is already the project. It contains Git, a README, and this skill. Do not create a second project.
- Preserve `.git`. Do not overwrite an existing folder or move the current Quick Chat into the new project.

## Choose the delivery path

- For a website, web app, or API, use the supported omg.dev runtime unless the user requests another platform. Read `https://docs.omg.dev/llms.txt` and only the relevant parts of `https://docs.omg.dev/llms-full.txt` before choosing packages or API contracts.
- For an Expo app, start from the managed `expo` template and follow "Expo app: the fast path" below. Adapt its screens and its data store instead of rebuilding configuration. Keep secrets in hosted server routes. A production native build needs any server deployed at a secure origin; do not treat a sandbox tunnel as production hosting.
- Use one live Metro server for Expo Web and Expo Go in a Cloud Computer. Expose its port through `omg_expose_port`; do not assume a global Expo CLI, Xcode, a simulator, or machine-specific tools exist.
- When the app is compatible with Expo Go, give the user the returned `exps://` Expo Go link. Do not use Expo tunnel, LAN exposure, `exp.direct`, or ngrok. If Expo Go cannot load a required native module, use a development build when authorized or report that limit clearly.
- TestFlight, App Store submission, paid services, domains, and third-party production accounts are separate delivery actions. Do them only when the user requests them and the required account is available. TestFlight needs the user's Expo account and paid Apple Developer account, but an EAS cloud build does not need Xcode or a Mac in the sandbox. Use supported login flows and never ask for passwords or tokens in chat.

## Expo app: the fast path

A new user is waiting. The first screen must reach their phone within about 3 minutes, before any feature work. Follow these steps in order:

1. `omg_create_project` with `template: "expo"`. If `node_modules` is missing, run `bun install` once.
2. Preview before you write any code. Call `omg_expose_port` with port 8081 and `expoGo: true`. Then run `bash scripts/start-expo-preview.sh <expoGo.proxyUrl> 8081` from the project directory, with a 240000 ms shell timeout. When it prints `Sandbox proxy answers: HTTP 200`, send the user `expoGo.url` (it starts with `exps://`). Metro reloads the app on every save, so the phone follows your edits from here on.
3. Write the screens, in a few larger edits rather than one small edit per turn.
4. Run `bun run typecheck` once and fix what it reports.
5. Deploy once with `omg_deploy` (see below). The data stays on the phone, so this is a static web build.
6. Finish with `omg_ship`.

Do not browse `node_modules`, fetch documentation, or read the template file by file before the first link: the summary below is enough. Do not run repeated browser test loops. Do not write screenshot scripts when you cannot see images.

The template:

- `src/app/index.tsx`: the home screen. A header, an input with an add button, a list with toggle and delete, an error card, and a reload button. Styles are in one `StyleSheet` at the bottom; the brand colour is `CORAL`.
- `src/app/_layout.tsx`: an Expo Router stack with no header. A new screen is a new file in `src/app/` (`stats.tsx` is `/stats`). Navigate with `router.push("/stats")` or `<Link href="/stats">` from `expo-router`.
- `src/lib/tasks.ts`: the data, stored on the phone with AsyncStorage (localStorage on the web). `tasksApi.list()`, `create(title)`, `update(id, patch)`, `remove(id)`. Keep this file. For each new kind of item, copy its shape with its own storage key.
- Icons: `lucide-react-native`, for example `<Plus color={CORAL} size={22} />`. Glass surfaces: `GlassView` from `expo-glass-effect`.

Data: store it on the phone by default, with the `tasks.ts` pattern. Use hosted data only when the user asks for accounts or data shared between people. Then add sign-in with `@omg-dev/sdk` and `.scoped("user")` collections in `schema.ts`. Never call `/api/...` with a raw `fetch`: a hosted collection answers an anonymous phone with `401 Authentication required`.

Metro rules: use only ports 8081 to 8099, because Expo Go links work only in that range. Start Metro only with the script; `npx` and `ss` are not installed on every Computer.

## Build

1. Convert the request into a small observable done condition. Make reasonable visual and technical choices when the user did not specify them.
2. Scaffold inside the project directory. For a managed Expo template, install its pinned dependencies and preserve `.omg/template.json`; do not replace it with another starter. For a blank project, install the current documented dependencies and configuration. Do not install a retired omg.dev CLI or ask the user for infrastructure tokens; runtime tools provide the Cloud credential.
3. Implement the real path. If the product needs shared data, authentication, uploads, or server work, use the documented hosted APIs and verify persistence and access control. Do not replace requested shared behavior with mock data or browser-only storage.
4. Test the important behavior. Also inspect the rendered UI at the target size. For an Expo app, run and inspect Expo Web first. Then verify on Expo Go, a development build, or a simulator when one is available. State which surface was tested; a web preview or type check is not proof of native behavior.
5. Update the README with the product purpose, local run command, architecture, and delivery notes. Commit the finished source locally so later omg.dev sessions start from a complete baseline.

## Deploy and prove it

- For a new website, web app, or API, a working hosted preview is the default result unless the user asks for local-only work or publication needs new authority.
- If the script exits non-zero, read the log tail it prints, fix the cause, and run it again. Do not retry with other flags such as `--host 0.0.0.0`.
- When the script prints `Sandbox proxy answers: HTTP 200`, give the user `expoGo.url`, which starts with `exps://`. The preview card shows the same link with setup steps, and the owner web preview uses the same Metro server.
- A Computer that sleeps stops Metro. When the user asks to restart the preview, or the preview card says it stopped, call `omg_expose_port` again with `expoGo: true` and run the script with the new proxy URL.
- Use only the URLs returned by `omg_expose_port`. Do not also try LAN addresses, localhost URLs, `exp.direct`, ngrok, or Expo's tunnel. Do not start competing development servers.
- If `omg_expose_port` fails, confirm that the server is still running, is bound to `0.0.0.0`, and answers on the same port. Report the exact tool error if it still fails. Do not silently switch the web preview to another exposure method.
- If `omg_expose_port` is unavailable or the session is on a local computer, report that limit. Do not invent a public URL, expose credentials, or depend on this repository's simulator, SSH hosts, filesystem layout, or globally installed tools.
- The Expo Go capability link is short-lived. If it expires, restart the preview the same way.
- For a website, use `omg_deploy` when the user wants a durable hosted deployment. It stays private to omg.dev users; making it public is the user's publishing decision. Publishing the app to TestFlight or the App Store is a separate step the user asks for.
- Call `omg_deploy` with `cwd` set to the project directory and `wait: true`. It waits at most 45 seconds. If the result has `pending: true`, call `omg_deploy_status` with the returned slug until the build is ready or failed. Do not start a second deploy. Reuse `.omg/project.json` on later deploys. After success, commit this non-secret file with the source so the app keeps one identity.
- Open the returned URL. Exercise the main user path and any relevant backend operation against the deployed app. A successful build or upload is not proof that the deployment works.
- Show the live result with `omg_display_image` when a screenshot is useful. Return the actual clickable URL and state which parts were verified.
- If build, deployment, login, or verification fails, report the exact remaining state. Never describe a local build, artifact, or pending native submission as deployed.

Finish the assigned task with `omg_ship` only after the requested result is verified.
