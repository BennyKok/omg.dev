/**
 * The two choices a new session needs besides the prompt: WHICH AGENT runs it,
 * and WHICH FOLDER it runs in.
 *
 * Both were previously unmakeable. `agent` was omitted from
 * POST /api/sessions/new so the box always picked its default, and `cwd` was
 * always the machine's `defaultFolder` — the composer printed that folder as a
 * caption but offered no way to change it. On a product whose whole premise is
 * "which agent, on which project", neither question could be answered from the
 * phone.
 *
 * Both live here together, in the same shape, deliberately. They are the same
 * kind of decision — a short list of alternatives, one currently selected —
 * and giving them one module means the selection rules (what is offered, what
 * happens when the roster is empty, how the current choice is marked) cannot
 * drift into two slightly different answers.
 *
 * Selections are per-machine and are NOT persisted. Agents are configured on
 * the box and folders exist on its disk, so a choice restored from storage
 * could easily name something the current machine does not have — which would
 * be a 400 at launch, discovered only after typing a prompt. The roster is the
 * only authority, so the default is derived from it every time.
 */
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useState } from "react";

import { agentLabel as agentDisplayName } from "./agent-icons";
import { showActionMenu, type MenuAction } from "./native-menu";
import { useOmg, type CodingAgent } from "./provider";

/**
 * The agent used when the roster has not arrived yet, matching what the server
 * picks for a request that names none (verified in lfg's serve.ts: anything
 * unrecognised falls through to "aisdk"). So the avatar shown before bootstrap
 * lands is the agent that would actually run.
 */
export const DEFAULT_AGENT = "aisdk";

export function useAgentPicker() {
  const { agents, bindingId } = useOmg();
  const [chosen, setChosen] = useState<string | null>(null);

  // A machine switch cannot keep the previous box's agent: the roster is
  // per-machine, so the old selection may not exist here. Clearing falls back
  // to this box's own first entry rather than 400ing at launch.
  useEffect(() => {
    setChosen(null);
  }, [bindingId]);

  /**
   * The selection, resolved against what this box can actually run. A chosen
   * agent that is no longer in the roster (turned off in Settings, or an
   * account disconnected while the app was open) is dropped rather than
   * offered — it would fail at launch.
   */
  const agent = useMemo(() => {
    if (chosen && agents.some((a) => a.key === chosen)) return chosen;
    return agents[0]?.key ?? DEFAULT_AGENT;
  }, [chosen, agents]);

  const label = useMemo(() => labelFor(agent, agents), [agent, agents]);

  const open = useCallback(() => {
    if (agents.length < 2) return;
    showActionMenu(
      "Run with",
      agents.map<MenuAction>((a) => ({
        label: `${a.key === agent ? "✓ " : ""}${labelFor(a.key, agents)}`,
        onPress: () => {
          void Haptics.selectionAsync();
          setChosen(a.key);
        },
      })),
    );
  }, [agents, agent]);

  return {
    agent,
    label,
    // One choice is not a choice. Returning undefined lets the composer render
    // the caption as plain text with no chevron, rather than a control that
    // opens a sheet with a single row in it.
    open: agents.length > 1 ? open : undefined,
  };
}

function labelFor(key: string, agents: CodingAgent[]): string {
  // The box's own label wins when it has one — it is what the web shows, and
  // it distinguishes the two Claude backends ("claude" for both aisdk and the
  // CLI) the way that surface does.
  const fromBox = agents.find((a) => a.key === key)?.label;
  if (fromBox) return fromBox.charAt(0).toUpperCase() + fromBox.slice(1);
  return agentDisplayName(key);
}

export function useProjectPicker() {
  const { repos, bindings, bindingId } = useOmg();
  const [chosen, setChosen] = useState<string | null>(null);

  useEffect(() => {
    setChosen(null);
  }, [bindingId]);

  const binding = useMemo(
    () => bindings.find((b) => b.id === bindingId) ?? null,
    [bindings, bindingId],
  );

  /**
   * Resolution order: an explicit pick, else the machine's own default folder,
   * else the box's first project. The machine default comes second rather than
   * first so that choosing a folder actually sticks — and it is only used when
   * the box confirms that folder exists in its list, since a stale
   * `defaultFolder` on the binding row would otherwise send every session to a
   * path that is no longer there.
   */
  const cwd = useMemo(() => {
    if (chosen && repos.some((r) => r.cwd === chosen)) return chosen;
    const fallback = binding?.defaultFolder ?? null;
    if (fallback && repos.some((r) => r.cwd === fallback)) return fallback;
    return repos[0]?.cwd ?? fallback;
  }, [chosen, repos, binding]);

  const label = useMemo(() => {
    if (!cwd) return null;
    return repos.find((r) => r.cwd === cwd)?.name ?? basename(cwd);
  }, [cwd, repos]);

  const open = useCallback(() => {
    if (repos.length < 2) return;
    showActionMenu(
      "Run in",
      repos.map<MenuAction>((r) => ({
        label: `${r.cwd === cwd ? "✓ " : ""}${r.name || basename(r.cwd)}`,
        onPress: () => {
          void Haptics.selectionAsync();
          setChosen(r.cwd);
        },
      })),
    );
  }, [repos, cwd]);

  return { cwd, label, open: repos.length > 1 ? open : undefined };
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}
