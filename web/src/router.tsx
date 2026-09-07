import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  type RouterHistory,
} from "@tanstack/react-router";
import { App } from "./App";
import { AppCrash } from "./components/app-crash";
import {
  tabToPath,
  validateAppSearch,
  validateIndexSearch,
} from "./lib/app-search";

// App is rendered by the ROOT route so it stays mounted across every page
// change — the page is selected by the URL path (read inside App via
// useRouterState), not by swapping route components. Remounting the ~16k-line
// App on each tab switch would blow away sessions, live streams and scroll, so
// the child routes below exist only to make each path a valid match (and to
// hold per-route search validation); they render nothing themselves.
const rootRoute = createRootRoute({
  component: App,
});

// `/` → the default page ("live"). Also honors a legacy `?tab=` param by
// redirecting to the matching path, so old links and bookmarks keep working.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  validateSearch: validateIndexSearch,
  beforeLoad: ({ search }) => {
    if (search.tab) {
      // Preserve session deep-links and embed mode across the legacy ?tab=
      // redirect so framed hosts (omg) don't lose their chrome contract.
      const nextSearch: {
        session?: string;
        embed?: boolean;
        embedOrigin?: string;
        inspectSession?: string;
      } = {};
      if (search.session) nextSearch.session = search.session;
      if (search.embed) nextSearch.embed = true;
      if (search.embedOrigin) nextSearch.embedOrigin = search.embedOrigin;
      if (search.inspectSession) nextSearch.inspectSession = search.inspectSession;
      throw redirect({
        to: tabToPath(search.tab),
        search: nextSearch,
        replace: true,
      });
    }
  },
  component: () => null,
});

// `/$tab` → any single-segment page: a built-in page or an extension tab id.
const tabRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "$tab",
  validateSearch: validateAppSearch,
  beforeLoad: ({ params, search }) => {
    // `/shipped` and `/ask` both resolve to the Notification Center now.
    if (params.tab !== "shipped" && params.tab !== "ask") return;
    throw redirect({
      to: "/$tab",
      params: { tab: "notifications" },
      search,
      replace: true,
    });
  },
  component: () => null,
});

// Bot chats keep the Bots page selected while adding a durable bot id to the
// path. App owns the master/detail render so this route remains component-less.
const botRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "bots/$botId",
  validateSearch: validateAppSearch,
  component: () => null,
});

// Making or editing a bot is its OWN page, at its own URL — not a sheet over
// the bots list. A form this long (name, persona, face, colour, repo, model) is
// a place you go to, so back/forward and the phone's back gesture have to leave
// it the way they leave any other page. Static `bots/new` outranks the
// `bots/$botId` param route, so "new" can never be read as a bot id.
const botNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "bots/new",
  validateSearch: validateAppSearch,
  component: () => null,
});

const botEditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "bots/$botId/edit",
  validateSearch: validateAppSearch,
  component: () => null,
});

// One open session, at its own URL. App owns the render (it is the root route
// component), so like the bot routes this exists only to make the path a valid
// match and to hold its search validation.
const sessionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "sessions/$sid",
  validateSearch: validateAppSearch,
  component: () => null,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  tabRoute,
  botRoute,
  botNewRoute,
  botEditRoute,
  sessionRoute,
]);

export function createOmgRouter(history?: RouterHistory) {
  return createRouter({
    routeTree,
    defaultPreload: false,
    history,
    // App is the ROOT route component, so any uncaught render error in the app
    // lands in the root CatchBoundary — INSIDE RootErrorBoundary, which
    // therefore never sees it. Without this option that boundary falls back to
    // TanStack's built-in strip ("Something went wrong! / Hide Error" over a red
    // monospace box) and, worse, reports nothing: componentDidCatch never runs.
    // AppCrash both looks like the product and files the report itself.
    defaultErrorComponent: ({ error, info, reset }) => (
      <AppCrash
        error={error}
        componentStack={info?.componentStack}
        reset={reset}
        boundary="router"
      />
    ),
  });
}

export const router = createOmgRouter();

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
