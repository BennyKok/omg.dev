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
import { AppState } from "react-native";

import { CLOUD_BINDING_ID, CONTROLPLANE_ORIGIN, STORAGE_KEYS } from "./config";
import { getAuthToken, getSession, signOut as authSignOut, type SignedInUser } from "./auth";
import { forgetAllTransports, getHostedTransport } from "./transport";
import { waitForReady, type ComputerReadiness } from "./readiness";

export type ComputerBinding = {
  id: string;
  boxId?: string;
  online?: boolean;
  lastSeenAt?: number | null;
  defaultFolder?: string | null;
  computerUrl?: string | null;
};

/** Shape returned by control-plane getCloudComputer. */
export type CloudComputer = {
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
  cloud: CloudComputer | null;
  machinesLoading: boolean;
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
};

const Context = createContext<OmgContextValue | null>(null);

async function controlPlane<T>(name: string, body: unknown = {}): Promise<T> {
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
  const [cloud, setCloud] = useState<CloudComputer | null>(null);
  const [machinesLoading, setMachinesLoading] = useState(false);
  const [machinesError, setMachinesError] = useState<string | null>(null);

  const [bindingId, setBindingId] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<ComputerReadiness | null>(null);

  const refreshSession = useCallback(async () => {
    const found = await getSession();
    setUser(found);
    setAuthStatus(found ? "signed-in" : "signed-out");
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const refreshMachines = useCallback(async () => {
    setMachinesLoading(true);
    try {
      const [bindingsResult, cloudResult] = await Promise.allSettled([
        controlPlane<{ bindings?: ComputerBinding[] }>("listComputerBindings"),
        controlPlane<CloudComputer>("getCloudComputer"),
      ]);
      if (bindingsResult.status === "fulfilled") {
        setBindings(bindingsResult.value?.bindings ?? []);
      }
      if (cloudResult.status === "fulfilled") setCloud(cloudResult.value ?? null);
      // Only a total failure is worth a message; one of the two answering is
      // still a usable screen.
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
      setMachinesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authStatus === "signed-in") void refreshMachines();
  }, [authStatus, refreshMachines]);

  // Restore the last machine, so the app reopens where it was left.
  useEffect(() => {
    let cancelled = false;
    void AsyncStorage.getItem(STORAGE_KEYS.binding).then((saved) => {
      if (!cancelled && saved) setBindingId(saved);
    });
    return () => {
      cancelled = true;
    };
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
      void AsyncStorage.setItem(STORAGE_KEYS.binding, online.id);
      return;
    }
    const cloudUsable = cloud && cloud.status !== "upgrade_required" && cloud.status !== "recycled";
    if (cloudUsable && bindings.length === 0) {
      setBindingId(CLOUD_BINDING_ID);
      void AsyncStorage.setItem(STORAGE_KEYS.binding, CLOUD_BINDING_ID);
    }
  }, [bindingId, authStatus, bindings, cloud]);

  const selectBinding = useCallback(async (id: string) => {
    setBindingId(id);
    setReadiness(null);
    await AsyncStorage.setItem(STORAGE_KEYS.binding, id);
  }, []);

  // One client per machine, rebuilt only when the machine changes. The
  // underlying transport is itself cached, so this is cheap.
  const client = useMemo(
    () => (bindingId ? new OmgClient(getHostedTransport(bindingId)) : null),
    [bindingId],
  );

  const probeToken = useRef(0);
  const probe = useCallback(async () => {
    if (!bindingId) return;
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
    setReadiness((current) => (current?.status === "ready" ? current : { status: "waking" }));
    const result = await waitForReady(getHostedTransport(bindingId));
    // A machine switch mid-probe must not overwrite the new machine's state.
    if (ticket === probeToken.current) setReadiness(result);
  }, [bindingId]);

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
    await authSignOut();
    forgetAllTransports();
    await AsyncStorage.multiRemove([STORAGE_KEYS.binding]);
    setBindingId(null);
    setReadiness(null);
    setBindings([]);
    setCloud(null);
    setUser(null);
    setAuthStatus("signed-out");
  }, []);

  const value = useMemo<OmgContextValue>(
    () => ({
      authStatus,
      user,
      refreshSession,
      signOut,
      bindings,
      cloud,
      machinesLoading,
      machinesError,
      refreshMachines,
      bindingId,
      selectBinding,
      client,
      readiness,
      probe,
    }),
    [
      authStatus,
      user,
      refreshSession,
      signOut,
      bindings,
      cloud,
      machinesLoading,
      machinesError,
      refreshMachines,
      bindingId,
      selectBinding,
      client,
      readiness,
      probe,
    ],
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useOmg(): OmgContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("useOmg must be used inside OmgProvider");
  return value;
}
