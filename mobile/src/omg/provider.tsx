import { clearPendingSessions } from "./pending-session";
import { sessionCache } from "./session-cache-store";
import { clearTranscriptCache } from "./transcript-cache";
/**
 * The app's single source of truth for "who am I, which Computer, and is it up".
 *
 * Screens never build a transport or mint a grant themselves. They ask for the
 * client. The grant cache and the live socket are module-scope singletons in
 * transport.ts precisely because a hook shares code, never state — the web app
 * shipped the other version of this and paid for it with five concurrent /token
 * mints on every cold open.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { OmgClient } from "@omg-dev/client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { AppState, StyleSheet, View } from "react-native";

import { CLOUD_BINDING_ID, CONTROLPLANE_ORIGIN, STORAGE_KEYS } from "./config";
import { getAuthToken, getSession, signOut as authSignOut, type SignedInUser } from "./auth";
import { DEMO_BINDING, DEMO_USER, isDemoMode } from "./demo";
import { forgetAllTransports, getHostedTransport } from "./transport";
import { registerSessionRefResolver } from "./session-ref-link";
import { unregisterForPushNotifications } from "./push";
import { useUserActive } from "./idle";
import { startCloudPresence } from "./presence";
import { wakeAfterPresence } from "./cloud-startup";
import { sharedReadiness, type ComputerReadiness } from "./readiness";
import {
  isSharedBindingId,
  SHARED_REVOKED_DETAIL,
  sharedBindingId,
  sharedComputerMachineIdentity,
  sharedComputerOwnerLabel,
  type SharedComputerView,
} from "./computer-shared-binding";

export type ComputerBinding = {
  id: string;
  name?: string | null;
  boxId?: string;
  online?: boolean;
  lastSeenAt?: number | null;
  defaultFolder?: string | null;
  computerUrl?: string | null;
};

/**
 * A machine somebody else shared with this account, presented as an ordinary
 * binding so it can flow through the same transport cache, grant mint and
 * picker rows as one of the account's own. `id` is the opaque
 * `shared:<ownerUserId>:<bindingId>` spelling from computer-shared-binding.ts
 * — everything downstream keys on that one string.
 *
 * Never synthesized with a `computerUrl`: a guest never gets the owner's
 * direct box URL, only the session proxy (which is what actually authorized
 * them) knows how to reach it.
 */
export type SharedComputerBinding = Omit<ComputerBinding, "name"> & {
  shared: true;
  ownerUserId: string;
  /** The owner's raw binding id, for a unique tail when titles collide. */
  ownerBindingId: string;
  /** The owner's name, or their email if they have none set. */
  ownerLabel: string;
  /** Display name when they have one. Never an email. */
  ownerName?: string;
  email: string;
  /** Hostname / machine name when the share row named the box. */
  machineLabel?: string;
};

function toSharedBinding(computer: SharedComputerView): SharedComputerBinding {
  const ownerLabel = sharedComputerOwnerLabel(computer);
  const ownerName = computer.name?.trim();
  return {
    id: sharedBindingId(computer.ownerUserId, computer.bindingId),
    online: computer.online ?? true,
    lastSeenAt: null,
    defaultFolder: computer.defaultFolder ?? computer.binding?.defaultFolder ?? null,
    computerUrl: null,
    shared: true,
    ownerUserId: computer.ownerUserId,
    ownerBindingId: computer.bindingId,
    ownerLabel,
    ownerName: ownerName && !ownerName.includes("@") ? ownerName : undefined,
    email: computer.email,
    machineLabel: sharedComputerMachineIdentity(computer),
  };
}

/**
 * What the SELECTED box can run and where. Read from /api/bootstrap, which is
 * the same one round trip the web takes, rather than /api/agents (auto agents,
 * a different thing entirely) plus /api/repos as two calls.
 *
 * This has to be per-machine state, not global: agents are configured on the
 * box and folders exist on its disk, so it is invalidated whenever bindingId
 * changes. Caching it across a switch would offer you a project that does not
 * exist on the machine you are now pointed at.
 */
