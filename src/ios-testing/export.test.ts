import { describe, expect, test } from "bun:test";
import { prepareSigningExport, preparedSigningExport } from "./export";
import type { LocalSigningRecord } from "./provisioning";
import type { SigningVault } from "./keychain";
const record: LocalSigningRecord = {
  version: 1, teamId: "ABCDEFGHIJ", certificateId: "cert1", certificateSha256: "a".repeat(64),
  certificateExpiresAt: 2e12, pkcs12Base64: Buffer.from("original PKCS12").toString("base64"), pkcs12Password: "original-password",
  profiles: [{ appleId: "opaque-profile-id", uuid: "profile1", bundleIdentifier: "*", expiresAt: 2e12,
    deviceIds: ["phone1", "phone2"], mobileprovisionBase64: Buffer.from("exact CMS bytes").toString("base64") }],
};
function fixture() {
  const stored = new Map<string, string>();
  const vault: SigningVault = { read: async (key) => stored.get(key) ?? null, write: async (key, value) => { stored.set(key, value); } };
  return { stored, vault };
}
describe("desktop signing export", () => {
  test("prepares only v1 fields, and retries preserve every prepared byte", async () => {
    const { vault } = fixture(); let conversions = 0;
    const prepared = await prepareSigningExport({ record, vault, appId: "app_1", ownerId: "owner_1", profileId: "profile1", expectedRevision: 7, now: 1e12,
      rewrap: async (_bytes, previous, next) => { conversions++; expect(previous).toBe("original-password"); expect(next).not.toBe(previous); return Buffer.from("new PKCS12"); } });
    const body = await preparedSigningExport(vault, prepared.pendingId);
    const payload = JSON.parse(body);
    expect(Object.keys(payload).sort()).toEqual(["version", "intentId", "appId", "selectedTeamId", "deviceIds", "expectedRevision", "pkcs12Base64", "pkcs12Password", "mobileprovisionBase64"].sort());
    expect(payload.expectedRevision).toBe(7);
    expect(payload.deviceIds).toEqual(["phone1", "phone2"]);
    expect(Buffer.from(payload.mobileprovisionBase64, "base64").toString()).toBe("exact CMS bytes");
    expect(await preparedSigningExport(vault, prepared.pendingId)).toBe(body);
    expect(conversions).toBe(1);
    expect(JSON.stringify(prepared)).not.toContain("PKCS12");
    expect(JSON.stringify(prepared)).not.toContain(payload.pkcs12Password);
  });
  test("create-only null is retained and each deliberate export gets a new intent/password", async () => {
    const { vault } = fixture();
    const options = { record, vault, appId: "app_1", ownerId: "owner_1", profileId: "profile1", expectedRevision: null, now: 1e12, rewrap: async () => Buffer.from("new PKCS12") };
    const first = await prepareSigningExport(options), second = await prepareSigningExport(options);
    const a = JSON.parse(await preparedSigningExport(vault, first.pendingId));
    const b = JSON.parse(await preparedSigningExport(vault, second.pendingId));
    expect(a.expectedRevision).toBeNull(); expect(a.intentId).not.toBe(b.intentId); expect(a.pkcs12Password).not.toBe(b.pkcs12Password);
  });
  test("refuses stale local profiles before exporting private material", async () => {
    const { vault } = fixture(); let exported = false;
    await expect(prepareSigningExport({ record, vault, appId: "app_1", ownerId: "owner_1", profileId: "profile1", expectedRevision: null, now: 3e12,
      rewrap: async () => { exported = true; return Buffer.from("test"); } })).rejects.toThrow("current");
    expect(exported).toBe(false);
  });
});
