// Main menu. Edit the buttons and the footer; the name, tagline and art come
// from about.ts and art.ts.
import { useEffect } from "react";
import { GAME_ID } from "../games/coin-dash/logic";
import { Hero } from "../ui/art";
import { IconCalendar, IconCheck, IconClose, IconHelp, IconLock, IconPlay, IconSwords } from "../ui/icons";
import { profileStore, useProfile } from "../ui/profile-store";
import { router } from "../ui/router";
import { activeChallenge, clearChallenge, startRun, todayDaily } from "../ui/run";
import { GameButton, IconButton, MenuScreen, SoundButton, Stepper, TopBar } from "../ui/screens";
import { useTouchScreen } from "../ui/controls";
import { useRouteKey } from "../ui/router";
import { GAME } from "./about";
import { ART } from "./art";
import { preloadView } from "./view";

export default function Home() {
  const profile = useProfile();
  const touch = useTouchScreen();
  useRouteKey(); // redraw when the link changes (a dismissed challenge)
  useEffect(preloadView, []); // the game view (and three.js for 3D) downloads while the menu shows
  const best = profile.bestScores[GAME_ID];
  const daily = todayDaily(GAME.launchDay);
  const challenge = activeChallenge();
  const players = profile.settings.players;

  const note = challenge ? (
    <div className="note-card" role="status">
      <IconButton label="Dismiss challenge" onPress={() => { clearChallenge(); router.replace("/"); }}><IconClose /></IconButton>
      <span className="note-icon"><IconSwords size={28} /></span>
      <p className="note-title">{challenge.name} challenges you!</p>
      <p className="note-text">Beat {challenge.score.toLocaleString("en-US")} on the same level.</p>
    </div>
  ) : null;

  return (
    <MenuScreen
      name={GAME.name}
      logo={ART.logo}
      tagline={GAME.tagline}
      background={ART.background}
      hero={<Hero image={ART.hero} />}
      note={note}
      top={
        <TopBar
          left={<IconButton label="How to play" onPress={() => router.push("/help")}><IconHelp /></IconButton>}
          right={<SoundButton />}
        />
      }
      footer={best === undefined ? (touch ? GAME.controls.touchHint : GAME.controls.keysHint) : `Best score: ${best.toLocaleString("en-US")}`}
    >
      {challenge ? (
        <GameButton label="Accept challenge" size="lg" icon={<IconPlay />} onPress={() => startRun("challenge")} />
      ) : (
        <GameButton label="Play" size="lg" icon={<IconPlay />} onPress={() => startRun("free")} />
      )}
      <GameButton
        label={daily.bestToday === undefined ? `Daily #${daily.number}${daily.streak ? `  ·  ${daily.streak} day streak` : ""}` : `Daily #${daily.number} done  ·  ${daily.streak} day streak`}
        kind="surface"
        icon={daily.bestToday === undefined ? <IconCalendar /> : <IconCheck />}
        onPress={() => startRun("daily")}
      />
      {challenge ? null : (
        <Stepper label="Players" value={players} min={1} max={2} onChange={(v) => profileStore.setSettings({ players: v === 2 ? 2 : 1 })} />
      )}
      <GameButton label="Unlocks" kind="secondary" icon={<IconLock />} onPress={() => router.push("/unlocks")} />
    </MenuScreen>
  );
}
