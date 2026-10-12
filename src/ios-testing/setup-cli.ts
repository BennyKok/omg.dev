#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { AppleLoginError, loginToAppleDeveloper, prepareAppleCookieCache, requireLocalAppleLogin, restrictAppleRequests, validateAppleId } from "./apple-login";
import { listUsbIosDevices } from "./devices";
import { macSigningVault } from "./keychain";
import { prepareIosTestingProfile } from "./provisioning";
import { IosSetupStore } from "./setup-state";

const args = process.argv.slice(2);
const help = "Usage: bun run ios:login [--team-id TEAMID]\n\nApple ID, password, and 2FA are entered on your Mac.\nSettings can also open this login window and prepare a testing profile.";
if (args.includes("--help") || args.includes("-h")) { console.log(help); process.exit(0); }
const action = ["login", "prepare"].includes(args[0]) ? args.shift()! : "login";
const teamIndex = args.indexOf("--team-id");
const teamId = teamIndex >= 0 ? args[teamIndex + 1] : undefined;
const stateRoot = resolve(process.env.OMG_IOS_SETUP_DIR ?? resolve(process.env.OMG_DATA_DIR ?? process.env.LFG_DATA_DIR ?? resolve(import.meta.dir, "../../data"), "ios-testing"));
const store = new IosSetupStore(stateRoot);

try {
  requireLocalAppleLogin(process.platform, Boolean(process.stdin.isTTY && process.stdout.isTTY));
  if (!["login", "prepare"].includes(action) || (args.length && !(args.length === 2 && args[0] === "--team-id" && /^[A-Z0-9]{10}$/.test(teamId ?? "")))) {
    throw new AppleLoginError(help);
  }
  process.umask(0o077);
  process.env.EXPO_NO_KEYCHAIN = "1";
  process.env.EXPO_APP_STORE_DEBUG = "0";
  for (const name of ["EXPO_APPLE_ID", "EXPO_APPLE_PASSWORD", "EXPO_APPLE_TEAM_ID", "EXPO_APPLE_PROVIDER_ID", "EXPO_APP_STORE_COOKIES_JSON", "DEBUG", "NODE_DEBUG"]) delete process.env[name];
  await store.withLock(async () => {
    let state = store.read();
    if (action === "prepare" && !state.connection) throw new AppleLoginError("Connect your Apple Developer account in Settings first.");
    state = { ...state, phase: action === "login" ? "signing-in" : "preparing", error: null };
    store.write(state);
    try {
      console.log("Your Apple password goes from this Mac directly to Apple. It is not saved.");
      const prompt = createInterface({ input: process.stdin, output: process.stdout });
      let username: string;
      try { username = validateAppleId(action === "prepare" ? state.connection!.appleId : await prompt.question("Apple ID: ")); }
      finally { prompt.close(); }
      prepareAppleCookieCache(username);
      const sdk = await import("@expo/apple-utils");
      const cleanup = restrictAppleRequests(sdk);
      try {
        await loginToAppleDeveloper(username, sdk, action === "prepare" ? state.connection!.teamId : teamId, async (context, connection) => {
          const sameAccount = state.connection?.teamId === connection.teamId && state.connection.appleId.toLowerCase() === connection.appleId.toLowerCase();
          state = { ...state, connection, profile: sameAccount ? state.profile : null, uploaded: sameAccount ? state.uploaded : null };
          store.write(state);
          if (action === "prepare") {
            const connected = await listUsbIosDevices();
            const requested = state.devices.filter((device) => connected.some((actual) => actual.udid === device.udid));
            if (!requested.length) throw new AppleLoginError("Connect a selected iPhone to this Mac and try again.");
            console.log("Preparing your iPhone testing profile...");
            const record = await prepareIosTestingProfile({ sdk, context, connection, devices: requested, vault: macSigningVault() });
            const profile = record.profiles.at(-1)!;
            state = { ...state, profile: { uuid: profile.uuid, expiresAt: profile.expiresAt, deviceIds: profile.deviceIds }, phase: "ready", error: null };
          } else state = { ...state, phase: state.profile ? "ready" : "idle", error: null };
          store.write(state);
          console.log(action === "prepare" ? "Your testing profile is saved in this Mac's Keychain." : `Connected to ${connection.teamName} (${connection.teamId}).`);
        });
      } finally { cleanup(); }
    } catch (error) {
      const message = error instanceof AppleLoginError ? error.message : "iOS setup could not finish. Check the local setup and try again.";
      store.write({ ...state, phase: "error", error: message });
      throw new AppleLoginError(message);
    }
  });
} catch (error) {
  console.error(error instanceof AppleLoginError ? error.message : "iOS setup could not start. Close other setup windows and try again.");
  process.exitCode = 1;
}
