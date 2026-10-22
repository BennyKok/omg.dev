import { GAME_ID, SKINS, UNLOCKS } from "../games/coin-dash/logic";
import { ItemArt } from "../ui/art";
import { profileStore, useProfile } from "../ui/profile-store";
import { router } from "../ui/router";
import { UnlocksScreen } from "../ui/screens";
import { ART } from "./art";

export default function Unlocks() {
  const profile = useProfile();
  return (
    <UnlocksScreen
      profile={profile}
      unlocks={UNLOCKS}
      background={ART.background}
      selectedId={profile.selected[GAME_ID] ?? "default"}
      onSelect={(id) => profileStore.select(GAME_ID, id)}
      onBack={() => router.back()}
      renderItem={(u, open) => <ItemArt image={ART.items[u.id]} color={SKINS[u.id]} label={u.label} locked={!open} />}
    />
  );
}
