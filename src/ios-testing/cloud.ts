import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { createCloudAccount, type CloudAccount, type CloudCredentials } from "../cloud-account";
import { AppleLoginError } from "./apple-login";
import { prepareSigningExport, preparedSigningExport, rewrapPkcs12 } from "./export";
import { loadSigningRecord, signingVaultAccount } from "./provisioning";
import { macKeychainStore, type KeychainStore, type SigningVault } from "./keychain";
import type { IosSetupStore } from "./setup-state";

export const IOS_SIGNING_RESOURCE = "https://backend.omg.dev/v1/signing-identities/ios";
export const IOS_SIGNING_SCOPES = "openid email offline_access omg:ios-signing";

export function iosSigningAccount(root: string, keychainFactory: () => KeychainStore = macKeychainStore): CloudAccount {
  const key = `oauth/${createHash("sha256").update(resolve(root)).digest("hex")}`;
  let keychain: KeychainStore | undefined;
  const storage = () => keychain ??= keychainFactory();
  return createCloudAccount({
    credentialStore: {
      id: `dev.omg.ios-testing.signing.v1/${key}`,
      load() {
        const text = storage().read(key);
        if (!text) return null;
        try {
          const value = JSON.parse(text) as CloudCredentials;
          if (!value || typeof value.token !== "string" || value.kind !== "oauth" || value.resource !== IOS_SIGNING_RESOURCE) return null;
          return value;
        } catch { throw new AppleLoginError("The saved signing grant could not be read. Allow iOS signing access again."); }
      },
      save: (credentials) => storage().write(key, JSON.stringify(credentials)),
      clear: () => storage().remove(key),
    },
    resource: IOS_SIGNING_RESOURCE,
    scopes: IOS_SIGNING_SCOPES, clientName: "omg.dev iOS testing", routePrefix: "/api/ios-testing/cloud", inheritIdentity: false, discoverOAuth: true, loopbackOnly: true,
  });
}

export type HostedIosSetup = {
  identityId: string; teamId: string; revision: number; certificateSha256: string;
  profiles: Array<{ profileId: string; expiresAt: number; deviceIds: string[] }>;
};
type UploadResult = { identityId: string; profileId: string; teamId: string; certificateSha256: string; expiresAt: number; revision: number; replayed: boolean };

/** The existing CloudAccount owns DCR, consent, PKCE, refresh and token storage.
 * This client owns only the iOS enrollment/import lifecycle. */
