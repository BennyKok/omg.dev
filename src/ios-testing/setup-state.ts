import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, closeSync } from "node:fs";
import { join } from "node:path";
import type { AppleDeveloperConnection } from "./apple-login";
import type { IosDevice } from "./devices";

export type IosSetupState = {
  connection: AppleDeveloperConnection | null;
  devices: IosDevice[];
  profile: { uuid: string; expiresAt: number; deviceIds: string[] } | null;
  phase: "idle" | "signing-in" | "preparing" | "ready" | "error";
  error: string | null;
  pendingExport?: { pendingId: string; ownerId: string; appId: string; teamId: string; intentId: string; profileId: string; expectedRevision: number | null } | null;
  uploaded?: { ownerId: string; appId: string; identityId: string; profileId: string; revision: number; expiresAt: number } | null;
};

export class IosSetupStore {
  constructor(readonly root: string) {}
  read(): IosSetupState {
    const empty: IosSetupState = { connection: null, devices: [], profile: null, phase: "idle", error: null };
    try {
      const value = JSON.parse(readFileSync(join(this.root, "status.json"), "utf8")) as IosSetupState;
      // Copy only the display-safe projection. Never return a raw stored object.
      const connection = value.connection;
      if (connection && (typeof connection.appleId !== "string" || !/^[A-Z0-9]{10}$/.test(connection.teamId) || typeof connection.teamName !== "string")) return empty;
      const profile = value.profile;
      if (profile && (typeof profile.uuid !== "string" || !Number.isFinite(profile.expiresAt) || !Array.isArray(profile.deviceIds))) return empty;
      return {
        connection: connection ? { appleId: connection.appleId, teamId: connection.teamId, teamName: connection.teamName } : null,
        devices: Array.isArray(value.devices) ? value.devices.filter((device) => typeof device.udid === "string" && typeof device.name === "string").map((device) => ({ udid: device.udid, name: device.name })) : [],
        profile: profile ? { uuid: profile.uuid, expiresAt: profile.expiresAt, deviceIds: profile.deviceIds.filter((id) => typeof id === "string") } : null,
        phase: ["idle", "signing-in", "preparing", "ready", "error"].includes(value.phase) ? value.phase : "idle",
        error: typeof value.error === "string" ? value.error : null,
        pendingExport: value.pendingExport && typeof value.pendingExport.pendingId === "string" ? {
          pendingId: value.pendingExport.pendingId, ownerId: value.pendingExport.ownerId, appId: value.pendingExport.appId,
          teamId: value.pendingExport.teamId, intentId: value.pendingExport.intentId, profileId: value.pendingExport.profileId,
          expectedRevision: value.pendingExport.expectedRevision,
        } : null,
        uploaded: value.uploaded && typeof value.uploaded.identityId === "string" ? {
          ownerId: value.uploaded.ownerId, appId: value.uploaded.appId, identityId: value.uploaded.identityId,
          profileId: value.uploaded.profileId, revision: value.uploaded.revision, expiresAt: value.uploaded.expiresAt,
        } : null,
      };
    } catch { return empty; }
  }
  write(state: IosSetupState): void {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const temp = join(this.root, `status-${randomUUID()}.json`);
    writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
    renameSync(temp, join(this.root, "status.json"));
  }
  busy(): boolean {
    try {
      const lock = JSON.parse(readFileSync(join(this.root, "operation.lock"), "utf8"));
      if (!Number.isSafeInteger(lock.pid) || lock.pid <= 1) return false;
      process.kill(lock.pid, 0);
      return true;
    } catch { return false; }
  }
  async withLock<T>(fn: () => Promise<T>): Promise<T> {
    mkdirSync(this.root, { recursive: true, mode: 0o700 });
    const path = join(this.root, "operation.lock");
    if (existsSync(path)) {
      if (this.busy()) throw new Error("iOS setup is already running on this Mac.");
      rmSync(path);
    }
    const fd = openSync(path, "wx", 0o600);
    writeFileSync(fd, JSON.stringify({ pid: process.pid }));
    try { return await fn(); } finally { closeSync(fd); rmSync(path, { force: true }); }
  }
}
