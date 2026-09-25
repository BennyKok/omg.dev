import { isSharePath } from "./share-intent";

/**
 * What an incoming system URL should actually do to the stack.
 *
 * The widget and the Live Activity both open `omg:///` when they have nothing
 * specific to show -- see `agent-village-widget.tsx`, which only builds a
 * `omg:///session/<id>` URL when a session is waiting on you. `omg:///` is not
 * a destination. It means "open the app".
 *
 * Routing it anyway is what put a ghost home screen behind the real one: the
 * app already opens at the root, so sending it to the root again leaves the
 * stack holding two of them, and the second wears a back chevron you can swipe
 * away. Reported from a device twice.
 *
 * expo-router drops a link whose `redirectSystemPath` returns a falsy value --
 * `subscribe` in expo-router's `link/linking.js` only forwards a truthy href,
 * and `getInitialURL` only redirects a string. So returning null here is the
 * documented way to say "this URL carries no destination", and it applies to a
 * cold start and a running app alike, which is the reason to own this in ONE
 * place rather than in each caller's navigation.
 *
 * Anything with a real path is returned untouched. That includes the dev
 * client's own `omg://expo-development-client/?url=...`, which must keep
 * working, and `omg:///session/<id>`, where a push and a back chevron are
 * exactly right.
 */
export function systemPathTarget(path: string): string | null {
  if (typeof path !== "string" || path === "") return null;
  // A share from another app is not a screen. `share-routing.tsx` owns it.
  if (isSharePath(path)) return null;
  const withoutScheme = path.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  const route = withoutScheme.split("?")[0].split("#")[0].replace(/^\/+/, "");
  return route === "" || route === "/" ? null : path;
}
