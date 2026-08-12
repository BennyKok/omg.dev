/**
 * What Computers does this account actually have, and what state are they in?
 * Mirrors the control-plane calls the home screen makes on mount.
 */
const JAR_PATH = "/tmp/omg-mobile-verify-jar.json";
const jar = new Map<string, string>();
try {
  const saved = await Bun.file(JAR_PATH).json();
  for (const [k, v] of Object.entries(saved as Record<string, string>)) jar.set(k, v);
} catch {}
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const headers = new Headers(init?.headers);
  if (jar.size) headers.set("Cookie", [...jar].map(([k, v]) => `${k}=${v}`).join("; "));
  return realFetch(input, { ...init, headers });
}) as typeof fetch;

const { getAuthToken } = await import("../src/omg/auth");
const { CONTROLPLANE_ORIGIN } = await import("../src/omg/config");

const token = await getAuthToken();
if (!token) {
  console.error("not signed in — run verify-chain.ts first");
  process.exit(1);
}

async function cp(name: string, body: unknown = {}) {
  const res = await realFetch(`${CONTROLPLANE_ORIGIN}/api/computer/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  let data: any = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text.slice(0, 200) };
  }
  return { status: res.status, data };
}

const bindings = await cp("listComputerBindings");
console.log("\nlistComputerBindings:", bindings.status);
console.log(JSON.stringify(bindings.data, null, 2).slice(0, 1200));

const cloud = await cp("getCloudComputer");
console.log("\ngetCloudComputer:", cloud.status);
console.log(JSON.stringify(cloud.data, null, 2).slice(0, 1500));