export type CodingAgent = {
  key: string;
  label: string;
  visible?: boolean;
  status?: { configured?: boolean; accountConnected?: boolean };
};

/**
 * `name` is the label a person sees and can rename. `project` is the key the
 * box stamps onto every session started in this folder, and it is what the
 * session filter must compare against -- see `project-filter.ts`. Optional
 * only because an older box may not send it.
 */
export type Repo = { name: string; cwd: string; project?: string };

/** Shape returned by control-plane getCloudComputer. */
export type CloudComputer = {
  name?: string | null;
  status?: string;
  blockedReason?: string | null;
  instanceId?: string | null;
  plan?: string | null;
  machine?: { vcpus?: number; memoryMib?: number; diskGib?: number; alwaysOn?: boolean };
};

type AuthStatus = "loading" | "signed-out" | "signed-in";

type OmgContextValue = {
  authStatus: AuthStatus;
  user: SignedInUser | null;
  /** Re-read the session after a successful sign-in. */
  refreshSession: () => Promise<void>;
  signOut: () => Promise<void>;

  bindings: ComputerBinding[];
  /**
   * Machines OTHER people shared with this account. Never present in
   * `bindings` — relay only ever reports machines you own — so every
   * consumer that used to just read `bindings` for "everything I can pick"
   * needs to read this alongside it now.
   */
  sharedComputers: SharedComputerBinding[];
  cloud: CloudComputer | null;
  machinesLoading: boolean;
  /** The computer list has been answered at least once. See the state below. */
  machinesLoaded: boolean;
  machinesError: string | null;
  refreshMachines: () => Promise<void>;

  /** Currently selected machine, or null until one is chosen//restored. */
  bindingId: string | null;
  selectBinding: (id: string) => Promise<void>;

  /** Client for the selected machine. Null until a machine is selected. */
  client: OmgClient | null;
  readiness: ComputerReadiness | null;
  /** Re-probe /api/bootstrap, waiting out a wake. */
  probe: () => Promise<void>;

  /**
   * The selected box's roster. Empty until a bootstrap lands, and cleared on
   * every machine switch — see the type note above for why it cannot be
   * shared across machines.
   */
  agents: CodingAgent[];
  repos: Repo[];
  /**
   * Ask the box to re-query every provider for its model list, then tell
   * every model picker to read the new catalog. Throws when the box fails.
   */
  refreshModels: () => Promise<void>;
  /** Bumped after each successful refreshModels. Pickers refetch on change. */
  modelsVersion: number;
  /**
   * Reinstall every installed agent CLI on the box and wait for it to finish.
   * The box refreshes the model catalog itself at the end. Throws when the
   * box refuses or does not have the route yet.
   */
  updateAllAgents: () => Promise<void>;
};

const Context = createContext<OmgContextValue | null>(null);

