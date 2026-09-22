# __OMG_PROJECT_NAME__

A universal Expo Router app created by omg.dev. It includes Expo Web, an example server API route, and EAS build profiles.

## Run

```bash
npm install
npm run web
```

Use `npm run tunnel` to open the project in Expo Go through a temporary tunnel.

## Structure

- `src/app/index.tsx`: the first screen
- `src/app/health+api.ts`: server-only API route
- `app.json`: Expo and web server configuration
- `eas.json`: development, preview, and production build profiles

For production native builds, deploy the server and configure the Expo Router origin before submitting the app. Never commit `.env` files or credentials.
