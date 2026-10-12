import { createHash } from "node:crypto";
import type * as Apple from "@expo/apple-utils";
import { AppleLoginError, type AppleDeveloperConnection } from "./apple-login";
import type { IosDevice } from "./devices";
import type { SigningVault } from "./keychain";

export type LocalProfile = {
  appleId: string;
  uuid: string;
  bundleIdentifier: string;
  expiresAt: number;
  deviceIds: string[];
  mobileprovisionBase64: string;
};

export type LocalSigningRecord = {
  version: 1;
  teamId: string;
  certificateId: string;
  certificateSha256: string;
  certificateExpiresAt: number;
  pkcs12Base64: string;
  pkcs12Password: string;
  profiles: LocalProfile[];
};

export type ProvisioningSdk = Pick<typeof Apple,
  "Certificate" | "CertificateType" | "createCertificateAndP12Async" |
  "Device" | "BundleId" | "Profile" | "ProfileType"
>;

export function signingVaultAccount(connection: AppleDeveloperConnection): string {
  return `${connection.appleId.toLowerCase()}/${connection.teamId}`;
}

export async function loadSigningRecord(vault: SigningVault, account: string): Promise<LocalSigningRecord | null> {
  const text = await vault.read(account);
  if (text === null) return null;
  let record: LocalSigningRecord;
  try { record = JSON.parse(text); } catch { throw new AppleLoginError("The local signing record could not be read."); }
  if (record.version !== 1 || !/^[A-Z0-9]{10}$/.test(record.teamId) || !Array.isArray(record.profiles)
    || !/^[a-f0-9]{64}$/.test(record.certificateSha256) || !record.pkcs12Base64 || !record.pkcs12Password
    || !Number.isFinite(record.certificateExpiresAt) || typeof record.certificateId !== "string") {
    throw new AppleLoginError("The local signing record could not be read.");
  }
  return record;
}

/** Only reads and creates Apple records. Never deletes a certificate, App ID,
 * device or profile. A failed profile step can reuse the already-saved key. */
export async function prepareIosTestingProfile(options: {
  sdk: ProvisioningSdk;
  context: Apple.RequestContext;
  connection: AppleDeveloperConnection;
  devices: IosDevice[];
  vault: SigningVault;
  now?: number;
}): Promise<LocalSigningRecord> {
  const { sdk, context, connection, vault } = options;
  const now = options.now ?? Date.now();
  if (context.teamId !== connection.teamId) throw new AppleLoginError("Sign in to the selected Apple team again.");
  const devices = [...new Map(options.devices.map((device) => [device.udid, device])).values()];
  if (!devices.length || devices.some((device) => !/^[A-Za-z0-9-]{1,128}$/.test(device.udid))) {
    throw new AppleLoginError("Connect an iPhone and select it before making the profile.");
  }
  const account = signingVaultAccount(connection);
  let record = await loadSigningRecord(vault, account);
  if (record && record.teamId !== connection.teamId) throw new AppleLoginError("The signing key belongs to a different team.");
  if (!record) {
    const created = await sdk.createCertificateAndP12Async(context, { certificateType: sdk.CertificateType.DISTRIBUTION });
    const expiresAt = Date.parse(created.certificate.attributes.expirationDate);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new AppleLoginError("Apple did not return a valid distribution certificate.");
    record = {
      version: 1, teamId: connection.teamId, certificateId: created.certificate.id,
      certificateSha256: createHash("sha256").update(Buffer.from(created.certificate.attributes.certificateContent, "base64")).digest("hex"),
      certificateExpiresAt: expiresAt, pkcs12Base64: created.certificateP12,
      pkcs12Password: created.password, profiles: [],
    };
    // Save before any further Apple calls so a failed device/profile step does
    // not discard the matching key or consume another certificate slot.
    await vault.write(account, JSON.stringify(record));
  } else {
    const certificate = await sdk.Certificate.infoAsync(context, { id: record.certificateId });
    const remoteExpiry = Date.parse(certificate.attributes.expirationDate);
    if (record.certificateExpiresAt <= now || certificate.attributes.status !== "Issued"
      || !Number.isFinite(remoteExpiry) || remoteExpiry <= now
      || createHash("sha256").update(Buffer.from(certificate.attributes.certificateContent, "base64")).digest("hex") !== record.certificateSha256) {
      throw new AppleLoginError("Your distribution certificate needs renewal. The existing profiles were kept.");
    }
  }

  // Preserve coverage for all devices previously included by this setup.
  const deviceMap = new Map(devices.map((device) => [device.udid, device]));
  for (const profile of record.profiles) {
    for (const udid of profile.deviceIds) if (!deviceMap.has(udid)) deviceMap.set(udid, { udid, name: "Registered iPhone or iPad" });
  }
  const portalDevices = await sdk.Device.getAllIOSProfileDevicesAsync(context);
  const registeredIds: string[] = [];
  for (const device of deviceMap.values()) {
    let registered = portalDevices.find((candidate) => candidate.attributes.udid.toUpperCase() === device.udid.toUpperCase());
    if (registered && registered.attributes.status !== "ENABLED") {
      throw new AppleLoginError("A selected iPhone is disabled in your Apple Developer account.");
    }
    if (!registered) registered = await sdk.Device.createAsync(context, { name: device.name, udid: device.udid, platform: "IOS" as Apple.Device["attributes"]["platform"] });
    registeredIds.push(registered.id);
  }
  let bundle = await sdk.BundleId.findAsync(context, { identifier: "*" });
  if (!bundle) bundle = await sdk.BundleId.createAsync(context, { name: "omg iOS Testing", identifier: "*" });
  const candidates = await sdk.Profile.getAsync(context, {
    query: { filter: { profileType: sdk.ProfileType.IOS_APP_ADHOC, profileState: "ACTIVE" as Apple.Profile["attributes"]["profileState"] } },
  });
  const matches = (profile: Apple.Profile) => profile.attributes.bundleId?.id === bundle!.id
    && profile.attributes.certificates?.some((certificate) => certificate.id === record!.certificateId)
    && registeredIds.every((id) => profile.attributes.devices?.some((device) => device.id === id))
    && profile.attributes.profileContent && Date.parse(profile.attributes.expirationDate) > now;
  let profile = candidates.find(matches);
  if (!profile) profile = await sdk.Profile.createAsync(context, {
    name: `omg iOS Testing ${new Date(now).toISOString()}`,
    bundleId: bundle.id, certificates: [record.certificateId], devices: registeredIds, profileType: sdk.ProfileType.IOS_APP_ADHOC,
  });
  // Fetch Apple's expanded representation, rather than trusting the request.
  profile = await sdk.Profile.infoAsync(context, { id: profile.id });
  if (profile.attributes.profileType !== sdk.ProfileType.IOS_APP_ADHOC || !matches(profile)) {
    throw new AppleLoginError("Apple did not return a testing profile for this certificate and these devices.");
  }
  const local: LocalProfile = {
    appleId: profile.id, uuid: profile.attributes.uuid, bundleIdentifier: bundle.attributes.identifier,
    expiresAt: Date.parse(profile.attributes.expirationDate), deviceIds: [...deviceMap.keys()].sort(),
    mobileprovisionBase64: profile.attributes.profileContent!,
  };
  record.profiles = [...record.profiles.filter((saved) => saved.bundleIdentifier !== local.bundleIdentifier), local];
  await vault.write(account, JSON.stringify(record));
  return record;
}
