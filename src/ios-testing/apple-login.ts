import { chmodSync, existsSync, lstatSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type * as Apple from "@expo/apple-utils";

// Expo owns the private sign-in protocol, 2FA, team selection, and cookie cache.
// This module is used only by the interactive process on the user's Mac.
export type AppleLoginSdk = {
  Auth: Pick<typeof Apple.Auth, "loginAsync" | "resetInMemoryData">;
  Teams: Pick<typeof Apple.Teams, "getTeamsAsync">;
};

export type AppleDeveloperConnection = {
  appleId: string;
  teamId: string;
  teamName: string;
};

export class AppleLoginError extends Error {}

export function requireLocalAppleLogin(platform: string, interactive: boolean): void {
  if (platform !== "darwin") {
    throw new AppleLoginError("Run Apple sign-in in a terminal on your Mac.");
  }
  if (!interactive) {
    throw new AppleLoginError("Apple sign-in needs an interactive terminal on your Mac.");
  }
}

export function validateAppleId(input: string): string {
  const username = input.trim();
  // The SDK uses the account name as a directory within its cookie cache.
  if (!/^[^@\s/\\\x00-\x1f]+@[^@\s/\\\x00-\x1f]+\.[^@\s/\\\x00-\x1f]+$/.test(username)) {
    throw new AppleLoginError("Enter the email address for your Apple Developer account.");
  }
  return username;
}

export function prepareAppleCookieCache(username: string, userHome: string = homedir()): void {
  validateAppleId(username);
  // Keep the SDK's existing cache as the single source of truth. Set the
  // process umask to 077 before loading it so newly written cookies are private.
  let path = userHome;
  for (const part of [".app-store", "auth", username]) {
    path = join(path, part);
    if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new AppleLoginError("The local Apple session cache must use real directories.");
    }
    chmodSync(path, 0o700);
  }
  const cookiePath = join(path, "cookie");
  if (existsSync(cookiePath)) {
    const stat = lstatSync(cookiePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new AppleLoginError("The local Apple session cache must use a regular file.");
    }
    chmodSync(cookiePath, 0o600);
  }
}

export function appleRequestUrl(url: string, baseURL?: string): URL {
  const target = new URL(url, baseURL);
  if (
    target.protocol !== "https:" ||
    !target.hostname.endsWith(".apple.com") ||
    target.username ||
    target.password ||
    (target.port && target.port !== "443")
  ) {
    throw new AppleLoginError("Apple sign-in can connect only to Apple over HTTPS.");
  }
  return target;
}

export function restrictAppleRequests(sdk: Pick<typeof Apple, "getRequestClient">): () => void {
  const client = sdk.getRequestClient();
  const interceptor = client.interceptors.request.use((config: {
    url?: string;
    baseURL?: string;
    maxRedirects?: number;
    timeout?: number;
  }) => {
    appleRequestUrl(config.url ?? "", config.baseURL);
    // Redirects must not forward account data to a different destination.
    config.maxRedirects = 0;
    config.timeout = 30_000;
    return config;
  });
  return () => client.interceptors.request.eject(interceptor);
}

/** Return only the verified account/team summary, never passwords or cookies. */
export async function loginToAppleDeveloper(
  input: string,
  sdk: AppleLoginSdk,
  teamId?: string,
  onConnected?: (context: Apple.RequestContext, connection: AppleDeveloperConnection) => Promise<void>,
): Promise<AppleDeveloperConnection> {
  const username = validateAppleId(input);
  if (teamId && !/^[A-Z0-9]{10}$/.test(teamId)) {
    throw new AppleLoginError("The Apple team ID must have 10 letters or numbers.");
  }
  sdk.Auth.resetInMemoryData();
  try {
    // loginAsync first restores the SDK's local cookies. If they have expired,
    // its hidden password and 2FA prompts run in this terminal, as in EAS CLI.
    const session = await sdk.Auth.loginAsync({ username, teamId }, { autoResolveProvider: true });
    delete session.password;
    if (session.username.toLowerCase() !== username.toLowerCase()) {
      throw new AppleLoginError("Apple returned a different account. Start sign-in again.");
    }
    const teams = await sdk.Teams.getTeamsAsync();
    const team = teams.find((candidate) => candidate.teamId === session.context.teamId);
    if (!team || (teamId && team.teamId !== teamId)) {
      throw new AppleLoginError("Apple did not verify the selected developer team.");
    }
    if (
      team.status.toLowerCase() !== "active" ||
      !team.memberships.some((membership) =>
        membership.status.toLowerCase() === "active" && membership.platform.toLowerCase() === "ios"
      )
    ) {
      throw new AppleLoginError("This team needs an active Apple Developer membership for iOS testing.");
    }
    const connection = { appleId: username, teamId: team.teamId, teamName: team.name };
    // Provisioning runs locally while Expo owns the live cookie session.
    // The callback receives only the request context, never the password.
    await onConnected?.(session.context, connection);
    return connection;
  } catch (error) {
    if (error instanceof AppleLoginError) throw error;
    // SDK network errors can include cookies, request headers, or credential
    // payloads. Never print or attach the raw error to a user-visible result.
    if (error && typeof error === "object" && "isCancelledPrompt" in error) {
      throw new AppleLoginError("Apple sign-in was cancelled.");
    }
    throw new AppleLoginError("Apple sign-in failed. Check your account and verification code, then try again.");
  } finally {
    sdk.Auth.resetInMemoryData();
  }
}
