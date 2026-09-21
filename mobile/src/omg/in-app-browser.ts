/**
 * Open a sign-in page without leaving the app.
 *
 * `expo-web-browser` wraps SFSafariViewController. It is a native module, so a
 * binary built before it was added does not have it, and an OTA bundle that
 * imports it at module scope would crash that binary on launch. The module is
 * loaded lazily inside a try, and a binary without it falls back to Safari,
 * which is what the flow did before. The caller is told which one happened so
 * it can wait for the sheet to close, or for the app to come back to the
 * foreground.
 */
import { Linking } from "react-native";

type WebBrowserModule = {
  openBrowserAsync: (url: string, opts?: Record<string, unknown>) => Promise<{ type: string }>;
  dismissBrowser?: () => void | Promise<void>;
  WebBrowserPresentationStyle?: { PAGE_SHEET?: string; FORM_SHEET?: string };
};

let loaded: WebBrowserModule | null | undefined;

function webBrowser(): WebBrowserModule | null {
  if (loaded === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      loaded = require("expo-web-browser") as WebBrowserModule;
    } catch {
      loaded = null;
    }
  }
  return loaded;
}

export function hasInAppBrowser(): boolean {
  return webBrowser() !== null;
}

/**
 * Resolves when the in-app sheet is dismissed ("closed"), or right after the
 * hand-off to Safari ("external").
 */
export async function openSignInPage(url: string): Promise<"closed" | "external"> {
  const wb = webBrowser();
  if (wb) {
    try {
      await wb.openBrowserAsync(url, {
        presentationStyle: wb.WebBrowserPresentationStyle?.PAGE_SHEET,
        dismissButtonStyle: "done",
      });
      return "closed";
    } catch {
      // Fall through to Safari: a failed present must not strand the flow.
    }
  }
  await Linking.openURL(url);
  return "external";
}

export function dismissSignInPage(): void {
  try {
    void webBrowser()?.dismissBrowser?.();
  } catch {
    // Nothing open. Fine.
  }
}
