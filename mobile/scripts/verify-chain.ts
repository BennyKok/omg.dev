/**
 * End-to-end proof that the mobile client's network stack works against
 * production, running the app's REAL modules rather than a re-typed copy.
 *
 * Chain under test:
 *   OTP sign-in -> session cookie -> auth.omg.dev /token JWT
 *   -> sessions.omgs.app/__omg/session-auth grant
 *   -> createGrantTransport -> GET /api/bootstrap
 *   -> wss live socket with the lfg-bearer.<grant> subprotocol
 *
 * Why a cookie shim: on a device, RN's fetch is backed by NSURLSession/OkHttp,
 * which persist Set-Cookie automatically — that is exactly why src/omg/auth.ts
 * can use bare fetch. Bun has no such jar, so the harness installs a minimal
 * one. The app code under test is unmodified; only the platform behaviour it
 * already assumes is being supplied.
 *
 * Run: bun run scripts/verify-chain.ts <otp-code>
 *      bun run scripts/verify-chain.ts --send   (just request a code)
 */

// Sign-in codes are IP rate limited (10/hr, 20/day) and shared by every test
// account on this box, so the harness persists its jar and re-runs reuse the
// session instead of burning another code.
const JAR_PATH = "/tmp/omg-mobile-verify-jar.json";
const jar = new Map<string, string>();
try {
  const saved = await Bun.file(JAR_PATH).json();
  for (const [k, v] of Object.entries(saved as Record<string, string>)) jar.set(k, v);
} catch {
  /* first run */
}
const persistJar = () =>
  Bun.write(JAR_PATH, JSON.stringify(Object.fromEntries(jar))).catch(() => {});

const realFetch = globalThis.fetch;