export async function controlPlane<T>(name: string, body: unknown = {}): Promise<T> {
  const token = await getAuthToken();
  if (!token) throw new Error("Please sign in again.");
  const response = await fetch(`${CONTROLPLANE_ORIGIN}/api/computer/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text().catch(() => "");
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    throw new Error(data?.error ?? `${name} failed (${response.status})`);
  }
  return data as T;
}

export function OmgProvider({ children }: PropsWithChildren) {
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<SignedInUser | null>(null);

  const [bindings, setBindings] = useState<ComputerBinding[]>([]);
  const [sharedComputers, setSharedComputers] = useState<SharedComputerBinding[]>([]);
  const [cloud, setCloud] = useState<CloudComputer | null>(null);
  const [machinesLoading, setMachinesLoading] = useState(false);
  /**
   * The machine list has been answered at least once — which is NOT the same
   * as it being non-empty, and not the same as `!machinesLoading` either
   * (that is also false in the moment before the first request goes out). The
   * launch screen needs to know the difference between "no computers" and
   * "not asked yet"; without it the app flashed "No computer selected" at
   * every cold start.
   */
  const [machinesLoaded, setMachinesLoaded] = useState(false);
  const [machinesError, setMachinesError] = useState<string | null>(null);

  const [bindingId, setBindingId] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<ComputerReadiness | null>(null);

  const refreshSession = useCallback(async () => {
    /*
     * "loading" only when there is no answer on screen yet (a cold start) or
     * the account may be changing. A refresh right after signing in keeps the
     * signed-out screen up, busy button and all, until the session answers:
     * dropping to "loading" there put the splash in the middle of onboarding
     * for as long as `get-session` took. Benny, 2026-09-24: no splash inside
     * the flow.
     */
    setAuthStatus((current) => (current === "signed-out" ? current : "loading"));
    // Demo mode is signed into a fixed fake account, and never touches the
    // real auth jar. See demo.ts.
    const found = isDemoMode() ? DEMO_USER : await getSession();
    clearTranscriptCache();
    await sessionCache.open(found?.id ?? null, AsyncStorage);
    const savedBinding = sessionCache.read<string>("binding");
    setBindingId(typeof savedBinding === "string" ? savedBinding : null);
    setUser(found);
    setAuthStatus(found ? "signed-in" : "signed-out");
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const refreshMachines = useCallback(async () => {
    const epoch = sessionCache.epoch;
    // Demo mode owns exactly one machine and never calls the control plane.
    // The auto-select effect below then picks it, its transport is the seeded
    // one, and the readiness probe reads "ready" off the fixtures.
    if (isDemoMode()) {
      setBindings([DEMO_BINDING]);
      setSharedComputers([]);
      setCloud(null);
      setMachinesError(null);
      setMachinesLoading(false);
      setMachinesLoaded(true);
      return;
    }
    setMachinesLoading(true);
    try {
      const [bindingsResult, cloudResult, sharedResult, legacySelection] = await Promise.allSettled([
        controlPlane<{ bindings?: ComputerBinding[] }>("listComputerBindings"),
        controlPlane<CloudComputer>("getCloudComputer"),
        controlPlane<{ computers?: SharedComputerView[] }>("listSharedComputers"),
        AsyncStorage.getItem(STORAGE_KEYS.binding),
      ]);
      if (epoch !== sessionCache.epoch) return;
      // Migrate the old unscoped preference only after this account's
      // computer list confirms access. All later reads use the scoped cache.
      if (!sessionCache.read("binding") && legacySelection.status === "fulfilled") {
        const previous = legacySelection.value;
        const owns = bindingsResult.status === "fulfilled" && bindingsResult.value.bindings?.some(b => b.id === previous);
        const hasCloud = previous === CLOUD_BINDING_ID && cloudResult.status === "fulfilled" &&
          cloudResult.value && !["upgrade_required", "recycled"].includes(cloudResult.value.status ?? "");
        if (previous && (owns || hasCloud)) {
          sessionCache.write("binding", previous);
          setBindingId(previous);
        }
      }
      if (bindingsResult.status === "fulfilled") {
        setBindings(bindingsResult.value?.bindings ?? []);
      }
      if (cloudResult.status === "fulfilled") setCloud(cloudResult.value ?? null);
      // Best-effort, same as the web dashboard: almost every account has
      // nothing shared with it, and a failure here should cost the "Shared
      // with you" section, never the two calls above that every account
      // depends on.
      if (sharedResult.status === "fulfilled") {
        setSharedComputers((sharedResult.value?.computers ?? []).map(toSharedBinding));
      }
      // Only a total failure of the two calls every account depends on is
      // worth a message; `sharedComputers` failing alone never blocks the
      // screen (see the best-effort note above).
      if (bindingsResult.status === "rejected" && cloudResult.status === "rejected") {
        setMachinesError(
          bindingsResult.reason instanceof Error
            ? bindingsResult.reason.message
            : "Couldn't load your computers.",
        );
      } else {
        setMachinesError(null);
      }
    } finally {
      if (epoch === sessionCache.epoch) {
        setMachinesLoading(false);
        setMachinesLoaded(true);
      }
    }
  }, []);

  useEffect(() => {
    if (authStatus === "signed-in") void refreshMachines();
  }, [authStatus, refreshMachines]);

  useEffect(() => {
    if (user && bindingId) sessionCache.write("binding", bindingId);
  }, [user, bindingId]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") void sessionCache.flush();
    });
    return () => subscription.remove();
  }, []);

  /**
   * Auto-select when there is no real choice to make. An account with exactly
   * one online machine should not be asked which one; an account whose cloud
   * Computer is plan-blocked should not have it silently chosen either.
   */
  useEffect(() => {
    if (bindingId || authStatus !== "signed-in") return;
    const online = bindings.find((b) => b.online);
    if (online) {
      setBindingId(online.id);

      return;
    }
    const cloudUsable = cloud && cloud.status !== "upgrade_required" && cloud.status !== "recycled";
    if (cloudUsable && bindings.length === 0) {
      setBindingId(CLOUD_BINDING_ID);

    }
  }, [bindingId, authStatus, bindings, cloud]);

  const selectBinding = useCallback(async (id: string) => {
    setBindingId(id);
    setReadiness(null);
    sessionCache.write("binding", id);
  }, []);

  // One client per machine, rebuilt only when the machine changes. The
  // underlying transport is itself cached, so this is cheap.
  const client = useMemo(
    // `workRows` is declared here, once, and the SDK puts it on every live
    // subscribe frame and on getMessages, whatever transport opened the
    // socket. The machine then folds each run of tool calls and thoughts
    // into one `work` message; see buildTranscriptItems in transcript.tsx.
    () =>
      bindingId
        ? new OmgClient(getHostedTransport(bindingId), { capabilities: { workRows: true } })
        : null,
    [bindingId],
  );
  // Markdown links have no client in scope; a tapped "#session" reference
  // resolves its short id through whichever client is current.
  useEffect(() => {
    registerSessionRefResolver(client);
    return () => registerSessionRefResolver(null);
  }, [client]);

  /**
   * "background" is the only state that means gone.
   *
   * iOS emits "inactive" for anything that merely covers the app for a moment:
   * pulling down Notification Center, an incoming call banner, the app
   * switcher, a system permission sheet. Treating that as absence — which
   * `state === "active"` does — releases the presence lease and starts the
   * pause clock because someone glanced at their notifications for two
   * seconds. Only a real background transition should end the lease.
   */
  const [foregrounded, setForegrounded] = useState(
    () => AppState.currentState !== "background",
  );
  const probeToken = useRef(0);
  const presenceRef = useRef<ReturnType<typeof startCloudPresence> | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      setForegrounded(state !== "background");
    });
    return () => sub.remove();
  }, []);

  /**
   * On screen is not the same as in use.
   *
   * Backgrounding releases the lease, and on a phone that covers most of the
   * ways a person leaves. It does not cover all of them: auto-lock can be set
   * to Never, and an app left open on a desk then renews forever and bills
   * compute all night. See USER_IDLE_TIMEOUT_MS for the measurement that found
   * this on the web client.
   */
  const { active: userActive, markActive } = useUserActive(foregrounded);
  // Declines every gesture it sees (`false`), so observing costs the UI below
  // nothing. Returning true here would swallow the whole app's touches.
  const noteTouch = useCallback(() => {
    markActive();
    return false;
  }, [markActive]);

  /**
   * Presence is the keep-awake demand channel for a cloud Computer.
   *
   * The control plane pauses a Computer after a grace period with no
   * activity, and mint/refresh traffic explicitly "never provisions, wakes,
   * or extends a Computer" — a presence lease is the only way a UI client
   * says "someone is still here". The web dashboard renews one; this app sent
   * none, and the Computer paused out from under the session. probe() wakes a
   * paused Computer; this loop stops it pausing in the first place.
   *
   * One effect covers all three release triggers, because each flips a
   * dependency: backgrounding clears foregrounded, sign-out clears
   * authStatus, and picking another machine changes bindingId. The cleanup
   * releases the lease so the pause clock starts when usage actually ends
   * instead of one grace period later.
   */
  useEffect(() => {
    if (authStatus !== "signed-in" || bindingId !== CLOUD_BINDING_ID || !userActive) {
      return;
    }
    const lease = startCloudPresence(controlPlane);
    presenceRef.current = lease;
    return () => {
      presenceRef.current = null;
      ++probeToken.current;
      lease.stop();
    };
  }, [authStatus, bindingId, userActive]);

  const probe = useCallback(async () => {
    if (!bindingId) return;
    if (bindingId === CLOUD_BINDING_ID && !presenceRef.current) return;
    const ticket = ++probeToken.current;
    /**
     * Announce "waking" only when there is nothing good on screen to lose.
     *
     * This used to be an unconditional `setReadiness({status:"waking"})`, and
     * the provider re-probes on every AppState → active. The sessions screen
     * gives the whole viewport to a "Waking your computer…" spinner whenever
     * readiness is `waking`, and hides the composer with it. So every single
     * return to the foreground — app switch, notification, the back
     * gesture — tore the list down and rebuilt it a moment later, for a
     * machine that had never stopped being ready. It read as the app
     * re-rendering itself at random, which is exactly what it was.
     *
     * A machine that IS ready keeps its list while the re-probe runs behind
     * it. If the probe comes back unhappy, the screen changes then, on real
     * news rather than on the mere act of asking.
     */
    /**
     * "Connecting", not "waking". The optimistic state here runs BEFORE the
     * probe, so at this point nobody has said anything about hibernation —
     * and for a paired machine (a laptop running `omg connect`) hibernation is
     * not a thing that happens at all. Only a 425 from the proxy, or a cloud
     * Computer we have just asked to start, earns the word "waking".
     */
    setReadiness((current) => (current?.status === "ready" ? current : { status: "connecting" }));

    /**
     * A `shared:` selection that no longer appears in OUR OWN read of "shared
     * with me" has had its access revoked (or never existed). Caught here,
     * before ever asking the box: minting a grant for it would 403 anyway —
     * readiness.ts's ComputerGrantError handling is what catches that same
     * failure reactively, for a share that gets revoked mid-session — but
     * finding out here means a stale preference reads as "no longer shared
     * with you" immediately, with no failed round trip in between to frame it
     * as a broken connection instead of a withdrawn one.
     *
     * Gated on `machinesLoaded` so a probe that races the FIRST
     * `refreshMachines()` (cold start restoring a saved bindingId before the
     * network has answered even once) falls through to the real probe below
     * instead of misreading "not fetched yet" as "revoked".
     */
    if (machinesLoaded && isSharedBindingId(bindingId)) {
      const stillShared = sharedComputers.some((c) => c.id === bindingId);
      if (!stillShared) {
        if (ticket === probeToken.current) {
          setReadiness({
            status: "unauthorized",
            message: SHARED_REVOKED_DETAIL,
          });
        }
        return;
      }
    }

    // Presence must be acknowledged before the server evaluates browser wake
    // demand. Bootstrap polling cannot wake a paused Computer on its own.
    if (bindingId === CLOUD_BINDING_ID) {
      const lease = presenceRef.current;
      if (!lease) return;
      const isCurrent = () => ticket === probeToken.current && presenceRef.current === lease;
      try {
        const woken = await wakeAfterPresence(
          lease,
          () => controlPlane<CloudComputer>("getOrProvisionCloudComputer"),
          isCurrent,
        );
        if (!isCurrent()) return;
        if (woken) setCloud(woken);
      } catch (error) {
        if (isCurrent()) setReadiness({
          status: "unavailable",
          message: error instanceof Error ? error.message : "Could not start your Computer. Try again.",
        });
        return;
      }
    }

    const result = await sharedReadiness(getHostedTransport(bindingId));
    // A machine switch mid-probe must not overwrite the new machine's state.
    if (ticket === probeToken.current) setReadiness(result);
  }, [bindingId, machinesLoaded, sharedComputers, userActive]);

  useEffect(() => {
    if (bindingId && authStatus === "signed-in") void probe();
  }, [bindingId, authStatus, probe]);

  // A phone that has been in someone's pocket has a dead socket and stale
  // state; re-probe when it comes back rather than showing yesterday's list.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && authStatus === "signed-in") {
        void refreshMachines();
        void probe();
      }
    });
    return () => sub.remove();
  }, [authStatus, refreshMachines, probe]);


  const signOut = useCallback(async () => {
    // Release the presence lease before the token goes away; a release sent
    // after authSignOut can only fail. stop() is idempotent, so the effect
    // cleanup below does not send a second one.
    presenceRef.current?.stop();
    presenceRef.current = null;
    ++probeToken.current;
    // Forget this device's push token BEFORE the auth token goes away (the
    // unregister call needs it) and before the account's bindingId is
    // cleared. A token left registered server-side under a signed-out
    // account is not an abstract leak: this is a physical device, and
    // whoever picks it up next — signed in as someone else, or nobody —
    // would keep seeing this account's push banners on the lock screen
    // until it expired on its own. See push-native.ts's user-scoping, which
    // this is the other half of.
    if (client) {
      await unregisterForPushNotifications(client.transport).catch(() => {});
    }
    // authSignOut throws SignOutFailedError if the server did not confirm
    // the session was revoked (see auth.ts) — on purpose, this propagates
    // and everything below does NOT run. Clearing local state here anyway
    // would recreate the exact bug being fixed: showing "signed out" while
    // the account is still live server-side. Let it throw; the caller
    // (Settings' confirmSignOut) is responsible for telling the person it
    // failed and that they should retry.
    await authSignOut();
    forgetAllTransports();
    clearTranscriptCache();
    await sessionCache.clear();
    clearPendingSessions();
    // The presence keys stay on purpose: the server-side lease can outlive a
    // failed release, and wiping the seq ratchet would restart eventSeq at 1
    // against it — which the server then silently ignores as stale forever.
    await AsyncStorage.multiRemove([STORAGE_KEYS.binding]);
    setBindingId(null);
    setReadiness(null);
    setBindings([]);
    setSharedComputers([]);
    setCloud(null);
    setUser(null);
    // The redirect to sign-in lives centrally in RootNavigator
    // (app/_layout.tsx), keyed on this flip to "signed-out" — not here —
    // so every path to signed-out lands on sign-in, not just this one.
    // See that file for why a redirect is needed at all (Stack.Protected
    // changing which screens are registered doesn't navigate anywhere by
    // itself).
    setAuthStatus("signed-out");
  }, [client]);

  /**
   * The roster is DERIVED from readiness, never fetched or stored separately.
   * readiness is already reset to null on selectBinding, so a machine switch
   * empties this by construction — there is no second piece of state that can
   * be left holding the previous box's projects.
   *
   * Only agents this box can actually launch are offered. An agent that is
   * hidden in Settings or has no account behind it would 400 on
   * POST /api/sessions/new, so listing it is offering a choice that fails.
   */
  const agents = useMemo<CodingAgent[]>(
    () =>
      readiness?.status === "ready"
        ? readiness.roster.agents.filter(
            (a) => a.visible !== false && a.status?.configured !== false,
          )
        : [],
    [readiness],
  );

  /**
   * THE FOLDER ROSTER OUTLIVES THE CONNECTION.
   *
   * This used to be empty until readiness said `ready`, so home drew its
   * cached session rows with no folder rail and no folder filter: a flat list
   * of every session on the machine, which is not the screen it turns into a
   * second later. The roster is small and changes rarely, so it is kept in the
   * same account-scoped snapshot that already holds the session rows and is
   * served from there until the machine answers. Live readiness still owns it;
   * the cache is only what to draw while the answer is in flight.
   */
  const reposKey = bindingId ? `repos:${bindingId}` : null;
  const repos = useMemo<Repo[]>(
    () =>
      readiness?.status === "ready"
        ? readiness.roster.repos
        : (reposKey ? sessionCache.read<Repo[]>(reposKey) : null) ?? [],
    [readiness, reposKey],
  );
  useEffect(() => {
    if (reposKey && readiness?.status === "ready") {
      sessionCache.write(reposKey, readiness.roster.repos);
    }
  }, [reposKey, readiness]);

  const [modelsVersion, setModelsVersion] = useState(0);
  const refreshModels = useCallback(async () => {
    if (!client) throw new Error("No Computer selected.");
    await client.transport.request("/api/coding-agents?refreshModels=1");
    setModelsVersion((n) => n + 1);
    void probe();
  }, [client, probe]);

  const updateAllAgents = useCallback(async () => {
    if (!client) throw new Error("No Computer selected.");
    try {
      await client.transport.request("/api/coding-agents/update-all", { method: "POST" });
    } catch (e) {
      // A box older than the route answers the per-agent POST's 404.
      if ((e as { status?: number })?.status === 404) {
        throw new Error("Your Computer needs a software update before it can update agents.");
      }
      throw e;
    }
    // The box answers at once and runs the installs in the background. Watch
    // `setupRunning` until every agent is idle. Bounded: installers that hang
    // should not keep a spinner up forever.
    const deadline = Date.now() + 15 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const payload = await client.transport
        .request<{ agents?: { status?: { setupRunning?: boolean } }[] }>("/api/coding-agents")
        .catch(() => null);
      if (payload && !(payload.agents ?? []).some((a) => a.status?.setupRunning)) break;
    }
    setModelsVersion((n) => n + 1);
    void probe();
    const log = await client.transport
      .request<{ running?: boolean; error?: string | null }>("/api/coding-agents/setup/log")
      .catch(() => null);
    if (log?.running) throw new Error("Still updating on your Computer. Check back in a few minutes.");
    if (log?.error) throw new Error(log.error.split("\n")[0] ?? log.error);
  }, [client, probe]);

  const value = useMemo<OmgContextValue>(
    () => ({
      authStatus,
      user,
      refreshSession,
      signOut,
      bindings,
      sharedComputers,
      cloud,
      machinesLoading,
      machinesLoaded,
      machinesError,
      refreshMachines,
      bindingId,
      selectBinding,
      client,
      readiness,
      probe,
      agents,
      repos,
      refreshModels,
      modelsVersion,
      updateAllAgents,
    }),
    [
      authStatus,
      user,
      refreshSession,
      signOut,
      bindings,
      sharedComputers,
      cloud,
      machinesLoading,
      machinesLoaded,
      machinesError,
      refreshMachines,
      bindingId,
      selectBinding,
      client,
      readiness,
      probe,
      agents,
      repos,
      refreshModels,
      modelsVersion,
      updateAllAgents,
    ],
  );

  return (
    <Context.Provider value={value}>
      {/*
        React Native has no global input event, so the touch has to be observed
        by a view. Both `...ResponderCapture` handlers record the gesture and
        then return false, which declines it: this wrapper sees every touch and
        intercepts none of them, so nothing below it loses a tap or a scroll.
      */}
      <View
        style={styles.root}
        onStartShouldSetResponderCapture={noteTouch}
        onMoveShouldSetResponderCapture={noteTouch}
      >
        {children}
      </View>
    </Context.Provider>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

export function useOmg(): OmgContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("useOmg must be used inside OmgProvider");
  return value;
}
