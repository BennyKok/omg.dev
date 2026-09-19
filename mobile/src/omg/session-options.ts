/**
 * Owns the composer agent, model, effort, account and project choices.
 * Availability comes from the selected machine. Saved model and effort
 * choices are validated against its catalog before use.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supportsFastMode } from "../../../packages/protocol/src/fast-mode-support";
import { STORAGE_KEYS } from "./config";

import { preferredAgent } from "./agent-default";
import { agentIcon, agentLabel as agentDisplayName } from "./agent-icons";
import { type MenuOption } from "./menu";
import { useOmg, type CodingAgent, type Repo } from "./provider";
import { basename, projectKey, sessionMatchesProject } from "./project-filter";

/**
 * The agent used when the roster has not arrived yet, matching what the server
 * picks for a request that names none (verified in lfg's serve.ts: anything
 * unrecognised falls through to "aisdk"). So the avatar shown before bootstrap
 * lands is the agent that would actually run.
 */
export const DEFAULT_AGENT = "aisdk";

/**
 * How often, and how many times, a failed catalog fetch is tried again.
 *
 * Bounded on purpose. A box that is merely slow to wake answers well inside
 * this; a box whose build has no `/api/coding-agents` answers 404 every time,
 * and polling it forever would burn battery to learn the same thing.
 */
const CATALOG_RETRY_MS = 3000;
const CATALOG_RETRIES = 4;


type ModelCatalogEntry = {
  key: string;
  defaultModel?: string;
  models?: string[];
  /** e.g. low | medium | high | xhigh. Per agent, and not every agent has any. */
  thinkingLevels?: string[];
};

/** One Claude login on the box. Mirrors ClaudeAccount in src/claude-accounts.ts. */
export type ClaudeAccountRow = {
  id: string;
  number: number;
  label: string;
  profile?: { label: string; detail?: string };
  connected: boolean;
  needsReconnect?: boolean;
};