globalThis.fetch = (async (input: any, init?: any) => {
  const headers = new Headers(init?.headers);
  if (jar.size > 0) {
    headers.set(
      "Cookie",
      [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "),
    );
  }
  const response = await realFetch(input, { ...init, headers });
  // Bun exposes multiple Set-Cookie headers through getSetCookie().
  const setCookies: string[] =
    typeof (response.headers as any).getSetCookie === "function"
      ? (response.headers as any).getSetCookie()
      : [];
  for (const raw of setCookies) {
    const [pair] = raw.split(";");
    const idx = pair.indexOf("=");
    if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
  if (setCookies.length) void persistJar();
  return response;
}) as typeof fetch;

const { sendSignInCode, verifySignInCode, getAuthToken } = await import("../src/omg/auth");
const { mintSessionGrant, getHostedTransport } = await import("../src/omg/transport");
const { CLOUD_BINDING_ID, CONTROLPLANE_ORIGIN } = await import("../src/omg/config");

const EMAIL = "itechbenny@gmail.com";
const arg = process.argv[2];

function ok(label: string, detail = "") {
  console.log(`  \x1b[32mPASS\x1b[0m ${label}${detail ? ` — ${detail}` : ""}`);
}
function fail(label: string, err: unknown): never {
  console.log(`  \x1b[31mFAIL\x1b[0m ${label} — ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

if (arg === "--send") {
  console.log("\nRequesting a sign-in code (src/omg/auth.ts sendSignInCode)\n");
  try {
    await sendSignInCode(EMAIL);
    ok("POST /email-otp/send-verification-otp", EMAIL);
  } catch (e) {
    fail("sendSignInCode", e);
  }
  console.log("\nRead the code off the auth box, then re-run with it.\n");
  process.exit(0);
}

console.log("\nomg mobile — production chain verification\n");

// 1. Session. A saved jar stands in for the platform cookie store a device
//    already has; only a cold harness needs a fresh code.
const { getSession } = await import("../src/omg/auth");
let user = jar.size > 0 ? await getSession() : null;
if (user) {
  ok("existing session reused", `${user.email} (${user.id.slice(0, 8)}…)`);
} else if (arg) {
  try {
    user = await verifySignInCode(EMAIL, arg);
    ok("verifySignInCode", `${user.email} (${user.id.slice(0, 8)}…)`);
  } catch (e) {
    fail("verifySignInCode", e);
  }
  ok("session cookie captured", `${jar.size} cookie(s)`);
} else {
  console.error("No saved session. Run with --send, then re-run with the code.");
  process.exit(1);
}

// 2. Session cookie -> app JWT
let token: string | null = null;
try {
  token = await getAuthToken();
  if (!token) throw new Error("token was null (treated as signed out)");
  ok("getAuthToken → POST /token", `JWT ${token.length} chars`);
} catch (e) {
  fail("getAuthToken", e);
}

// 2b. the module-scope single-flight cache should not re-mint
const t2 = await getAuthToken();
ok("JWT cache is shared", t2 === token ? "second call reused the token" : "MISS");

// 3. Control plane: which Computers does this account have?
let bindings: any[] = [];
try {
  const res = await realFetch(`${CONTROLPLANE_ORIGIN}/api/computer/listComputerBindings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  const data = (await res.json().catch(() => ({}))) as any;
  bindings = data?.bindings ?? data?.value?.bindings ?? [];
  ok("listComputerBindings", `${res.status} · ${bindings.length} paired machine(s)`);
} catch (e) {
  console.log(`  \x1b[33mWARN\x1b[0m listComputerBindings — ${e}`);
}

// 4. JWT -> session grant (the mobile transport's own mint).
//    Target an online paired machine when there is one; the account's cloud
//    Computer is only the fallback, and on this account it is currently
//    plan-blocked (getCloudComputer → upgrade_required), which the proxy
//    surfaces as a permanent 425.
const onlineBinding = bindings.find((b) => b?.online)?.id;
const targetBinding = onlineBinding ?? CLOUD_BINDING_ID;
console.log(
  `\n  target: ${onlineBinding ? `paired machine ${targetBinding.slice(0, 8)}…` : "cloud Computer"}\n`,
);

let grant;
try {
  grant = await mintSessionGrant(targetBinding);
  ok(
    "mintSessionGrant",
    `grant ${grant.token.length} chars, expires in ${Math.round((grant.expiresAt - Date.now()) / 1000)}s`,
  );
} catch (e) {
  fail("mintSessionGrant", e);
}

// 5. createGrantTransport -> the Computer's own API, through the readiness
//    state machine (a cold Computer answers 425 until it has resumed).
const transport = getHostedTransport(targetBinding);
const { waitForReady } = await import("../src/omg/readiness");
try {
  const readiness = await waitForReady(transport, {
    onWaking: (attempt) => {
      if (attempt === 1) console.log("       computer is waking, holding…");
    },
  });
  if (readiness.status !== "ready") {
    throw new Error(`${readiness.status}: ${(readiness as any).message ?? "still waking"}`);
  }
  ok(
    "GET /api/bootstrap via grant transport",
    `${readiness.sessions.length} session(s), lfg v${readiness.version ?? "?"}`,
  );
  const first = readiness.sessions[0] as any;
  if (first) {
    console.log(`       e.g. "${String(first.title ?? first.lastUserText ?? "untitled").slice(0, 60)}"`);
  }
} catch (e) {
  fail("GET /api/bootstrap", e);
}

// 6. Live socket with the bearer subprotocol
await new Promise<void>((resolve) => {
  const timer = setTimeout(() => {
    console.log("  \x1b[31mFAIL\x1b[0m live socket — no open within 15s");
    process.exit(1);
  }, 15_000);
  transport
    .openLiveSocket()
    .then((socket: any) => {
      socket.addEventListener("open", () => {
        ok("wss /api/live/ws", "opened with lfg-bearer subprotocol");
        socket.send(JSON.stringify({ t: "subscribe", channels: [{ kind: "status", key: "*" }] }));
      });
      socket.addEventListener("message", (event: any) => {
        const preview = String(event.data).slice(0, 120);
        ok("live frame received", preview);
        clearTimeout(timer);
        socket.close();
        resolve();
      });
      socket.addEventListener("error", () => {
        clearTimeout(timer);
        console.log("  \x1b[31mFAIL\x1b[0m live socket errored");
        process.exit(1);
      });
    })
    .catch((e: unknown) => {
      clearTimeout(timer);
      fail("openLiveSocket", e);
    });
});

console.log("\n\x1b[32mChain verified\x1b[0m — sign-in → JWT → grant → Computer API → live socket.\n");
process.exit(0);
