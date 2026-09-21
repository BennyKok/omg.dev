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
- For an Expo app, build the native client in this project and use omg.dev for its hosted backend when one is needed. A hosted web preview is useful when the product supports it, but it is not proof of a native build.
- TestFlight, App Store submission, paid services, domains, and third-party production accounts are separate delivery actions. Do them only when the user requests them and the required account is available.

## Build

1. Convert the request into a small observable done condition. Make reasonable visual and technical choices when the user did not specify them.
2. Scaffold inside the project directory. Install the current documented dependencies and configuration. Do not install a retired omg.dev CLI or ask the user for infrastructure tokens; runtime tools provide the Cloud credential.
3. Implement the real path. If the product needs shared data, authentication, uploads, or server work, use the documented hosted APIs and verify persistence and access control. Do not replace requested shared behavior with mock data or browser-only storage.
4. Test the important behavior. Also inspect the rendered UI at the target size. For an Expo app, use a simulator or device build when available; a type check alone is not visual verification.
5. Update the README with the product purpose, local run command, architecture, and delivery notes. Commit the finished source locally so later omg.dev sessions start from a complete baseline.

## Deploy and prove it

- For a new website, web app, or API, a working hosted preview is the default result unless the user asks for local-only work or publication needs new authority.
- Call `omg_deploy` with `cwd` set to the project directory and `wait: true`. Reuse `.omg/project.json` on later deploys. After success, commit this non-secret file with the source so the app keeps one identity.
- Open the returned URL. Exercise the main user path and any relevant backend operation against the deployed app. A successful build or upload is not proof that the deployment works.
- Show the live result with `omg_display_image` when a screenshot is useful. Return the actual clickable URL and state which parts were verified.
- If build, deployment, login, or verification fails, report the exact remaining state. Never describe a local build, artifact, or pending native submission as deployed.

Finish the assigned task with `omg_ship` only after the requested result is verified.
