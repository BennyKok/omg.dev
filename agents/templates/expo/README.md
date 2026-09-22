# __OMG_PROJECT_NAME__

A small universal todo app created by omg.dev. It uses Expo Router, Lucide icons, native Liquid Glass on supported iOS devices, and the omg.dev hosted database.

## Run on the web

```bash
npm install
npm run web
```

The local web preview needs a deployed database URL. Copy `.env.example` to `.env.local`, then replace the example URL after your first `omg_deploy`.

## Run in Expo Go

1. Deploy the app with `omg_deploy`.
2. Put the returned app URL in `.env.local` as `EXPO_PUBLIC_OMG_API_URL`.
3. Run `npm run tunnel`.
4. Scan the QR code with Expo Go.

The tunnel is temporary. The database is durable and is hosted with the deployed web app.

## Structure

- `src/app/index.tsx`: todo screen
- `src/lib/tasks.ts`: native-safe database requests
- `schema.ts`: omg.dev database schema
- `app.json`: Expo configuration
- `eas.json`: development, preview, and production build profiles

Apple Sign In is not enabled by default. It needs an Apple Developer account, an app bundle ID, and a development build.
