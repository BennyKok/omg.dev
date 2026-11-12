import { linkDevice, unlinkDevice } from "./agent.ts";
import { deviceRuntime, type DeviceRuntime } from "./runtime.ts";

export const LOCAL_DEVICE_PREFIX = "/api/devices/_local";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "cache-control": "no-store" } });
const loopback = (host: string | undefined) => host === "127.0.0.1" || host === "::1" || host === "[::1]" || host === "::ffff:127.0.0.1" || host === "localhost";

/** Never trust a forwarded address for approvals. The actual peer is required. */
export function isLocalDeviceUi(req: Request, peerAddress?: string): boolean {
  const url = new URL(req.url);
  if (!loopback(peerAddress) || !loopback(url.hostname)) return false;
  if (["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip", "tailscale-user-login"].some((h) => req.headers.has(h))) return false;
  const origin = req.headers.get("origin");
  if (origin && origin !== url.origin) return false;
  if (req.headers.get("sec-fetch-site") === "cross-site") return false;
  return req.method === "GET" || (origin === url.origin && req.headers.get("x-omg-device-ui") === "1" && req.headers.get("content-type")?.split(";")[0] === "application/json");
}

export async function handleLocalDeviceApi(req: Request, peerAddress?: string, runtime: DeviceRuntime = deviceRuntime): Promise<Response> {
  if (!isLocalDeviceUi(req, peerAddress)) return json({ error: "Open omg.dev on this computer through localhost to manage incoming access." }, 403);
  const path = new URL(req.url).pathname;
  try {
    if (path === `${LOCAL_DEVICE_PREFIX}/events` && req.method === "GET") return receiverEvents(req, runtime);
    if (path === LOCAL_DEVICE_PREFIX && req.method === "GET") return json(runtime.snapshot());
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    const text = await req.text();
    if (text.length > 4096) return json({ error: "request too large" }, 413);
    const b = JSON.parse(text) as Record<string, unknown>;
    if (!b || typeof b !== "object" || Array.isArray(b)) return json({ error: "expected an object" }, 400);
    switch (path) {
      case `${LOCAL_DEVICE_PREFIX}/connect`:
        if (typeof b.server !== "string" || typeof b.code !== "string" || !b.code.trim()) return json({ error: "Controller address and pairing code are required." }, 400);
        await runtime.changeLink(() => linkDevice(b.server as string, (b.code as string).trim()));
        break;
      case `${LOCAL_DEVICE_PREFIX}/disconnect`:
        await runtime.stop();
        await runtime.changeLink(unlinkDevice);
        break;
      case `${LOCAL_DEVICE_PREFIX}/start`:
        runtime.start({ minutes: b.minutes, idle: b.idle });
        break;
      case `${LOCAL_DEVICE_PREFIX}/stop`:
        await runtime.stop();
        break;
      case `${LOCAL_DEVICE_PREFIX}/clear`:
        await runtime.stopAndClear();
        break;
      case `${LOCAL_DEVICE_PREFIX}/decision`:
        if (typeof b.token !== "string" || typeof b.allow !== "boolean") return json({ error: "An approval token and a decision are required." }, 400);
        runtime.decide(b.token, b.allow);
        break;
      default:
        return json({ error: "not found" }, 404);
    }
    return json(runtime.snapshot());
  } catch (e) { return json({ error: e instanceof Error ? e.message : String(e) }, 400); }
}

function receiverEvents(req: Request, runtime: DeviceRuntime): Response {
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const send = () => {
        if (closed || (controller.desiredSize ?? 0) <= 0) return;
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(runtime.snapshot())}\n\n`)); }
        catch { cleanup(); }
      };
      const unsubscribe = runtime.subscribe(send);
      // Heartbeats also pick up local config edits and CLI activity.
      const heartbeat = setInterval(send, 5000);
      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        req.signal.removeEventListener("abort", cleanup);
        try { controller.close(); } catch { /* The reader may already have cancelled. */ }
      };
      req.signal.addEventListener("abort", cleanup, { once: true });
      if (req.signal.aborted) cleanup(); else send();
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
