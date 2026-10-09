/** Loopback-only desktop for mobile/e2e/stream-clipboard.plan.json.
 * Start Xvfb :186 (800x600), x11vnc :5996, and Chrome with CDP :19386 at
 * http://localhost:19080/fixture. Forward :19080 to the simulator Mac.
 * This is synthetic QA text, never a customer's browser or credentials. */
import { RfbBridge } from "../src/computer/rfb-bridge";
import { computerClipboardRequest } from "../src/computer/clipboard";
const display = process.env.CLIPBOARD_TEST_DISPLAY ?? ":186";
const rfbPort = Number(process.env.CLIPBOARD_TEST_RFB_PORT ?? 5996);
const cdpOrigin = process.env.CLIPBOARD_TEST_CDP ?? "http://127.0.0.1:19386";
const targets = await (await fetch(`${cdpOrigin}/json/list`)).json() as { type: string; url: string; webSocketDebuggerUrl: string }[];
const target = targets.find(t => t.type === "page" && t.url.endsWith("/fixture"));
if (!target) throw new Error("Open the isolated fixture in the test Chrome first");
const cdp = new WebSocket(target.webSocketDebuggerUrl);
await new Promise<void>((resolve, reject) => { cdp.onopen = () => resolve(); cdp.onerror = () => reject(new Error("Test Chrome unavailable")); });
let sequence = 0;
const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
cdp.onmessage = event => {
  const message = JSON.parse(String(event.data));
  const call = pending.get(message.id);
  if (!call) return;
  pending.delete(message.id);
  if (message.error) call.reject(new Error(message.error.message));
  else call.resolve(message.result);
};
function command(method: string, params: object = {}): Promise<any> {
  return new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); cdp.send(JSON.stringify({ id, method, params })); });
}
async function evaluate(expression: string) {
  return (await command("Runtime.evaluate", { expression, returnByValue: true })).result.value;
}
async function focus() {
  const box = await evaluate("JSON.stringify(document.querySelector('textarea').getBoundingClientRect().toJSON())");
  const rect = JSON.parse(box);
  const params = { x: rect.x + 10, y: rect.y + 10, button: "left", clickCount: 1 };
  await command("Page.bringToFront");
  await command("Input.dispatchMouseEvent", { type: "mousePressed", ...params });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...params });
}
const html = `<!doctype html><style>body{margin:0;padding:25px;font:24px sans-serif;background:white}textarea{font:22px sans-serif;width:550px;height:220px}</style><h1>Clipboard test</h1><textarea autofocus></textarea><p>Isolated test desktop</p>`;
Bun.serve<{ bridge?: RfbBridge }>({
  hostname: "127.0.0.1", port: 19080,
  async fetch(req, server) {
    const path = new URL(req.url).pathname;
    if (path === "/api/computer") {
      if (server.upgrade(req, { data: {} })) return;
      return new Response("WebSocket required", { status: 400 });
    }
    if (path === "/api/computer/clipboard") return computerClipboardRequest(req, display);
    if (path === "/fixture") return new Response(html, { headers: { "Content-Type": "text/html" } });
    if (path === "/test/prepare") {
      await evaluate("document.querySelector('textarea').value = ''"); await focus();
      return Response.json({ ready: true });
    }
    if (path === "/test/select") {
      await focus(); await evaluate("document.querySelector('textarea').select()");
      return Response.json({ ready: true });
    }
    if (path === "/test/state") return Response.json({ text: await evaluate("document.querySelector('textarea').value") });
    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) { ws.data.bridge = new RfbBridge(ws, { port: rfbPort }); void ws.data.bridge.open(); },
    message(ws, message) { ws.data.bridge?.write(typeof message === "string" ? new TextEncoder().encode(message) : message); },
    close(ws) { ws.data.bridge?.close(); },
  },
});
await command("Page.reload");
console.log("Isolated clipboard fixture listening on 127.0.0.1:19080");
