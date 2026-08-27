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
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useState } from "react";

import { STORAGE_KEYS } from "./config";

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

type ModelCatalogEntry = {
  key: string;
  defaultModel?: string;
  models?: string[];
  /** e.g. low | medium | high | xhigh. Per agent, and not every agent has any. */
  thinkingLevels?: string[];
};

/**
 * THREE CONTROLS, NOT ONE. Which agent, which model, how hard it should think.
 *
 * These were one menu with the models nested behind each agent, and nesting is
 * what broke it: a submenu row cannot carry a brand mark (UIKit draws the open
 * submenu's header from the image at its own size, which produced an ~80pt
 * slab), and press-and-drag — the gesture iOS menus are built around, where
 * you hold the control, slide onto a row and release — does not survive a
 * sideways step into a second layer.
 *
 * So each question gets its own control, and every menu is ONE layer. The
 * agent keeps its marks, the drag gesture works everywhere, and thinking —
 * which the machine has always accepted on `/api/sessions/new` and this app
 * has never offered — finally has somewhere to live.
 */
export function useAgentPicker() {
  const { agents, bindingId, client } = useOmg();
  const [chosen, setChosen] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [thinking, setThinking] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalogEntry[]>([]);
  /**
   * WHAT WAS CHOSEN LAST TIME, PER MACHINE AND AGENT.
   *
   * The original rule here was that nothing persists, because a stored choice
   * can name something the current box no longer offers. That is a real
   * hazard and the wrong conclusion: it made every launch forget how you work,
   * and on a phone you are relaunching this app twenty times a day. The hazard
   * is answered by VALIDATING against the catalog on the way out — an unknown
   * model or level is dropped — not by refusing to remember.
   */
  const [saved, setSaved] = useState<Record<string, { model?: string; thinking?: string }>>({});
  const [savedLoaded, setSavedLoaded] = useState(false);

  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEYS.composerSetup)
      .then((raw) => {
        if (raw) setSaved(JSON.parse(raw) as typeof saved);
      })
      .catch(() => {
        // Corrupt or absent: start fresh rather than blocking the composer.
      })
      .finally(() => setSavedLoaded(true));
  }, []);

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
    setThinking(null);
  }, [bindingId]);

  const setupKey = `${bindingId ?? "none"}:${chosen ?? "default"}`;

  /** Remember a choice for this machine and agent. */
  const remember = useCallback(
    (patch: { model?: string | null; thinking?: string | null }, key: string) => {
      setSaved((current) => {
        const entry = { ...current[key] };
        if (patch.model !== undefined) {
          if (patch.model === null) delete entry.model;
          else entry.model = patch.model;
        }
        if (patch.thinking !== undefined) {
          if (patch.thinking === null) delete entry.thinking;
          else entry.thinking = patch.thinking;
        }
        const next = { ...current, [key]: entry };
        void AsyncStorage.setItem(STORAGE_KEYS.composerSetup, JSON.stringify(next)).catch(() => {
          // A composer that cannot write its preference still works.
        });
        return next;
      });
    },
    [],
  );

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
    // ONE LAYER, WITH MARKS. Every row is a leaf, so each keeps the brand mark
    // that makes this menu scannable, and a press-and-drag reaches all of them.
    return agents.map((a) => ({
      label: labelFor(a.key, agents),
      image: agentIcon(a.key),
      selected: a.key === agent,
      onPress: () => {
        setChosen(a.key);
        // The model and the thinking level belong to the agent that runs them;
        // carrying a Claude model across to Codex would name something that
        // agent cannot run.
        setModel(null);
        setThinking(null);
      },
    }));
  }, [agents, agent]);

  const entry = useMemo(() => catalog.find((m) => m.key === agent), [catalog, agent]);

  /**
   * Restore last time's choices once BOTH the store and the catalog have
   * answered. Validated on the way in: a model or a level this box does not
   * offer is dropped rather than sent, which is the whole reason it was safe
   * to start persisting these at all.
   */
  useEffect(() => {
    if (!savedLoaded || !entry) return;
    const remembered = saved[`${bindingId ?? "none"}:${agent}`];
    if (!remembered) return;
    if (remembered.model && entry.models?.includes(remembered.model)) {
      setModel((current) => current ?? remembered.model ?? null);
    }
    if (remembered.thinking && entry.thinkingLevels?.includes(remembered.thinking)) {
      setThinking((current) => current ?? remembered.thinking ?? null);
    }
    // `saved` is deliberately not a dependency: this restores ONCE per agent,
    // and re-running it on every write would fight the user's next change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedLoaded, entry, agent, bindingId]);

  /** The model this session will start with, resolved against the box's list. */
  const activeModelName = useMemo(() => {
    const models = entry?.models ?? [];
    if (model && models.includes(model)) return model;
    return entry?.defaultModel ?? models[0] ?? null;
  }, [entry, model]);

  const modelOptions = useMemo<MenuOption[]>(() => {
    const models = entry?.models ?? [];
    if (models.length < 2) return [];
    // No icons: these are strings the box reported, not things with faces, and
    // one icon in a menu indents every other label to make room for a gutter.
    return models.map((m) => ({
      label: m,
      selected: m === activeModelName,
      onPress: () => {
        setModel(m);
        remember({ model: m }, `${bindingId ?? "none"}:${agent}`);
      },
    }));
  }, [entry, activeModelName]);

  /**
   * THE LEVEL IS ALWAYS SOMETHING, and the pill always says what.
   *
   * This used to fall back to null and the pill read "Thinking" — a control
   * naming its own topic rather than its value, which tells you nothing about
   * what the next session will actually do. The machine has a default of its
   * own, but it does not publish it (`/api/coding-agents` lists the levels and
   * no default), so the app cannot echo it and must not invent a fact.
   *
   * "Medium" is the honest middle: every agent this box reports offers it, it
   * is what a person means by "normal", and it is now a real choice we send
   * rather than a blank we omit. Anything else the box offers is one tap away
   * and remembered afterwards.
   */
  const activeThinking = useMemo(() => {
    const levels = entry?.thinkingLevels ?? [];
    if (!levels.length) return null;
    if (thinking && levels.includes(thinking)) return thinking;
    if (levels.includes("medium")) return "medium";
    return levels[Math.floor(levels.length / 2)] ?? null;
  }, [entry, thinking]);

  const thinkingOptions = useMemo<MenuOption[]>(() => {
    const levels = entry?.thinkingLevels ?? [];
    if (levels.length < 2) return [];
    // No "Default" row: the pill now always shows a real level, so a row that
    // means "whatever the box decides" would be a second answer to a question
    // that already has one.
    return [
      ...levels.map((level) => ({
        label: level.charAt(0).toUpperCase() + level.slice(1),
        selected: activeThinking === level,
        onPress: () => {
          setThinking(level);
          remember({ thinking: level }, `${bindingId ?? "none"}:${agent}`);
        },
      })),
    ];
  }, [entry, activeThinking]);

  /** Null means "the box's default", which is what omitting it asks for. */
  const activeModel = useMemo(() => {
    if (model && entry?.models?.includes(model)) return model;
    return null;
  }, [entry, model]);

  return {
    agent,
    model: activeModel,
    /** What the model pill shows: the choice, or the default it would use. */
    modelLabel: activeModelName,
    modelOptions,
    thinking: activeThinking,
    thinkingLabel: activeThinking
      ? activeThinking.charAt(0).toUpperCase() + activeThinking.slice(1)
      : null,
    thinkingOptions,
    label,
    options,
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
              // NO ICON. The repo rows below it have none — they are folders
              // this box happens to have, not things with symbols — and a menu
              // where ONE row carries an icon indents every other label to
              // make room for a gutter nothing else uses.
              label: "All projects",
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

  /**
   * Exposed so the LIST can scope itself, not just the composer's pill.
   *
   * The folder heading on the home screen is the natural place to say "only
   * this one" — it is already naming the group it would narrow to. Until now
   * scoping lived solely on the composer pill, which is a control about where
   * the NEXT session runs, so narrowing the list meant reaching for a widget
   * that describes something else.
   */
  return { cwd, label: filterLabel, options, matches, filter: activeFilter, setFilter };
}

/** A repo's project key — see the note in useProjectPicker. */
function projectKey(repo: { name: string; cwd: string }): string {
  return repo.name || basename(repo.cwd);
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}
