---
name: omg-app-builder
description: Build and deliver a new website, web app, API, or Expo app created through omg.dev New Project or Quick Chat. Use for initial product creation and first deployment, not routine maintenance of an established project.
metadata:
  short-description: Build and deliver a new omg.dev app
---

# Build and deliver an omg.dev app

Turn the user's product description into a working, verified result. Keep setup work with the agent. Ask only about product choices that materially change the result.

## Establish the project

- In Quick Chat, call `omg_create_project` once with a short descriptive name. Use the returned `repo.cwd` for every command, edit, test, and deployment. Inspect `omg_list_repos` before retrying an uncertain create call.
- In a New Project session, the current directory is already the project. It contains Git, a README, and this skill. Do not create a second project.
- Preserve `.git`. Do not overwrite an existing folder or move the current Quick Chat into the new project.

## Choose the delivery path

- For a website, web app, or API, use the supported omg.dev runtime unless the user requests another platform. Read `https://docs.omg.dev/llms.txt` and only the relevant parts of `https://docs.omg.dev/llms-full.txt` before choosing packages or API contracts.
- For an Expo app, prefer a universal Expo Router project that works in Expo Go and on the web unless the requested features need custom native code. Use omg.dev for its hosted backend when one is needed.
- Make a live Expo Web server the portable default preview for an Expo app in a Cloud Computer. Use the project's local Expo dependency; do not assume a global Expo CLI, Xcode, a simulator, or machine-specific tools exist.
- When device testing is useful and the environment can keep a development server running, start Expo with a tunnel and give the user its Expo Go QR code. Do not assume the user shares the sandbox network. If Expo Go cannot load a required native module, use a development build when authorized or report that limit clearly.
- TestFlight, App Store submission, paid services, domains, and third-party production accounts are separate delivery actions. Do them only when the user requests them and the required account is available. TestFlight needs the user's Expo account and paid Apple Developer account, but an EAS cloud build does not need Xcode or a Mac in the sandbox. Use supported login flows and never ask for passwords or tokens in chat.

## Build

1. Convert the request into a small observable done condition. Make reasonable visual and technical choices when the user did not specify them.
2. Scaffold inside the project directory. Install the current documented dependencies and configuration. Do not install a retired omg.dev CLI or ask the user for infrastructure tokens; runtime tools provide the Cloud credential.
3. Implement the real path. If the product needs shared data, authentication, uploads, or server work, use the documented hosted APIs and verify persistence and access control. Do not replace requested shared behavior with mock data or browser-only storage.
4. Test the important behavior. Also inspect the rendered UI at the target size. For an Expo app, run and inspect Expo Web first. Then verify on Expo Go, a development build, or a simulator when one is available. State which surface was tested; a web preview or type check is not proof of native behavior.
5. Update the README with the product purpose, local run command, architecture, and delivery notes. Commit the finished source locally so later omg.dev sessions start from a complete baseline.

## Deploy and prove it

- For a new website, web app, or API, a working hosted preview is the default result unless the user asks for local-only work or publication needs new authority.
- In a Cloud Computer, start Expo Web on the declared preview port with `BROWSER=none npx expo start --web --host lan --port 5173`. `BROWSER=none` prevents Expo from requiring a desktop browser in the headless sandbox. Wait until `http://127.0.0.1:5173` answers, then call `omg_expose_port` with port `5173`. Keep that process running. The resulting owner-only card is the real live development server, including reloads; it is temporary and is not a static deployment.
- If `omg_expose_port` is unavailable or the session is on a local computer, report that limit. Do not invent a public URL, expose credentials, or depend on this repository's simulator, SSH hosts, filesystem layout, or globally installed tools.
- Keep an Expo tunnel running only while the user needs the Expo Go QR session. Expo Go is a separate native test path; the sandbox preview URL is Expo Web and cannot replace it.
- Use `omg_deploy` only when the user wants a durable hosted deployment. An Expo Web export deployed there is static output, not the live sandbox preview.
- Call `omg_deploy` with `cwd` set to the project directory and `wait: true`. Reuse `.omg/project.json` on later deploys. After success, commit this non-secret file with the source so the app keeps one identity.
- Open the returned URL. Exercise the main user path and any relevant backend operation against the deployed app. A successful build or upload is not proof that the deployment works.
- Show the live result with `omg_display_image` when a screenshot is useful. Return the actual clickable URL and state which parts were verified.
- If build, deployment, login, or verification fails, report the exact remaining state. Never describe a local build, artifact, or pending native submission as deployed.

Finish the assigned task with `omg_ship` only after the requested result is verified.
