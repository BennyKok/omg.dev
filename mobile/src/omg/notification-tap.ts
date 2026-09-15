export type NotificationTapAction =
  | { kind: "ignore" }
  | { kind: "dismissTo"; path: "/" }
  | { kind: "push"; path: string };

/**
 * What a tapped notification's target path should do to the stack.
 *
 * "/" IS NOT A PUSH. `toNativeAppUrl()` returns "/" for any notification with
 * no specific target -- no url, an unparseable one, or a bare path -- and
 * pushing the root route stacks a SECOND home screen on top of the first. The
 * app then opens on Home wearing a back chevron, with a ghost copy of itself
 * behind it that you can swipe back to. Reported from the device.
 *
 * `dismissTo` is what the rest of the app already uses to reach "/" (see
 * `navigateWorkspace` in sessions-screen.tsx). It pops to the existing home
 * rather than making another one, so it also clears a ghost left by an earlier
 * build instead of adding to it.
 *
 * Split out from the hook so the rule is testable without a navigator. It is
 * the rule, not the plumbing, that regressed.
 */
export function notificationTapAction(url: unknown): NotificationTapAction {
  if (typeof url !== "string" || !url.startsWith("/")) return { kind: "ignore" };
  if (url === "/") return { kind: "dismissTo", path: "/" };
  return { kind: "push", path: url };
}
