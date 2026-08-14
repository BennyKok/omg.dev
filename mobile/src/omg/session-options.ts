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
import { useCallback, useEffect, useMemo, useState } from "react";

import { agentIcon, agentLabel as agentDisplayName } from "./agent-icons";
import { type MenuOption } from "./menu";
import { useOmg, type CodingAgent } from "./provider";

/**
 * The agent used when the roster has not arrived yet, matching what the server
 * picks for a request that names none (verified in lfg's serve.ts: anything
 * unrecognised falls through to "aisdk"). So the avatar shown before bootstrap
 * lands is the agent that would actually run.
 */
export const DEFAULT_AGENT = "aisdk";

type ModelCatalogEntry = { key: string; defaultModel?: string; models?: string[] };

export function useAgentPicker() {
  const { agents, bindingId, client } = useOmg();
  const [chosen, setChosen] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);

  /**
   * WHICH MODELS EACH AGENT CAN RUN, from the machine's own catalog
   * (`/api/coding-agents` → `models`), because the answer is per box: a fleet
   * that has not upgraded its CLI does not offer what a newer one does, and a
   * list baked into the app would offer models the session would then fail to
   * start with.
   */
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client.transport
      .request<{ models?: ModelCatalogEntry[] }>("/api/coding-agents")
      .then((payload) => {
        if (!cancelled) setCatalog(payload.models ?? []);
      })
      .catch(() => {
        // No catalog means no model submenu — the agent list still works.
        if (!cancelled) setCatalog([]);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  // A machine switch cannot keep the previous box's agent: the roster is
  // per-machine, so the old selection may not exist here. Clearing falls back
  // to this box's own first entry rather than 400ing at launch.
  useEffect(() => {
    setChosen(null);
    setModel(null);
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

  /**
   * One choice is not a choice. An empty list lets the composer render the
   * control as plain text with no chevron, rather than a menu with a single
   * row in it — and it is why these hooks hand back OPTIONS rather than an
   * `open()`: the menu is anchored to the control, so the control is what
   * renders it. See ./menu.tsx.
   */
  /**
   * The agent list, and each agent's models BEHIND it as a submenu.
   *
   * One control, two decisions: the models live inside the agent that runs
   * them, so picking "Codex → gpt-5.6-sol" is one gesture and there is no
   * second picker on the composer that could end up naming a model the current
   * agent cannot run. Choosing a model chooses its agent too, which is the
   * only reading of that tap that makes sense.
   */
  const options = useMemo<MenuOption[]>(() => {
    if (agents.length < 2) return [];
    return agents.map((a) => {
      const entry = catalog.find((m) => m.key === a.key);
      const models = entry?.models ?? [];
      const current = a.key === agent ? (model ?? entry?.defaultModel ?? null) : null;
      return {
        label: labelFor(a.key, agents),
        // The same mark the avatar and every session row already draw for this
        // agent. A menu of nine names is a list; a menu of nine marks is the
        // thing you were already looking at.
        image: agentIcon(a.key),
        selected: a.key === agent,
        onPress: () => {
          setChosen(a.key);
          setModel(null);
        },
        submenu: models.length
          ? models.map((m) => ({
              label: m,
              selected: a.key === agent && current === m,
              onPress: () => {
                setChosen(a.key);
                setModel(m);
              },
            }))
          : undefined,
      };
    });
  }, [agents, agent, catalog, model]);

  /** Null means "the box's default", which is what omitting it asks for. */
  const activeModel = useMemo(() => {
    const entry = catalog.find((m) => m.key === agent);
    if (model && entry?.models?.includes(model)) return model;
    return null;
  }, [catalog, agent, model]);

  return { agent, model: activeModel, label, options };
}

function labelFor(key: string, agents: CodingAgent[]): string {
  // The box's own label wins when it has one — it is what the web shows, and
  // it distinguishes the two Claude backends ("claude" for both aisdk and the
  // CLI) the way that surface does.
  const fromBox = agents.find((a) => a.key === key)?.label;
  if (fromBox) return fromBox.charAt(0).toUpperCase() + fromBox.slice(1);
  return agentDisplayName(key);
}

/** The web's sentinel for "do not filter" (see `projectFilter` in App.tsx). */
export const ALL_PROJECTS = "__all";

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

  /**
   * THE FOLDER IS ALSO THE FILTER, as it is on the web.
   *
   * A phone showing every session on the machine shows work from repos you are
   * not looking at — and worse, things that are not sessions at all: a stray
   * `claude auth login` sitting in the home directory is reported as a session
   * called "dev", and the web never showed it because its project was not the
   * one being filtered on. The list follows the folder now, and "All projects"
   * is there for when it should not.
   *
   * The project KEY is the repo's name: the server derives a session's
   * `project` from the top folder of its worktree owner, which is that same
   * name — so a session running in a per-session worktree still matches the
   * repo it belongs to, which is the whole reason to match on the key rather
   * than on `cwd`.
   */
  const [filter, setFilter] = useState<string>(ALL_PROJECTS);

  // A filter naming a repo this machine no longer lists would hide everything
  // with no way back, so it falls open.
  const activeFilter = useMemo(
    () =>
      filter !== ALL_PROJECTS && repos.some((r) => projectKey(r) === filter)
        ? filter
        : ALL_PROJECTS,
    [filter, repos],
  );

  const matches = useCallback(
    (session: { project?: string; cwd?: string }) => {
      if (activeFilter === ALL_PROJECTS) return true;
      if (session.project) return session.project === activeFilter;
      return !!session.cwd && basename(session.cwd) === activeFilter;
    },
    [activeFilter],
  );

  const options = useMemo<MenuOption[]>(
    () =>
      repos.length
        ? [
            {
              label: "All projects",
              icon: "square.grid.2x2",
              selected: activeFilter === ALL_PROJECTS,
              onPress: () => {
                setFilter(ALL_PROJECTS);
                setChosen(null);
              },
            },
            ...repos.map((r) => ({
              label: r.name || basename(r.cwd),
              selected: activeFilter === projectKey(r),
              onPress: () => {
                // One pick does both jobs: it scopes the list AND says where
                // the next session runs. Two controls for one folder would be
                // two things to keep in agreement.
                setFilter(projectKey(r));
                setChosen(r.cwd);
              },
            })),
          ]
        : [],
    [repos, activeFilter],
  );

  const filterLabel = activeFilter === ALL_PROJECTS ? "All projects" : activeFilter;

  return { cwd, label: filterLabel, options, matches, filter: activeFilter };
}

/** A repo's project key — see the note in useProjectPicker. */
function projectKey(repo: { name: string; cwd: string }): string {
  return repo.name || basename(repo.cwd);
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}
