# __OMG_PROJECT_NAME__

A small universal todo app created by omg.dev. It uses Expo Router, Lucide icons, and native Liquid Glass on supported iOS devices. Its data is stored on the phone, so it works in Expo Go and in the web preview with no backend.

## Preview

In an omg.dev Cloud Computer, ask the agent to start the Expo preview. It exposes Metro through the sandbox proxy and gives you an `exps://` link. Open that link with Expo Go. The same Metro server serves the web preview.

The preview link is temporary.

## Structure

- `src/app/index.tsx`: todo screen
- `src/lib/tasks.ts`: the data, stored on the phone (AsyncStorage)
- `schema.ts`: hosted collections; empty until the app has sign-in
- `app.json`: Expo configuration
- `eas.json`: development, preview, and production build profiles

Apple Sign In is not enabled by default. It needs an Apple Developer account, an app bundle ID, and a development build.
