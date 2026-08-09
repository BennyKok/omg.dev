// RFC 8291 Web Push payload encryption (aes128gcm), on Bun's WebCrypto only.
//
// Why this exists: payload-less push made the service worker fetch the notice
// from /api/push/pending. That is a same-origin assumption. It holds for
// standalone `lfg serve` (UI and API on one origin) and breaks the moment the
// UI is hosted somewhere else and the box is self-hosted — the worker that
// receives the push lives on the HOST's origin, where /api/push/pending is the
// host's server, not yours, and the worker has no grant token to reach yours.
//
// An encrypted payload needs no callback at all: the notice travels inside the
// push, the browser decrypts it, and any service worker that renders
// event.data.json() shows it. That is the interoperable contract, so it works
// whether the receiving worker is ours or the host's.
//
// Reference: RFC 8291 (Message Encryption for Web Push) over RFC 8188
// (aes128gcm content encoding).

import type { webcrypto } from "node:crypto";

// Server-side file: the DOM lib is not loaded here, so take the WebCrypto JWK
// type from node rather than assuming a global.
type JsonWebKey = webcrypto.JsonWebKey;

/**
 * WebCrypto's typings only accept views backed by a plain ArrayBuffer, while
 * Buffer.from()/subarray() produce ArrayBufferLike-backed views. Copying into a
 * fresh Uint8Array is what makes every buffer here satisfy that, and it keeps
 * key material off any pooled Buffer allocation.
 */
type Bytes = Uint8Array<ArrayBuffer>;

function bytes(view: Uint8Array): Bytes {
  const out = new Uint8Array(view.length);
  out.set(view);
  return out;
}

const RECORD_SIZE = 4096;

/** RFC 8188 header is salt(16) + rs(4) + idlen(1) + keyid; keyid is our 65-byte key. */
const AS_PUBLIC_LEN = 65;

function b64urlToBytes(value: string): Bytes {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const b64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return bytes(Buffer.from(b64, "base64"));
}

function concat(...parts: Uint8Array[]): Bytes {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** HKDF-SHA256 (extract + expand in one WebCrypto call). */
async function hkdf(
  ikm: Bytes,
  salt: Bytes,
  info: Bytes,
  length: number,
): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: salt, info: info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

export type EncryptedPush = {
  body: Bytes;
  headers: Record<string, string>;
};

export type EncryptInput = {
  /** Subscription's p256dh: the UA public key, base64url, 65-byte raw point. */
  p256dh: string;
  /** Subscription's auth secret, base64url, 16 bytes. */
  auth: string;
  /** UTF-8 payload (our notification JSON). */
  payload: string;
  /**
   * Test seam only. Production always generates a fresh ephemeral keypair and
   * random salt — reusing either across messages would leak the plaintext.
   */
  testVector?: {
    asPrivateJwk: JsonWebKey;
    asPublic: Bytes;
    salt: Bytes;
  };
};

/**
 * Encrypt one notification for one subscription. Returns the body and the
 * headers the push service requires alongside it.
 *
 * Throws when the subscription predates key capture (no p256dh/auth) — the
 * caller falls back to a payload-less push rather than dropping the message.
 */
export async function encryptPushPayload(input: EncryptInput): Promise<EncryptedPush> {
  const uaPublic = b64urlToBytes(input.p256dh);
  const authSecret = b64urlToBytes(input.auth);
  if (uaPublic.length !== AS_PUBLIC_LEN) {
    throw new Error(`p256dh must be a ${AS_PUBLIC_LEN}-byte point, got ${uaPublic.length}`);
  }
  if (authSecret.length !== 16) {
    throw new Error(`auth secret must be 16 bytes, got ${authSecret.length}`);
  }

  // Ephemeral sender keypair — one per message, per RFC 8291 §3.1.
  let asPrivate: CryptoKey;
  let asPublic: Bytes;
  let salt: Bytes;
  if (input.testVector) {
    asPrivate = await crypto.subtle.importKey(
      "jwk",
      input.testVector.asPrivateJwk,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
    asPublic = input.testVector.asPublic;
    salt = input.testVector.salt;
  } else {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;
    asPrivate = pair.privateKey;
    asPublic = bytes(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
    salt = crypto.getRandomValues(new Uint8Array(16));
  }

  const uaKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = bytes(
    new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256)),
  );

  // RFC 8291 §3.4: the shared secret is bound to both public keys before it
  // becomes the content-encryption IKM, so a captured key can't be replayed
  // against a different subscription.
  const keyInfo = concat(
    new TextEncoder().encode("WebPush: info\0"),
    uaPublic,
    asPublic,
  );
  const ikm = await hkdf(shared, authSecret, keyInfo, 32);

  const cek = await hkdf(ikm, salt, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(ikm, salt, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);

  // Single record: plaintext followed by the 0x02 last-record delimiter.
  const record = concat(new TextEncoder().encode(input.payload), new Uint8Array([0x02]));
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, [
    "encrypt",
  ]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, tagLength: 128 },
      aesKey,
      record,
    ),
  );

  const rs: Bytes = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, RECORD_SIZE, false);
  const body = concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ciphertext);

  return {
    body,
    headers: {
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "Content-Length": String(body.length),
    },
  };
}

/**
 * Decrypt an aes128gcm body with the receiver's keys. Not used in production —
 * it exists so the encryptor is verified against a real round trip rather than
 * against itself.
 */
export async function decryptPushPayload(
  body: Uint8Array,
  uaPrivateJwk: JsonWebKey,
  uaPublic: Uint8Array,
  authSecret: Uint8Array,
): Promise<string> {
  const salt = bytes(body.slice(0, 16));
  const idlen = body[20];
  const asPublic = bytes(body.slice(21, 21 + idlen));
  const ciphertext = bytes(body.slice(21 + idlen));

  const uaPrivate = await crypto.subtle.importKey(
    "jwk",
    uaPrivateJwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  const asKey = await crypto.subtle.importKey(
    "raw",
    asPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = bytes(
    new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, uaPrivate, 256)),
  );
  const keyInfo = concat(new TextEncoder().encode("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(shared, bytes(authSecret), keyInfo, 32);
  const cek = await hkdf(ikm, salt, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(ikm, salt, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, [
    "decrypt",
  ]);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce, tagLength: 128 },
      aesKey,
      ciphertext,
    ),
  );
  // Strip the padding delimiter and any trailing zero padding.
  let end = plain.length;
  while (end > 0 && plain[end - 1] === 0) end--;
  return new TextDecoder().decode(plain.slice(0, end - 1));
}
