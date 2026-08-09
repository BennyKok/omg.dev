import { describe, expect, test } from "bun:test";
import { createECDH, hkdfSync, createCipheriv } from "node:crypto";
import { decryptPushPayload, encryptPushPayload } from "./push-encrypt.ts";

const b64 = (s: string) =>
  new Uint8Array(
    Buffer.from(
      s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4),
      "base64",
    ),
  );
const b64u = (b: Uint8Array | Buffer) =>
  Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// RFC 8291 §5 inputs. The published ciphertext is not reproduced here; the
// cross-check below is what pins the output, byte for byte, against an
// independent implementation built on node:crypto's primitives instead of
// WebCrypto. Matching 144 bytes by coincidence is not a thing that happens.
const VECTOR = {
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  text: "When I grow up, I want to be a watermelon",
};

function jwkFor(publicPoint: string, d: string) {
  const p = b64(publicPoint);
  return { kty: "EC", crv: "P-256", x: b64u(p.slice(1, 33)), y: b64u(p.slice(33, 65)), d, ext: true };
}

/** aes128gcm built from node:crypto primitives — a second opinion, not ours. */
function referenceEncrypt(): Buffer {
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(Buffer.from(b64(VECTOR.asPrivate)));
  const shared = ecdh.computeSecret(Buffer.from(b64(VECTOR.uaPublic)));
  const keyInfo = Buffer.concat([
    Buffer.from("WebPush: info\0"),
    Buffer.from(b64(VECTOR.uaPublic)),
    Buffer.from(b64(VECTOR.asPublic)),
  ]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, Buffer.from(b64(VECTOR.auth)), keyInfo, 32));
  const salt = Buffer.from(b64(VECTOR.salt));
  const cek = Buffer.from(
    hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16),
  );
  const nonce = Buffer.from(
    hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12),
  );
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const record = Buffer.concat([Buffer.from(VECTOR.text, "utf8"), Buffer.from([0x02])]);
  const ciphertext = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096, 0);
  return Buffer.concat([salt, rs, Buffer.from([65]), Buffer.from(b64(VECTOR.asPublic)), ciphertext]);
}

describe("RFC 8291 payload encryption", () => {
  test("matches an independent node:crypto implementation byte for byte", async () => {
    const ours = await encryptPushPayload({
      p256dh: VECTOR.uaPublic,
      auth: VECTOR.auth,
      payload: VECTOR.text,
      testVector: {
        asPrivateJwk: jwkFor(VECTOR.asPublic, VECTOR.asPrivate),
        asPublic: b64(VECTOR.asPublic) as Uint8Array<ArrayBuffer>,
        salt: b64(VECTOR.salt) as Uint8Array<ArrayBuffer>,
      },
    });
    expect(b64u(ours.body)).toBe(b64u(referenceEncrypt()));
    // 16 salt + 4 rs + 1 idlen + 65 key + (41 text + 1 delimiter + 16 tag)
    expect(ours.body.length).toBe(144);
  });

  test("a real browser keypair round-trips the notification JSON", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;
    const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const uaPrivateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const authSecret = crypto.getRandomValues(new Uint8Array(16));
    const message = JSON.stringify({
      title: "Shipped: Faster search",
      body: "Results now appear instantly.",
      url: "https://omg.example/?session=abc",
      tag: "shipped-1",
    });

    const encrypted = await encryptPushPayload({
      p256dh: b64u(uaPublic),
      auth: b64u(authSecret),
      payload: message,
    });

    expect(encrypted.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(encrypted.headers["Content-Length"]).toBe(String(encrypted.body.length));
    expect(await decryptPushPayload(encrypted.body, uaPrivateJwk, uaPublic, authSecret)).toBe(
      message,
    );
  });

  test("never reuses a salt or ephemeral key across messages", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;
    const p256dh = b64u(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
    const auth = b64u(crypto.getRandomValues(new Uint8Array(16)));

    const a = await encryptPushPayload({ p256dh, auth, payload: "same" });
    const b = await encryptPushPayload({ p256dh, auth, payload: "same" });

    // Identical plaintext, different salt (bytes 0-16) and ephemeral key.
    expect(b64u(a.body.slice(0, 16))).not.toBe(b64u(b.body.slice(0, 16)));
    expect(b64u(a.body.slice(21, 86))).not.toBe(b64u(b.body.slice(21, 86)));
  });

  test("rejects malformed subscription keys instead of sending garbage", async () => {
    await expect(
      encryptPushPayload({ p256dh: b64u(new Uint8Array(10)), auth: b64u(new Uint8Array(16)), payload: "x" }),
    ).rejects.toThrow(/65-byte point/);
    await expect(
      encryptPushPayload({ p256dh: b64u(new Uint8Array(65)), auth: b64u(new Uint8Array(4)), payload: "x" }),
    ).rejects.toThrow(/16 bytes/);
  });
});
