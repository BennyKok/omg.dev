/** Local end-to-end fixture: native WKWebView -> real runtime handler -> Chrome.
 * Requires an isolated Chrome at :19922 and a test TLS cert/key in
 * OMG_LOGIN_FIXTURE_DIR. Bind only to loopback; reverse-forward to Simulator. */
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createBrowserLoginService } from "../src/computer/login";
import { transferBrowserLogin } from "../src/computer/browser";
import { serveOmgMcpRequest } from "../src/mcp-http";

const dir = process.env.OMG_LOGIN_FIXTURE_DIR;
if (!dir) throw new Error("OMG_LOGIN_FIXTURE_DIR is required");
const session = "11111111-1111-4111-8111-111111111111";
const site = "https://127.0.0.1.nip.io:19443";
const secret = randomUUID();
const chrome = await (await fetch("http://127.0.0.1:19922/json/version")).json() as { webSocketDebuggerUrl: string };
const browser = new (Bun as any).WebView({ backend: { type: "chrome", url: chrome.webSocketDebuggerUrl } });
let verified = false;
let notified = false;
const login = createBrowserLoginService({
  session: async id => id === session ? { id, owner: "test@example.com" } : null,
  viewer: () => "test@example.com",
  available: () => true,
  computerName: () => "Test Computer",
  importCookies: async (url, cookies) => {
    await transferBrowserLogin(browser, url, cookies);
    verified = (await browser.evaluate("document.body.textContent")).includes("Test account signed in");
    if (!verified) throw new Error("Chrome did not receive the session");
    const screenshot = await browser.screenshot({ format: "png" });
    await Bun.write(join(dir, "chrome-login.png"), screenshot);
  },
  completed: async () => { notified = true; return true; },
});
const web = Bun.serve({
  hostname: "127.0.0.1", port: 19443,
  tls: { cert: Bun.file(join(dir, "cert.pem")), key: Bun.file(join(dir, "key.pem")) },
  fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/sign-in") return new Response(null, { status: 302, headers: {
      Location: "/", "Set-Cookie": `__Host-session=${secret}; Path=/; HttpOnly; Secure; SameSite=Lax`,
    } });
    const signedIn = req.headers.get("cookie")?.includes(`__Host-session=${secret}`);
    return new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Test site</title><body style="font:22px system-ui;padding:32px;color:#111;background:#fff"><h1>${signedIn ? "Test account signed in" : "Test website"}</h1>${signedIn ? "This is a test account. You can now transfer its login." : '<a style="display:block;padding:20px;background:#ddd;border-radius:12px" href="/sign-in">Sign in to test site</a>'}</body>`, { headers: { "Content-Type": "text/html", "Cache-Control": "no-store" } });
  },
});
const api = Bun.serve({ hostname: "127.0.0.1", port: 18767, async fetch(req) {
  const path = new URL(req.url).pathname;
  if (path.startsWith("/api/browser-login")) return login(req);
  if (path === "/mcp") return serveOmgMcpRequest(req, session);
  if (path === "/proof") return Response.json({ verified, notified });
  return new Response("Not found", { status: 404 });
} });
process.env.LFG_BASE = "http://127.0.0.1:18767";
// The initial request comes through the actual MCP tool, not a seeded row.
const request = await serveOmgMcpRequest(new Request("http://localhost/mcp", {
  method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {
    name: "omg_request_browser_login", arguments: { url: site, reason: "Verify the test website session on the VM" },
  } }),
}), session);
const result = await request.json() as any;
if (result.error || result.result?.isError) throw new Error("MCP did not create the test request");
console.log("Browser login fixture ready: API 18767, HTTPS site 19443. No real account data.");
process.on("SIGTERM", () => { api.stop(true); web.stop(true); process.exit(0); });