export class IosSigningCloud {
  constructor(private account: Pick<CloudAccount, "getAccessToken" | "cloudFetch">, private vault: SigningVault, private store: IosSetupStore,
    private rewrap: typeof rewrapPkcs12 = rewrapPkcs12) {}
  private async request(path: string, init: RequestInit = {}) {
    const token = await this.account.getAccessToken();
    if (!token) throw new AppleLoginError("Allow iOS signing access before saving for builds.");
    const response = await this.account.cloudFetch(path, {
      ...init, redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { "Content-Type": "application/json", ...init.headers },
    });
    if (!response.ok) {
      if (response.status === 409) throw new AppleLoginError("Your team setup changed. Review the current setup and prepare a new upload.");
      if (response.status === 401 || response.status === 403) throw new AppleLoginError("Allow iOS signing access again for this account.");
      throw new AppleLoginError(`Signing upload could not finish (HTTP ${response.status}). Your prepared upload was kept.`);
    }
    return response;
  }
  private async ownerId() {
    const token = await this.account.getAccessToken();
    try {
      if (!token) throw new Error();
      const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
      const signingAudience = claims.aud === IOS_SIGNING_RESOURCE || Array.isArray(claims.aud) && claims.aud.includes(IOS_SIGNING_RESOURCE);
      if (!signingAudience || typeof claims.sub !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(claims.sub)
        || typeof claims.scope !== "string" || !claims.scope.split(/\s+/).includes("omg:ios-signing")) throw new Error();
      // This is a local storage namespace check. The hosted service performs
      // signature, audience, issuer, scope, deletion and ownership verification.
      return claims.sub as string;
    } catch { throw new AppleLoginError("Allow iOS signing access before saving for builds."); }
  }
  async apps(): Promise<Array<{ appId: string; name: string; bundleId: string | null }>> {
    const value = await (await this.request("/v1/signing-identities/ios/apps")).json() as { apps?: unknown[] };
    if (!Array.isArray(value.apps)) throw new AppleLoginError("Your apps could not be loaded. Try again.");
    return value.apps.flatMap((row) => {
      const app = row as { appId?: unknown; name?: unknown; bundleId?: unknown };
      return typeof app.appId === "string" && typeof app.name === "string"
        ? [{ appId: app.appId, name: app.name, bundleId: typeof app.bundleId === "string" ? app.bundleId : null }] : [];
    });
  }
  async upload(appId: string, prepareNew = false): Promise<UploadResult> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(appId)) throw new AppleLoginError("Select your app before saving for builds.");
    const ownerId = await this.ownerId();
    let state = this.store.read();
    if (!state.connection || !state.profile) throw new AppleLoginError("Create your local testing profile first.");
    if (state.pendingExport && (state.pendingExport.ownerId !== ownerId || state.pendingExport.appId !== appId || state.pendingExport.teamId !== state.connection.teamId)) {
      throw new AppleLoginError("Finish the prepared upload for its original account and app first.");
    }
    if (!state.pendingExport || prepareNew) {
      const metadata = await (await this.request(`/v1/signing-identities/ios?appId=${encodeURIComponent(appId)}&teamId=${state.connection.teamId}`)).json() as { bundleId: string; setup: HostedIosSetup | null };
      const record = await loadSigningRecord(this.vault, signingVaultAccount(state.connection));
      if (!record || metadata.setup && metadata.setup.certificateSha256 !== record.certificateSha256) {
        throw new AppleLoginError("This team uses a different signing certificate. The existing setup was kept.");
      }
      const profile = record.profiles.find((candidate) => candidate.uuid === state.profile!.uuid);
      if (!profile) throw new AppleLoginError("Prepare your local testing profile again.");
      const retained = metadata.setup?.profiles.flatMap((current) => current.deviceIds) ?? [];
      if (retained.some((id) => !profile.deviceIds.includes(id))) throw new AppleLoginError("Update the testing profile to include all currently registered iPhones.");
      const enrollment = await (await this.request("/v1/signing-identities/ios/devices")).json() as { devices?: Array<{ udid: string }> };
      if (!Array.isArray(enrollment.devices) || enrollment.devices.some((device) => !device || typeof device.udid !== "string")) {
        throw new AppleLoginError("Your registered iPhones could not be loaded. Try again.");
      }
      const enrolledIds = new Set(enrollment.devices.map((device) => device.udid));
      const selectedIds = new Set(state.devices.map((device) => device.udid));
      const newDeviceIds = profile.deviceIds.filter((udid) => !enrolledIds.has(udid));
      // A profile can retain older devices. Only the owner's explicit local
      // selection authorizes new enrollment; profile contents cannot grant it.
      if (newDeviceIds.some((udid) => !selectedIds.has(udid))) {
        throw new AppleLoginError("Select each new iPhone in Settings before saving its testing profile.");
      }
      for (const udid of newDeviceIds) {
        const enrolled = await (await this.request("/v1/signing-identities/ios/devices", {
          method: "POST", body: JSON.stringify({ udid, name: state.devices.find((device) => device.udid === udid)!.name }),
        })).json() as { udid: string };
        if (enrolled.udid !== udid) throw new AppleLoginError("The registered iPhone ID changed. Prepare your profile again.");
      }
      const prepared = await prepareSigningExport({
        record, vault: this.vault, ownerId, appId, profileId: profile.uuid, expectedRevision: metadata.setup?.revision ?? null,
        rewrap: this.rewrap,
      });
      state = { ...state, pendingExport: { ...prepared, ownerId } };
      this.store.write(state);
    }
    const body = await preparedSigningExport(this.vault, state.pendingExport!.pendingId);
    const result = await (await this.request("/v1/signing-identities/ios/import", { method: "POST", body })).json() as UploadResult;
    if (!result || typeof result.identityId !== "string" || typeof result.profileId !== "string"
      || result.teamId !== state.connection!.teamId || !Number.isSafeInteger(result.revision) || result.revision < 1
      || !Number.isFinite(result.expiresAt) || !/^[a-f0-9]{64}$/.test(result.certificateSha256)) {
      throw new AppleLoginError("The signing service did not confirm the upload. The prepared upload was kept.");
    }
    this.store.write({ ...state, pendingExport: null, uploaded: { ownerId, appId, identityId: result.identityId, profileId: result.profileId, revision: result.revision, expiresAt: result.expiresAt }, error: null });
    await this.vault.remove?.(`pending/${state.pendingExport!.pendingId}`);
    return {
      identityId: result.identityId, profileId: result.profileId, teamId: result.teamId,
      certificateSha256: result.certificateSha256, expiresAt: result.expiresAt,
      revision: result.revision, replayed: result.replayed === true,
    };
  }
}
