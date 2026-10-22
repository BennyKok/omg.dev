// How to play and the FAQ. The text is in about.ts, which also feeds the
// page's search data, so edit it there.
import { router } from "../ui/router";
import { HelpScreen } from "../ui/screens";
import { GAME } from "./about";
import { ART } from "./art";

export default function Help() {
  return <HelpScreen name={GAME.name} steps={GAME.howToPlay} tips={GAME.tips} faq={GAME.faq} background={ART.background} onBack={() => router.back()} />;
}
