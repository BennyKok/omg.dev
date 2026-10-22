// The screens. A new screen is a new file in src/app/ and one line here.
// Keep the `"/path": Component,` form: scripts/check-ui.mjs reads this list.
import type { ComponentType } from "react";
import { RotateNotice } from "../ui/screens";
import { Toaster } from "../ui/toast";
import { useRoute, useRouteKey } from "../ui/router";
import { GAME } from "./about";
import Help from "./help";
import Home from "./index";
import Play from "./play";
import Results from "./results";
import Unlocks from "./unlocks";

export const ROUTES: Record<string, ComponentType> = {
  "/": Home,
  "/play": Play,
  "/results": Results,
  "/unlocks": Unlocks,
  "/help": Help,
};

export function App() {
  const route = useRoute();
  const key = useRouteKey();
  const Screen = ROUTES[route] ?? Home;
  return (
    <>
      {/* key: a new screen (or a new mode of /play) mounts fresh, as a navigation does. */}
      <Screen key={route === "/play" ? key : route} />
      <Toaster />
      {GAME.orientation === "portrait" ? <RotateNotice /> : null}
    </>
  );
}
