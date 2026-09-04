/**
 * The account's machines, as the control plane reports them.
 *
 * Every dashboard read goes through `POST <controlPlane>/api/computer/<name>`
 * with the account JWT as a bearer. The names are the control plane's own
 * function names, so a new one needs no client change beyond a call.
 */

import { CLOUD_BINDING_ID, resolveCloudEndpoints, type CloudEndpoints, type FetchLike, type GetAuthToken } from "./config";
import {
  sharedBindingId,
  sharedComputerMachineIdentity,
  sharedComputerOwnerLabel,
  type SharedComputerView,
} from "./shared-binding";

/** A machine the account owns, paired through `omg connect`. */
export type ComputerBinding = {
  id: string;
  boxId?: string;
  online?: boolean;
  lastSeenAt?: number | null;
  createdAt?: number;
  defaultFolder?: string | null;
  computerUrl?: string | null;
};

/**
 * A machine somebody else shared with this account, presented as an ordinary
 * binding so it flows through the same transport cache, grant mint and picker
 * rows. `id` is the opaque `shared:<ownerUserId>:<bindingId>` spelling.
 *
 * Never synthesized with a `computerUrl`: a guest never gets the owner's
 * direct box URL. Only the session proxy knows how to reach it.
 */
export type SharedComputerBinding = ComputerBinding & {
  shared: true;
  ownerUserId: string;
  ownerBindingId: string;
  /** The owner's name, or their email if they have none set. */
  ownerLabel: string;
  /** Display name when they have one. Never an email. */
  ownerName?: string;
  email: string;
  machineLabel?: string;
};

export function toSharedBinding(computer: SharedComputerView): SharedComputerBinding {
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
    ownerLabel: sharedComputerOwnerLabel(computer),
    ownerName: ownerName && !ownerName.includes("@") ? ownerName : undefined,
    email: computer.email,
    machineLabel: sharedComputerMachineIdentity(computer),
  };
}

/** Lifecycle of the account's cloud Computer. Server owned, never inferred. */
export type CloudComputerStatus =
  | "none"
  | "provisioning"
  | "waking"
  | "live"
  | "paused"
  | "recycled"
  | "upgrade_required";

/** Shape returned by control-plane getCloudComputer. Render what the server sent. */
export type CloudComputer = {
  status?: CloudComputerStatus | string;
  blockedReason?: "compute_exhausted" | "plan_downgraded" | string | null;
  instanceId?: string | null;
  plan?: string | null;
  machine?: { vcpus?: number; memoryMib?: number; diskGib?: number; alwaysOn?: boolean } | null;
  recyclesAt?: number | null;
};

const BLOCKED_CLOUD_STATUSES: ReadonlySet<string> = new Set(["upgrade_required", "recycled"]);

/** A cloud Computer that the session proxy would answer with a permanent 425. */
export function isCloudComputerBlocked(cloud: CloudComputer | null | undefined): boolean {
  return BLOCKED_CLOUD_STATUSES.has(cloud?.status ?? "");
}

export interface ControlPlaneOptions {
  endpoints?: Partial<CloudEndpoints>;
  getAuthToken: GetAuthToken;
  fetch?: FetchLike;
}

export type MachineList = {
  bindings: ComputerBinding[];
  sharedComputers: SharedComputerBinding[];
  cloud: CloudComputer | null;
  /**
   * Set only when BOTH calls every account depends on failed. The shared list
   * is best effort: almost every account has nothing shared with it, and a
   * failure there costs the "Shared with you" section, never the screen.
   */
  error: string | null;
};

export interface ControlPlaneClient {
  /** Call any control plane computer function by name. */
  call<T>(name: string, body?: unknown): Promise<T>;
  listBindings(): Promise<ComputerBinding[]>;
  listSharedComputers(): Promise<SharedComputerBinding[]>;
  getCloudComputer(): Promise<CloudComputer | null>;
  /**
   * The one client-callable path that wakes or provisions the cloud Computer.
   * Minting a grant, reading state, and polling bootstrap never do.
   */
  getOrProvisionCloudComputer(): Promise<CloudComputer | null>;
  setComputerPreference(value: string): Promise<void>;
  /** All three reads at once, each allowed to fail on its own. */
  listMachines(): Promise<MachineList>;
}

