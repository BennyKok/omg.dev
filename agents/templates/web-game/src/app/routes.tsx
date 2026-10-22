// The screens. A new screen is a new file in src/app/ and one line here.
// Keep the `"/path": Component,` form: scripts/check-ui.mjs reads this list.
import type { ComponentType } from "react";
import { useRoute } from "../game/router";
import Home from "./index";
import Play from "./play";
import Results from "./results";
import Unlocks from "./unlocks";

export const ROUTES: Record<string, ComponentType> = {
  "/": Home,
  "/play": Play,
  "/results": Results,
  "/unlocks": Unlocks,
};

export function App() {
  const route = useRoute();
  const Screen = ROUTES[route] ?? Home;
  // key: a new screen mounts fresh, as a navigation does.
  return <Screen key={route} />;
}
