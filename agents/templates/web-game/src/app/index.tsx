// Main menu. Edit the title, the buttons and the footer.
import { MenuScreen } from "../components/screens";
import { useTouchScreen } from "../components/controls";
import { profileStore, useProfile } from "../game/profile-store";
import { router } from "../game/router";
import { GAME_ID } from "../games/coin-dash/logic";

export default function Home() {
  const profile = useProfile();
  const touch = useTouchScreen();
  const best = profile.bestScores[GAME_ID];
  const two = profile.settings.players === 2;
  const help = touch ? "Drag the stick to move" : "WASD or arrows to move · Esc to pause";
  return (
    <MenuScreen
      title="Coin Dash"
      subtitle="Grab coins. Dodge the purple blobs."
      buttons={[
        { label: "Play", onPress: () => router.push("/play") },
        { label: two ? "Players: 2 (tap for 1)" : "Players: 1 (tap for 2)", kind: "ghost", onPress: () => profileStore.setSettings({ players: two ? 1 : 2 }) },
        { label: "Unlocks", kind: "ghost", onPress: () => router.push("/unlocks") },
      ]}
      footer={best === undefined ? help : `Best score: ${best}  ·  ${help}`}
    />
  );
}
