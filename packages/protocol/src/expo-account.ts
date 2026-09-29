/**
 * The Expo account of this Computer's Expo CLI, as the preview card sees it.
 *
 * Expo Go on a physical iPhone opens a dev server only when the manifest names
 * the signed-in Expo CLI account (`extra.expoGo.username`) and Expo Go is
 * signed in to the same account. The card checks this before it offers
 * "Open in Expo Go", and offers "Connect Expo" otherwise.
 *
 * TODO(expo-go-58): Expo Go 58 reads `expo_go_prompt_device_auth=1` on the
 * `exps://` link and shows its own "Sign in to Expo Go" sheet (expo/expo#48865).
 * When Expo Go 58 is on the App Store, add it to the "Open in Expo Go" link
 * while `signedIn` is true, so the phone signs in to the same account.
 */
export type ExpoConnectState =
  /** `expo login --browser` runs, and the login page is open in the Computer browser. */
  | "waiting"
  /** The login finished. The Computer checks the account and the manifest. */
  | "verifying"
  /** Metro restarts so that the manifest names the account. */
  | "restarting"
  | "done"
  | "failed"
  | "cancelled";

export interface ExpoConnectStatus {
  state: ExpoConnectState;
  startedAt: number;
  /** Short text for the card, for example why the login failed. */
  message?: string;
}

export interface ExpoAccountSnapshot {
  signedIn: boolean;
  /** The Expo account name, when `signedIn` is true. */
  username?: string;
  /** The last or current "Connect Expo" run on this Computer. */
  connect?: ExpoConnectStatus;
}

/** True while a "Connect Expo" run is in progress. */
export function expoConnectActive(status: ExpoConnectStatus | undefined): boolean {
  return status?.state === "waiting" || status?.state === "verifying" || status?.state === "restarting";
}

/** The card text while a "Connect Expo" run is in progress. */
export function expoConnectMessage(status: ExpoConnectStatus): string {
  switch (status.state) {
    case "waiting": return "Sign in to Expo in the Computer window…";
    case "verifying": return "Checking the Expo account…";
    case "restarting": return "Restarting the preview with your Expo account…";
    case "done": return status.message ?? "Expo is connected.";
    case "cancelled": return "Expo sign-in was cancelled.";
    case "failed": return status.message ?? "Expo sign-in did not finish. Try again.";
  }
}
