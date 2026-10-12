// Main menu. Edit the title, the buttons and the footer.
import { router } from "expo-router";
import { MenuScreen } from "../components/screens";
import { profileStore, useProfile } from "../game/profile-store";
import { GAME_ID } from "../games/coin-dash/logic";

export default function Home() {
  const profile = useProfile();
  const best = profile.bestScores[GAME_ID];
  const two = profile.settings.players === 2;
  return (
    <MenuScreen
      title="Coin Dash"
      subtitle="Grab coins. Dodge the purple blobs."
      buttons={[
        { label: "Play", onPress: () => router.push("/play") },
        { label: two ? "Players: 2 (tap for 1)" : "Players: 1 (tap for 2)", kind: "ghost", onPress: () => profileStore.setSettings({ players: two ? 1 : 2 }) },
        { label: "Unlocks", kind: "ghost", onPress: () => router.push("/unlocks") },
      ]}
      footer={best === undefined ? "WASD or arrows to move" : `Best score: ${best}  ·  WASD / arrows to move`}
    />
  );
}
