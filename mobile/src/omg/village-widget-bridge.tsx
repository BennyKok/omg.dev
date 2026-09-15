/** App-owned widget timeline. Tracks the ready Computer while the app can run. */
import type { OmgClient } from "@omg-dev/client";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";

import { AgentVillageWidget, type VillageCharacter, type VillageProps } from "./agent-village-widget";
import { isSharedBindingId } from "./computer-shared-binding";
import { CLOUD_BINDING_ID } from "./config";
import { bindingLabel } from "./format";
import { widgetRefresh } from "./widget-refresh";
import { useOmg } from "./provider";
import { stageAgentIcons, stageVillageScenes, villageCharacter, villageScene, walkTimeline } from "./village-widget-data";

/**
 * One pose every ninety seconds. WALK_ENTRIES of them still cover the next
 * twelve minutes, so a write buys the same window as before at twice the rate.
 * Below about a minute iOS stops honouring Home Screen entries anyway, so
 * there is nothing to gain by going lower.
 */
const WALK_STEP_MS = 90 * 1000;

type FleetSession = {
  sessionId: string | null;
  agent?: string;
  title?: string | null;
  busy?: boolean;
  launching?: boolean;
  status?: "ok" | "blocked";
  lastActivityAt?: number | null;
};

/** One open ask-user question, from GET /api/ask?status=open. */
type OpenAsk = { id: string; sessionId?: string | null };

/**
 * Session ids with a question waiting on a human.
 *
 * A failure here must not silently downgrade every waiting agent to idle, so
 * the caller keeps the previous frame rather than writing a wrong one.
 */
async function openAskSessionIds(client: OmgClient): Promise<Set<string> | null> {
  const response = await client.transport
    .request<{ questions?: OpenAsk[] }>("/api/ask?status=open")
    .catch(() => null);
  if (!response) return null;
  const ids = new Set<string>();
  for (const question of response.questions ?? []) {
    if (question.sessionId) ids.add(question.sessionId);
  }
  return ids;
}

/**
 * Who gets a standing point, and in what order.
 *
 * There are far more sessions than standing points. This box had 20 sessions
 * and 4 medium slots when this was written, and only 2 were doing anything, so
 * ranking alone filled the village with arbitrary idle sessions that happened
 * to sort first. The widget is meant to show ACTIVITY, so idle sessions do not
 * take a slot while anything is active.
 *
 * When nothing at all is active the village would be empty, which reads as
 * broken rather than as calm. The two most recently active sessions then nap
 * in it, which is the "All finished" state the Paper legend already describes.
 */
function rank(session: FleetSession, waiting: Set<string>): number {
  if (session.sessionId && waiting.has(session.sessionId)) return 0;
  if (session.status === "blocked") return 1;
  if (session.busy || session.launching) return 2;
  return 3;
}

/**
 * A waiting question outranks a provider error, and both outrank running.
 * Both draw the "blocked" pose, because both are things only the human can
 * clear, and the caption counts both for the same reason.
 */
function stateOf(session: FleetSession, waiting: Set<string>): VillageCharacter["state"] {
  if (session.sessionId && waiting.has(session.sessionId)) return "blocked";
  if (session.status === "blocked") return "blocked";
  if (session.busy || session.launching) return "working";
  return "idle";
}

