import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { AppleLoginError } from "./apple-login";
import type { SigningVault } from "./keychain";
import type { LocalSigningRecord } from "./provisioning";

// The transport schema is owned by the hosted ios-handoff.ts. This producer
// creates exactly its v1 fields; it does not define a second validation schema.
export async function prepareSigningExport(options: {
  record: LocalSigningRecord;
  profileId: string;
  appId: string;
  expectedRevision: number | null;
  ownerId: string;
  vault: SigningVault;
  rewrap?: typeof rewrapPkcs12;
  now?: number;
}) {
  const { record, vault, ownerId, appId, expectedRevision } = options;
  const now = options.now ?? Date.now();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(appId) || !/^[A-Za-z0-9_-]{1,128}$/.test(ownerId)
    || (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1))) {
    throw new AppleLoginError("Refresh your app and team setup before exporting.");
  }
  const profile = record.profiles.find((candidate) => candidate.uuid === options.profileId);
  if (!profile || profile.expiresAt <= now || record.certificateExpiresAt <= now || !profile.deviceIds.length) {
    throw new AppleLoginError("Make a current iPhone testing profile before exporting.");
  }
  const original = Buffer.from(record.pkcs12Base64, "base64");
  const cms = Buffer.from(profile.mobileprovisionBase64, "base64");
  if (!original.length || original.length > 1024 * 1024 || !cms.length || cms.length > 4 * 1024 * 1024) {
    throw new AppleLoginError("The local signing files exceed the upload limit.");
  }
  const password = randomBytes(32).toString("base64url");
  const pkcs12 = await (options.rewrap ?? rewrapPkcs12)(original, record.pkcs12Password, password);
  if (pkcs12.length > 1024 * 1024) throw new AppleLoginError("The signing key exceeds the upload limit.");
  const payload = {
    version: 1 as const, intentId: randomUUID(), appId, selectedTeamId: record.teamId,
    deviceIds: [...new Set(profile.deviceIds)].sort(), expectedRevision,
    pkcs12Base64: pkcs12.toString("base64"), pkcs12Password: password,
    mobileprovisionBase64: cms.toString("base64"),
  };
  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body) > 8 * 1024 * 1024) throw new AppleLoginError("The signing upload exceeds the upload limit.");
  const pendingId = `${ownerId}/${record.teamId}/${payload.intentId}`;
  // Preserve the exact prepared body in Keychain. A transport retry reads it;
  // it never regenerates the key, password, intent, or expected revision.
  await vault.write(`pending/${pendingId}`, body);
  return { pendingId, intentId: payload.intentId, appId, teamId: record.teamId, profileId: profile.uuid, expectedRevision };
}

export async function preparedSigningExport(vault: SigningVault, pendingId: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]{1,128}\/[A-Z0-9]{10}\/[0-9a-f-]{36}$/.test(pendingId)) throw new AppleLoginError("Select a prepared signing upload.");
  const body = await vault.read(`pending/${pendingId}`);
  if (!body) throw new AppleLoginError("This signing upload is no longer available on this Mac.");
  return body;
}

/** Re-encrypt a PKCS12 for a new export. Secret arguments never enter argv or
 * the environment. The temporary private directory is removed in all paths. */
export async function rewrapPkcs12(input: Buffer, oldPassword: string, newPassword: string): Promise<Buffer> {
  const parent = join(homedir(), ".cache", "lfg", "tmp");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(parent, "ios-signing-export-"));
  const file = (name: string) => join(directory, name);
  const run = async (args: string[]) => {
    const child = Bun.spawn(["openssl", ...args], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    if (await child.exited !== 0) throw new AppleLoginError("The Mac could not export its signing key.");
  };
  try {
    await writeFile(file("identity.p12"), input, { mode: 0o600 });
    await writeFile(file("old-password"), oldPassword, { mode: 0o600 });
    await writeFile(file("export-password"), newPassword, { mode: 0o600 });
    await writeFile(file("identity.pem"), "", { mode: 0o600 });
    await writeFile(file("export.p12"), "", { mode: 0o600 });
    await run(["pkcs12", "-in", file("identity.p12"), "-passin", `file:${file("old-password")}`, "-nodes", "-out", file("identity.pem")]);
    await run(["pkcs12", "-export", "-in", file("identity.pem"), "-passout", `file:${file("export-password")}`, "-out", file("export.p12")]);
    return await readFile(file("export.p12"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
