// Results after a round. The kit screen adapts to free play, the daily
// challenge and a friend's challenge. Share, Challenge and Send it back are
// wired here; the share text comes from the round (shareLine in logic.ts).
import { useState } from "react";
import { SKINS, UNLOCKS } from "../games/coin-dash/logic";
import { ItemArt } from "../ui/art";
import { useProfile } from "../ui/profile-store";
import { router } from "../ui/router";
import { clearChallenge, startRun } from "../ui/run";
import { ChallengeDialog, ResultsScreen } from "../ui/screens";
import { challengeLink, pageUrl, share } from "../ui/share";
import { GAME } from "./about";
import { ART } from "./art";

export default function Results() {
  const profile = useProfile();
  const run = profile.lastRun;
  const [asking, setAsking] = useState(false);
  const name = profile.settings.name;
  const link = (n: string) => (run?.seed ? challengeLink({ seed: run.seed, score: run.score, name: n }) : pageUrl());

  return (
    <>
      <ResultsScreen
        profile={profile}
        unlocks={UNLOCKS}
        background={ART.background}
        renderItem={(u) => <ItemArt image={ART.items[u.id]} color={SKINS[u.id]} label={u.label} />}
        actions={{
          onAgain: () => startRun(run?.mode ?? "free", "replace"),
          onMenu: () => {
            if (run?.mode === "challenge") clearChallenge();
            router.replace("/");
          },
          onUnlocks: () => router.push("/unlocks"),
          onShare: () => void share({ title: GAME.name, text: run?.shareLine ?? `${GAME.name}: ${run?.score ?? 0}`, url: run?.mode === "daily" ? pageUrl() : link(name) }, "result"),
          onChallenge: () => setAsking(true),
          onSendBack: () => void share({ title: GAME.name, text: `${run?.shareLine ?? ""}\nYour turn. Can you beat me?`.trim(), url: link(name) }, "send_back"),
        }}
      />
      {asking && run ? (
        <ChallengeDialog
          score={run.score}
          onClose={() => setAsking(false)}
          onSend={(n) => {
            setAsking(false);
            void share({ title: GAME.name, text: `I scored ${run.score} in ${GAME.name}. Can you beat me?`, url: link(n) }, "challenge");
          }}
        />
      ) : null}
    </>
  );
}

