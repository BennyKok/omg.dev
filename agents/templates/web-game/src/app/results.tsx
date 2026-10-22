import { ResultsScreen } from "../components/screens";
import { useProfile } from "../game/profile-store";
import { router } from "../game/router";
import { UNLOCKS } from "../games/coin-dash/logic";

export default function Results() {
  const profile = useProfile();
  return (
    <ResultsScreen
      profile={profile}
      title="Time's up!"
      unlocks={UNLOCKS}
      onAgain={() => router.replace("/play")}
      onMenu={() => router.replace("/")}
      onUnlocks={() => router.push("/unlocks")}
    />
  );
}