export function AgentVillageWidgetBridge() {
  const { authStatus, bindingId, bindings, client, readiness } = useOmg();
  const ready = readiness?.status === "ready";

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const eligible = authStatus === "signed-in" && bindingId &&
      bindingId !== CLOUD_BINDING_ID && !isSharedBindingId(bindingId);

    let disposed = false;

    // Clear a signed-out or explicitly unsupported selection, but preserve
    // the saved frame during authentication and Computer wake-up.
    if (authStatus === "signed-out" || (authStatus === "signed-in" && bindingId && !eligible)) {
      void (async () => {
        const staged = await stageVillageScenes();
        const small = villageScene("small", staged);
        const medium = villageScene("medium", staged);
        const large = villageScene("large", staged);
        if (disposed || !small || !medium || !large) return;
        AgentVillageWidget.updateSnapshot({
          machineName: "Open omg.dev", runningCount: 0, blockedCount: 0,
          attentionSessionId: "", scenes: { small, medium, large },
          characters: [], walkPhase: 0, updatedAt: Date.now(),
        });
      })().catch(console.warn);
      return () => { disposed = true; };
    }

    const refresh = async (): Promise<boolean> => {
      // Startup/auth restoration must not overwrite a valid saved snapshot.
      if (authStatus !== "signed-in" || !eligible || !client || !ready) return false;
      const stagedScenes = await stageVillageScenes();
      const small = villageScene("small", stagedScenes);
      const medium = villageScene("medium", stagedScenes);
      const large = villageScene("large", stagedScenes);
      if (disposed || !small || !medium || !large) return false;
      const [sessions, waiting] = await Promise.all([
        client.listSessions().catch(() => null) as Promise<FleetSession[] | null>,
        openAskSessionIds(client),
      ]);
      // Either half missing means the next frame would be wrong rather than
      // stale. Keep what the widget already shows.
      if (disposed || !sessions || !waiting) return false;

      const icons = await stageAgentIcons(sessions.map((session) => session.agent ?? ""));
      if (disposed) return false;

      const isActive = (session: FleetSession) =>
        (session.sessionId && waiting.has(session.sessionId)) || session.status === "blocked" || session.busy || session.launching;
      const active = sessions.filter(isActive).sort((a, b) => rank(a, waiting) - rank(b, waiting));
      const nappers = active.length > 0
        ? []
        : [...sessions]
            .sort((a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0))
            .slice(0, 2);
      const characters = [...active, ...nappers]
        .slice(0, large.slots.length)
        .map((session) => villageCharacter(session.agent, stateOf(session, waiting), icons, session))
        .filter((character): character is VillageCharacter => character !== null);

      // Both a parked question and a dead provider draw the same "!" pose, so
      // the caption counts both. Counting only questions put a "!" on screen
      // that no number accounted for, which reads as a bug in the widget.
      const asking = sessions.filter((session) => session.sessionId && waiting.has(session.sessionId));
      const stuck = sessions.filter((session) => session.status === "blocked" && !(session.sessionId && waiting.has(session.sessionId)));
      const binding = bindings.find((entry) => entry.id === bindingId);

      AgentVillageWidget.updateTimeline(
        walkTimeline<VillageProps>({
          machineName: binding ? bindingLabel(binding) : "My Computer",
          runningCount: sessions.filter((session) => session.busy || session.launching).length,
          blockedCount: asking.length + stuck.length,
          // A parked question is the one a tap can actually resolve, so it wins
          // the deep link over a provider error.
          attentionSessionId: asking[0]?.sessionId ?? stuck[0]?.sessionId ?? "",
          scenes: { small, medium, large },
          characters,
          updatedAt: Date.now(),
        }, WALK_STEP_MS),
      );
      return true;
    };

    if (!eligible || !client || !ready) return;
    const writer = widgetRefresh({ refresh, onError: console.warn });
    let stopObserving: (() => void) | null = null;
    const foreground = (active: boolean) => {
      if (active && !stopObserving) {
        let lastStatus = "";
        const offStatus = client.live.subscribeStatus((rows) => {
          const signature = JSON.stringify(rows.map((row) => [row.sessionId, row.busy, row.status]));
          if (signature !== lastStatus) { lastStatus = signature; writer.changed(); }
        });
        const offConnection = client.live.subscribeConnection((state) => {
          if (state.status === "live") writer.changed();
        });
        stopObserving = () => { offStatus(); offConnection(); };
      } else if (!active) {
        stopObserving?.();
        stopObserving = null;
      }
      void writer.foreground(active);
    };
    foreground(AppState.currentState === "active");
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" || state === "background") foreground(state === "active");
    });

    return () => {
      disposed = true;
      writer.dispose();
      stopObserving?.();
      subscription.remove();
    };
  }, [authStatus, bindingId, bindings, client, ready]);

  return null;
}