export function useAgentPicker(init: { initialAgent?: string | null } = {}) {
  const { agents, bindingId, client, readiness } = useOmg();
  const { initialAgent } = init;
  /**
   * NOTHING IS FETCHED UNTIL THE BOX ANSWERS, AND A FAILED FETCH RETRIES.
   *
   * Both requests below used to fire on `client` alone. `client` exists the
   * moment `bindingId` is restored from AsyncStorage, which is before sign-in
   * resolves and long before the box is awake. So on a cold or hibernating
   * Computer they went out first, got 425 "waking" or a grant error, hit their
   * `.catch`, and set an empty list. Their only dependency was `client`, whose
   * only dependency is `bindingId`, so they never ran again: the box woke, the
   * agent icon row filled in from readiness, and the model list stayed empty
   * for the rest of the app session. That is the "model list and the rest is
   * not loading" report, 2026-09-19.
   *
   * `waitForReady` already retries 425 for the bootstrap probe. These two are
   * separate requests and got none of that. Gate them on the same readiness
   * the roster comes from, so they go out when the box can answer, and retry a
   * bounded number of times so a transient 502 mid-resume is not permanent
   * either.
   */
  const ready = readiness?.status === "ready";
  const [fetchAttempt, setFetchAttempt] = useState(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearRetry = useCallback(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
  }, []);
  /** Both fetches share one timer, so a double failure schedules one retry. */
  const retryLater = useCallback(() => {
    if (retryTimer.current) return;
    retryTimer.current = setTimeout(() => {
      retryTimer.current = null;
      setFetchAttempt((n) => (n >= CATALOG_RETRIES ? n : n + 1));
    }, CATALOG_RETRY_MS);
  }, []);
  // A machine switch starts the retry budget over: the new box has its own
  // catalog and its own chance to be asleep.
  useEffect(() => {
    clearRetry();
    setFetchAttempt(0);
  }, [bindingId, clearRetry]);
  useEffect(() => clearRetry, [clearRetry]);
  const [chosen, setChosen] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [fast, setFast] = useState(false);
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
  /** Account identity stays internal; the compact picker shows stable numbers. */
  const [claudeAccounts, setClaudeAccounts] = useState<ClaudeAccountRow[]>([]);
  const [claudeAccount, setClaudeAccount] = useState<string | null>(null);

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

  useEffect(() => {
    if (!client || !ready) return;
    let cancelled = false;
    void client.transport
      .request<{ accounts?: ClaudeAccountRow[] }>("/api/coding-agents/claude/accounts")
      .then((res) => {
        if (cancelled) return;
        setClaudeAccounts(res?.accounts ?? []);
      })
      .catch(() => {
        // A box that cannot answer has nothing to choose between. The picker
        // hides itself rather than showing an empty or broken section -- but
        // it asks again, because "cannot answer yet" is the common case.
        if (cancelled) return;
        setClaudeAccounts([]);
        retryLater();
      });
    return () => { cancelled = true; };
  }, [client, ready, fetchAttempt, retryLater]);

  /**
   * WHICH MODELS EACH AGENT CAN RUN, from the machine's own catalog
   * (`/api/coding-agents` → `models`), because the answer is per box: a fleet
   * that has not upgraded its CLI does not offer what a newer one does, and a
   * list baked into the app would offer models the session would then fail to
   * start with.
   */
  useEffect(() => {
    if (!client || !ready) return;
    let cancelled = false;
    client.transport
      .request<{ models?: ModelCatalogEntry[] }>("/api/coding-agents")
      .then((payload) => {
        if (!cancelled) setCatalog(payload.models ?? []);
      })
      .catch(() => {
        // No catalog means no model submenu — the agent list still works.
        // An empty catalog also drops the remembered model and thinking level
        // (they are validated against it below), so this is worth retrying.
        if (cancelled) return;
        setCatalog([]);
        retryLater();
      });
    return () => {
      cancelled = true;
    };
  }, [client, ready, fetchAttempt, retryLater]);

  // A machine switch cannot keep the previous box's agent: the roster is
  // per-machine, so the old selection may not exist here. Clearing falls back
  // to this box's own first entry rather than 400ing at launch.
  useEffect(() => {
    setChosen(null);
    setClaudeAccount(null);
    setFast(false);
    setModel(null);
    setThinking(null);
  }, [bindingId]);

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
    // A picker opened FROM a session starts on that session's agent, so
    // "Continue with" defaults to continuing as-is and only a real change
    // changes anything.
    const initial = (initialAgent ?? "").trim().toLowerCase();
    if (initial && agents.some((a) => a.key === initial)) return initial;
    return preferredAgent(agents) ?? DEFAULT_AGENT;
  }, [chosen, agents, initialAgent]);

  const label = useMemo(() => labelFor(agent, agents), [agent, agents]);

  /** The rail includes single agents so their profile control stays reachable. */
  const options = useMemo<MenuOption[]>(() => {
    return agents.map((a) => ({
      id: a.key,
      label: labelFor(a.key, agents),
      image: agentIcon(a.key),
      selected: a.key === agent,
      onPress: () => {
        if (a.key === agent) return;
        setChosen(a.key);
        setFast(false);
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
  }, [entry, activeModelName, remember, bindingId, agent]);

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
  }, [entry, activeThinking, remember, bindingId, agent]);

  /** Null means "the box's default", which is what omitting it asks for. */
  const activeModel = useMemo(() => {
    if (model && entry?.models?.includes(model)) return model;
    return null;
  }, [entry, model]);

  /** Auto leaves routing to the server. Explicit profiles must still be usable. */
  const activeAccount = agent === "aisdk"
    ? claudeAccounts.find(a => a.id === claudeAccount && a.connected && !a.needsReconnect) ?? null
    : null;
  const accountOptions = useMemo<MenuOption[]>(() => {
    if (agent !== "aisdk" || claudeAccounts.length < 2) return [];
    return [
      { label: "Auto", selected: !activeAccount, onPress: () => setClaudeAccount(null) },
      ...claudeAccounts.map(account => ({
        id: account.id,
        label: String(account.number),
        selected: account.id === activeAccount?.id,
        disabled: !account.connected || !!account.needsReconnect,
        onPress: () => setClaudeAccount(account.id),
      })),
    ];
  }, [agent, claudeAccounts, activeAccount]);
  const fastAvailable = supportsFastMode(agent, activeModelName);

  return {
    agent,
    fastMode: fastAvailable && fast,
    toggleFast: fastAvailable ? () => setFast(value => !value) : undefined,
    model: activeModel,
    /** What the model pill shows: the choice, or the default it would use. */
    modelLabel: activeModelName,
    modelOptions,
    thinking: activeThinking,
    thinkingLabel: activeThinking
      ? activeThinking.charAt(0).toUpperCase() + activeThinking.slice(1)
      : null,
    thinkingOptions,
    /**
     * Omitted unless actually chosen. The box picks by remaining capacity when
     * it hears nothing (pickClaudeAccountForNewSession), which is a better
     * answer than this app pinning one at random.
     */
    claudeAccountId: activeAccount?.id,
    claudeAccountLabel: activeAccount ? String(activeAccount.number) : null,
    accountOptions,
    label,
    options,
  };
}

function labelFor(key: string, agents: CodingAgent[]): string {
  // The box's own label wins when it has one — it is what the web shows, and
  // it distinguishes the two Claude backends ("claude" for both aisdk and the
  // CLI) the way that surface does.
  // omg is styled as a lower-case wordmark, and its box label ("omg agent")
  // is longer than the row needs. The app's own name wins for this one.
  if (key === "omg") return agentDisplayName(key);
  const fromBox = agents.find((a) => a.key === key)?.label;
  if (fromBox) return fromBox.charAt(0).toUpperCase() + fromBox.slice(1);
  return agentDisplayName(key);
}

export type FolderRow = {
  cwd: string;
  label: string;
  selected: boolean;
  hidden: boolean;
  onPress: () => void;
};

type RailArrangement = { order: string[]; hidden: string[] };

export function useProjectPicker() {
  const { repos, bindings, bindingId, client, probe } = useOmg();
  const [chosen, setChosen] = useState<string | null>(null);
  /**
   * THE RAIL'S ARRANGEMENT, per machine. Order and hidden set of folder
   * cwds, loaded once and written on every change. The machine's own list
   * is the source of which folders EXIST; this only says how to show them.
   */
  const [arrangements, setArrangements] = useState<Record<string, RailArrangement>>({});
  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEYS.folderRail)
      .then((raw) => {
        if (raw) setArrangements(JSON.parse(raw) as Record<string, RailArrangement>);
      })
      .catch(() => {
        // Unreadable: the machine's order stands.
      });
  }, []);
  const railKey = bindingId ?? "none";
  const arrangement = arrangements[railKey] ?? { order: [], hidden: [] };
  const saveArrangement = useCallback(
    (next: RailArrangement) => {
      setArrangements((current) => {
        const all = { ...current, [railKey]: next };
        void AsyncStorage.setItem(STORAGE_KEYS.folderRail, JSON.stringify(all)).catch(() => {
          // The rail still works for this launch.
        });
        return all;
      });
    },
    [railKey],
  );

  useEffect(() => {
    setChosen(null);
  }, [bindingId]);

  const binding = useMemo(
    () => bindings.find((b) => b.id === bindingId) ?? null,
    [bindings, bindingId],
  );

  /**
   * The machine's repos in the rail's order: remembered cwds first, in their
   * remembered order, then anything the machine added since, in its order.
   * A remembered cwd the machine no longer lists is simply skipped.
   */
  const ordered = useMemo(() => {
    const byCwd = new Map(repos.map((r) => [r.cwd, r] as const));
    const head = arrangement.order.map((cwd) => byCwd.get(cwd)).filter((r): r is Repo => !!r);
    const seen = new Set(head.map((r) => r.cwd));
    return [...head, ...repos.filter((r) => !seen.has(r.cwd))];
  }, [repos, arrangement.order]);
  const hiddenSet = useMemo(() => new Set(arrangement.hidden), [arrangement.hidden]);
  const visible = useMemo(() => ordered.filter((r) => !hiddenSet.has(r.cwd)), [ordered, hiddenSet]);

  /**
   * One folder owns both the list and the next session. There is no unscoped
   * state: an explicit pick wins, then the machine default, then the first
   * folder the rail shows.
   */
  const cwd = useMemo(() => {
    if (chosen && repos.some((r) => r.cwd === chosen)) return chosen;
    const fallback = binding?.defaultFolder ?? null;
    if (fallback && visible.some((r) => r.cwd === fallback)) return fallback;
    return visible[0]?.cwd ?? repos[0]?.cwd ?? fallback;
  }, [chosen, repos, visible, binding]);

  const label = useMemo(() => {
    if (!cwd) return null;
    return repos.find((r) => r.cwd === cwd)?.name ?? basename(cwd);
  }, [cwd, repos]);

  const activeProject = useMemo(
    () => repos.find((r) => r.cwd === cwd) ?? null,
    [cwd, repos],
  );
  const activeFilter = activeProject ? projectKey(activeProject) : null;

  const matches = useCallback(
    (session: { project?: string; cwd?: string }) => sessionMatchesProject(session, activeFilter),
    [activeFilter],
  );

  const options = useMemo<MenuOption[]>(
    () =>
      visible.map((r) => ({
        label: r.name || basename(r.cwd),
        selected: cwd === r.cwd,
        onPress: () => {
          setChosen(r.cwd);
        },
      })),
    [visible, cwd],
  );

  /** Every folder the machine has, in rail order, hidden ones included — for the arrangement sheet. */
  const folders = useMemo<FolderRow[]>(
    () =>
      ordered.map((r) => ({
        cwd: r.cwd,
        label: r.name || basename(r.cwd),
        selected: cwd === r.cwd,
        hidden: hiddenSet.has(r.cwd),
        onPress: () => setChosen(r.cwd),
      })),
    [ordered, cwd, hiddenSet],
  );

  const move = useCallback(
    (target: string, delta: -1 | 1) => {
      const order = ordered.map((r) => r.cwd);
      const at = order.indexOf(target);
      const to = at + delta;
      if (at < 0 || to < 0 || to >= order.length) return;
      order.splice(at, 1);
      order.splice(to, 0, target);
      saveArrangement({ order, hidden: arrangement.hidden });
    },
    [ordered, arrangement.hidden, saveArrangement],
  );

  /** The whole order at once, from a drag. Unknown cwds are dropped; missing ones are appended by `ordered`. */
  const setOrder = useCallback(
    (cwds: string[]) => saveArrangement({ order: cwds, hidden: arrangement.hidden }),
    [arrangement.hidden, saveArrangement],
  );

  const setHidden = useCallback(
    (target: string, hidden: boolean) => {
      const next = new Set(arrangement.hidden);
      if (hidden) next.add(target);
      else next.delete(target);
      saveArrangement({ order: ordered.map((r) => r.cwd), hidden: [...next] });
    },
    [ordered, arrangement.hidden, saveArrangement],
  );

  /**
   * Register an existing folder on the machine (git init if it is not a
   * repo yet), then re-probe so the roster carries it. Same endpoint the
   * web's project sheet uses.
   */
  const addFolder = useCallback(
    async (path: string) => {
      if (!client) throw new Error("No machine selected");
      await client.transport.request("/api/projects/use-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
      await probe();
      setChosen(path);
    },
    [client, probe],
  );

  /** Where a brand-new project goes: beside the first folder the machine lists. */
  const projectsRoot = useMemo(() => {
    const first = repos[0]?.cwd;
    if (!first) return null;
    const parts = first.split("/").filter(Boolean);
    parts.pop();
    return "/" + parts.join("/");
  }, [repos]);

  /** mkdir + git init + first commit + register, then re-probe. Returns the new cwd. */
  const createFolder = useCallback(
    async (name: string): Promise<string> => {
      if (!client) throw new Error("No machine selected");
      if (!projectsRoot) throw new Error("This machine has no projects folder yet");
      const res = await client.transport.request<{ path?: string; cwd?: string; repo?: { cwd?: string } }>(
        "/api/projects/create-folder",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parent: projectsRoot, name }),
        },
      );
      const created = res?.path ?? res?.cwd ?? res?.repo?.cwd ?? `${projectsRoot}/${name}`;
      await probe();
      setChosen(created);
      return created;
    },
    [client, probe, projectsRoot],
  );

  return {
    cwd,
    label,
    options,
    matches,
    filter: activeFilter,
    folders,
    move,
    setOrder,
    setHidden,
    addFolder,
    createFolder,
    projectsRoot,
  };
}

/** A repo's project key — see the note in useProjectPicker. */