export function createControlPlaneClient(options: ControlPlaneOptions): ControlPlaneClient {
  const endpoints = resolveCloudEndpoints(options.endpoints);
  const fetchImpl = options.fetch ?? globalThis.fetch;

  async function call<T>(name: string, body: unknown = {}): Promise<T> {
    const token = await options.getAuthToken();
    if (!token) throw new Error("Please sign in again.");
    const response = await fetchImpl(`${endpoints.controlPlaneOrigin}/api/computer/${name}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await response.text().catch(() => "");
    let data: unknown = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }
    if (!response.ok) {
      throw new Error((data as { error?: string })?.error ?? `${name} failed (${response.status})`);
    }
    return data as T;
  }

  const listBindings = async () =>
    (await call<{ bindings?: ComputerBinding[] }>("listComputerBindings")).bindings ?? [];
  const listSharedComputers = async () =>
    ((await call<{ computers?: SharedComputerView[] }>("listSharedComputers")).computers ?? []).map(
      toSharedBinding,
    );
  const getCloudComputer = async () => (await call<CloudComputer | null>("getCloudComputer")) ?? null;

  return {
    call,
    listBindings,
    listSharedComputers,
    getCloudComputer,
    getOrProvisionCloudComputer: async () =>
      (await call<CloudComputer | null>("getOrProvisionCloudComputer")) ?? null,
    setComputerPreference: async (value) => {
      await call("setComputerPreference", { value });
    },
    async listMachines() {
      const [bindings, cloud, shared] = await Promise.allSettled([
        listBindings(),
        getCloudComputer(),
        listSharedComputers(),
      ]);
      const error =
        bindings.status === "rejected" && cloud.status === "rejected"
          ? bindings.reason instanceof Error
            ? bindings.reason.message
            : "Couldn't load your computers."
          : null;
      return {
        bindings: bindings.status === "fulfilled" ? bindings.value : [],
        cloud: cloud.status === "fulfilled" ? cloud.value : null,
        sharedComputers: shared.status === "fulfilled" ? shared.value : [],
        error,
      };
    },
  };
}

/**
 * Auto-select when there is no real choice to make. An account with exactly
 * one online machine should not be asked which one; an account whose cloud
 * Computer is plan-blocked should not have it silently chosen either.
 * Returns null when a person has to choose.
 */
export function autoSelectBinding(list: Pick<MachineList, "bindings" | "cloud">): string | null {
  const online = list.bindings.find((b) => b.online);
  if (online) return online.id;
  if (list.cloud && !isCloudComputerBlocked(list.cloud) && list.bindings.length === 0) {
    return CLOUD_BINDING_ID;
  }
  return null;
}

/**
 * A machine's own name: what to call the COMPUTER, not the work it is pointed
 * at. The hostname is the machine's real identity, so it goes first. The
 * folder stays as a fallback; a folder name beats a truncated uuid.
 */
export function bindingLabel(binding: {
  id: string;
  boxId?: string;
  defaultFolder?: string | null;
  computerUrl?: string | null;
}): string {
  if (binding.computerUrl) {
    try {
      const host = new URL(binding.computerUrl).hostname.split(".")[0];
      if (host && host !== "localhost" && !/^\d+$/.test(host)) return host;
    } catch {
      /* fall through */
    }
  }
  const boxId = binding.boxId?.trim();
  if (boxId && !UUID_PATTERN.test(boxId)) return boxId;
  const folder = binding.defaultFolder?.split("/").filter(Boolean).pop();
  if (folder) return folder;
  return `${binding.id.slice(0, 8)}…`;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Turn a cloud status code into something a person can act on. */
export function cloudStatusLabel(status?: string, blockedReason?: string | null): string {
  switch (status) {
    case "upgrade_required":
      return blockedReason === "plan_downgraded"
        ? "Your plan no longer covers this computer"
        : "Included computer time is used up";
    case "provisioning":
      return "Setting up…";
    case "paused":
      return "Paused";
    case "recycled":
      return "Removed";
    case "ready":
    case "running":
    case "live":
      return "Ready";
    default:
      return status ? status.replace(/_/g, " ") : "Unknown";
  }
}

/** Machine spec line, e.g. "4 vCPU · 8 GB RAM · 64 GB disk". */
export function machineSpec(machine?: {
  vcpus?: number;
  memoryMib?: number;
  diskGib?: number;
} | null): string | null {
  if (!machine) return null;
  const parts: string[] = [];
  if (machine.vcpus) parts.push(`${machine.vcpus} vCPU`);
  if (machine.memoryMib) parts.push(`${Math.round(machine.memoryMib / 1024)} GB RAM`);
  if (machine.diskGib) parts.push(`${machine.diskGib} GB disk`);
  return parts.length ? parts.join(" · ") : null;
}
