import { router } from "expo-router";
import { View } from "react-native";
import { UnlocksScreen } from "../components/screens";
import { profileStore, useProfile } from "../game/profile-store";
import { GAME_ID, SHIPS, UNLOCKS } from "../games/coin-dash/logic";

export default function Unlocks() {
  const profile = useProfile();
  return (
    <UnlocksScreen
      profile={profile}
      unlocks={UNLOCKS}
      selectedId={profile.selected[GAME_ID] ?? "default"}
      onSelect={(id) => profileStore.select(GAME_ID, id)}
      onBack={() => router.back()}
      renderPreview={(u, open) => <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: open ? SHIPS[u.id] : "#555" }} />}
    />
  );
}
