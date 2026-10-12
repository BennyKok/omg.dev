import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { macSigningVault, type SigningVault } from "./keychain";
import { prepareIosTestingProfile, signingVaultAccount, type ProvisioningSdk } from "./provisioning";
import { devicesFromUsbmux } from "./devices";

const connection = { appleId: "test@example.com", teamId: "ABCDEFGHIJ", teamName: "Test team" };
const now = Date.parse("2026-10-12T00:00:00Z");
const expiry = "2027-10-12T00:00:00Z";
function fixture() {
  const stored = new Map<string, string>();
  const vault: SigningVault = { read: async (key) => stored.get(key) ?? null, write: async (key, value) => { stored.set(key, value); } };
  let certificatesCreated = 0;
  const cert = { id: "cert1", attributes: { expirationDate: expiry, certificateContent: Buffer.from("certificate DER").toString("base64"), status: "Issued" } };
  const bundle = { id: "bundle1", attributes: { identifier: "*" } };
  const devices: Array<{ id: string; attributes: { udid: string; status: string } }> = [];
  const profiles: Array<{ id: string; attributes: Record<string, any> }> = [];
  const profileRequests: any[] = [];
  const sdk = {
    CertificateType: { DISTRIBUTION: "DISTRIBUTION" }, ProfileType: { IOS_APP_ADHOC: "IOS_APP_ADHOC" },
    Certificate: { infoAsync: async () => cert },
    createCertificateAndP12Async: async () => { certificatesCreated++; return { certificate: cert, certificateP12: "cDEy", password: "random-export-password" }; },
    Device: {
      getAllIOSProfileDevicesAsync: async () => devices,
      createAsync: async (_: unknown, value: { udid: string }) => {
        const device = { id: `device${devices.length + 1}`, attributes: { udid: value.udid, status: "ENABLED" } }; devices.push(device); return device;
      },
    },
    BundleId: { findAsync: async () => bundle, createAsync: async () => { throw new Error("existing bundle must be reused"); } },
    Profile: {
      getAsync: async () => profiles,
      createAsync: async (_: unknown, value: any) => {
        profileRequests.push(value);
        const profile = { id: `profile${profiles.length + 1}`, attributes: {
          uuid: randomUUID(), profileType: "IOS_APP_ADHOC", profileContent: Buffer.from("signed CMS profile").toString("base64"),
          expirationDate: expiry, bundleId: bundle, certificates: [cert], devices: devices.filter((device) => value.devices.includes(device.id)),
        } }; profiles.push(profile); return profile;
      },
      infoAsync: async (_: unknown, value: { id: string }) => profiles.find((profile) => profile.id === value.id),
    },
  };
  const prepare = (ids: string[]) => prepareIosTestingProfile({
    sdk: sdk as unknown as ProvisioningSdk, connection, context: { teamId: connection.teamId }, vault, now,
    devices: ids.map((udid) => ({ udid, name: "Test iPhone" })),
  });
  return { stored, sdk, vault, cert, profiles, profileRequests, prepare, certificatesCreated: () => certificatesCreated };
}

describe("local Apple provisioning", () => {
  test("reuses the saved key/certificate/profile on repeat setup", async () => {
    const f = fixture();
    const first = await f.prepare(["phone1"]);
    const second = await f.prepare(["phone1"]);
    expect(f.certificatesCreated()).toBe(1);
    expect(f.profileRequests).toHaveLength(1);
    expect(second.certificateSha256).toBe(first.certificateSha256);
    expect(second.profiles[0].uuid).toBe(first.profiles[0].uuid);
  });
  test("keeps the matching private key when a later Apple call fails", async () => {
    const f = fixture(); const create = f.sdk.Profile.createAsync;
    f.sdk.Profile.createAsync = async () => { throw new Error("Apple temporarily unavailable"); };
    await expect(f.prepare(["phone1"])).rejects.toThrow();
    const saved = JSON.parse(f.stored.get(signingVaultAccount(connection))!);
    expect(saved.pkcs12Base64).toBe("cDEy"); expect(saved.profiles).toEqual([]);
    f.sdk.Profile.createAsync = create;
    await f.prepare(["phone1"]);
    expect(f.certificatesCreated()).toBe(1);
  });
  test("adding a phone preserves previous device coverage", async () => {
    const f = fixture(); await f.prepare(["phone1"]);
    const second = await f.prepare(["phone2"]);
    expect(second.profiles[0].deviceIds).toEqual(["phone1", "phone2"]);
    expect(f.profileRequests[1].devices.sort()).toEqual(["device1", "device2"]);
    expect(f.certificatesCreated()).toBe(1);
  });
  test("rejects revoked or expired certificates without replacing them", async () => {
    const f = fixture(); await f.prepare(["phone1"]); f.cert.attributes.status = "Revoked";
    await expect(f.prepare(["phone2"])).rejects.toThrow("needs renewal");
    expect(f.certificatesCreated()).toBe(1); expect(f.profiles).toHaveLength(1);
  });
  test("requires an actual selected device before creating a certificate", async () => {
    const f = fixture(); await expect(f.prepare([])).rejects.toThrow("select it");
    expect(f.certificatesCreated()).toBe(0);
  });
  test("does not save a profile with missing device coverage", async () => {
    const f = fixture(); const info = f.sdk.Profile.infoAsync;
    f.sdk.Profile.infoAsync = async (context, value) => { const profile = await info(context, value); profile!.attributes.devices = []; return profile; };
    await expect(f.prepare(["phone1"])).rejects.toThrow("these devices");
    expect(JSON.parse(f.stored.get(signingVaultAccount(connection))!).profiles).toEqual([]);
  });
});

test("USB discovery excludes network devices and invalid serials", () => {
  expect(devicesFromUsbmux({ DeviceList: [
    { Properties: { ConnectionType: "USB", SerialNumber: "00008110-ABCDEF1234567890" } },
    { Properties: { ConnectionType: "USB", SerialNumber: "00008110-abcdef1234567890" } },
    { Properties: { ConnectionType: "Network", SerialNumber: "other" } },
    { Properties: { ConnectionType: "USB", SerialNumber: "../unsafe" } },
  ] })).toEqual([{ udid: "00008110-ABCDEF1234567890", name: "iPhone or iPad" }]);
});

(process.platform === "darwin" && process.env.OMG_NATIVE_KEYCHAIN_TEST === "1" ? test : test.skip)("native Keychain preserves a signing record and can remove the test item", async () => {
  const vault = macSigningVault(); const account = `test/${randomUUID()}`;
  const payload = JSON.stringify({ pkcs12Base64: "test-fixture", pkcs12Password: "test-secret" });
  try {
    expect(await vault.read(account)).toBeNull();
    await vault.write(account, payload); expect(await vault.read(account)).toBe(payload);
    await vault.write(account, "updated-fixture"); expect(await vault.read(account)).toBe("updated-fixture");
  } finally { await vault.remove!(account); }
  expect(await vault.read(account)).toBeNull();
});
