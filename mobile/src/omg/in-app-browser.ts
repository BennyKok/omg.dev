/**
 * Open a sign-in page without leaving the app.
 *
 * `expo-web-browser` wraps SFSafariViewController. It is a native module, so a
 * binary built before it was added does not have it, and an OTA bundle that
 * imports it at module scope would crash that binary on launch. A binary
 * without it must fall back to Safari, which is what the flow did before. The
 * caller is told which one happened so it can wait for the sheet to close, or
 * for the app to come back to the foreground.
 *
 * ── Why the probe, and not `try { require(...) } catch` ───────────────────
 *
 * A lazy require inside a try looks like it covers the missing binary. It does
 * not, and it crashed the app on 2026-09-21: tapping Connect on a build whose
 * pods predate the package killed the process with
 *
 *   Unhandled JS Exception: Error: Cannot find native module 'ExpoWebBrowser'
 *     requireNativeModule -> ... -> webBrowser -> hasInAppBrowser
 *   *** Terminating app due to uncaught exception 'RCTFatalException'
 *
 * Metro's `guardedLoadModule` wraps the OUTERMOST require of a module graph
 * and, when that graph throws while loading, hands the error to
 * `ErrorUtils.reportFatalError` instead of re-throwing it to whoever called
 * `require`. The `catch` is never entered, and a fatal in a release build is a
 * crash. Any `try { require(native package) } catch` here is the same trap.
 *
 * So ask expo-modules-core whether the native module is registered FIRST.
 * `requireOptionalNativeModule` returns null rather than throwing -- that is
 * the API built for this question. Only when it answers do we load the JS
 * wrapper, and by then the wrapper's own `requireNativeModule` cannot fail.
 */
import { requireOptionalNativeModule } from "expo-modules-core";
import { Linking } from "react-native";

type WebBrowserModule = {
  openBrowserAsync: (url: string, opts?: Record<string, unknown>) => Promise<{ type: string }>;
  openAuthSessionAsync?: (url: string, redirectUrl?: string | null, opts?: Record<string, unknown>) => Promise<{ type: string; url?: string }>;
  dismissBrowser?: () => void | Promise<void>;
  WebBrowserPresentationStyle?: { PAGE_SHEET?: string; FORM_SHEET?: string };
};

let loaded: WebBrowserModule | null | undefined;

/**
 * The name the native side registers. It is the podspec/module name, not the
 * npm package name, and it is what expo-web-browser itself asks for.
 */
const NATIVE_MODULE = "ExpoWebBrowser";

function webBrowser(): WebBrowserModule | null {
  if (loaded === undefined) {
    loaded = requireOptionalNativeModule(NATIVE_MODULE)
      ? // eslint-disable-next-line @typescript-eslint/no-require-imports
        (require("expo-web-browser") as WebBrowserModule)
      : null;
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
export async function openInAppPage(url: string): Promise<"closed" | "external"> {
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

export const openSignInPage = openInAppPage;

export function dismissSignInPage(): void {
  try {
    void webBrowser()?.dismissBrowser?.();
  } catch {
    // Nothing open. Fine.
  }
}


/**
 * Open a sign-in page in an auth session and return the URL it finished on,
 * or null when the person closed it. The session ends by itself when the page
 * navigates to `returnUrl` (a custom scheme such as omg://…), which is how a
 * provider's redirect comes back to the app without the app ever reading
 * the page. Null too when this build has no web browser module.
 */
export async function openAuthSession(url: string, returnUrl: string): Promise<string | null> {
  const wb = webBrowser();
  if (!wb?.openAuthSessionAsync) return null;
  const result = await wb.openAuthSessionAsync(url, returnUrl, { preferEphemeralSession: false });
  return result.type === "success" && result.url ? result.url : null;
}
