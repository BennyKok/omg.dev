/** Bounded, device-local timings. Never retain URLs, headers, tokens, or response bodies. */
export type ConnectionTiming = { stage: string; atMs: number; durationMs: number; size?: number; failed?: boolean };
const origin = performance.now();
let entries: ConnectionTiming[] = [];
const listeners = new Set<() => void>();
export function recordConnectionTiming(stage: string, started = performance.now(), extra: Pick<ConnectionTiming, "size" | "failed"> = {}) {
  const end = performance.now();
  entries = [...entries.slice(-99), { stage, atMs: Math.round(started - origin), durationMs: Math.round((end - started) * 10) / 10, ...extra }];
  for (const listener of listeners) listener();
}
export const connectionTimings = () => entries;
export function clearConnectionTimings() { entries = []; for (const listener of listeners) listener(); }
export function subscribeConnectionTimings(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export async function timeConnection<T>(stage: string, action: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try { const result = await action(); recordConnectionTiming(stage, started); return result; }
  catch (error) { recordConnectionTiming(stage, started, { failed: true }); throw error; }
}
export async function readConnectionJson(response: Response, stage: string): Promise<any> {
  const text = await response.text();
  const started = performance.now();
  try { return text ? JSON.parse(text) : {}; }
  finally { recordConnectionTiming(`${stage}.parse`, started, { size: text.length }); }
}
export function requestStage(input: RequestInfo | URL): string {
  let path = "";
  try { path = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname; } catch {}
  if (path === "/api/bootstrap") return "bootstrap";
  if (path === "/api/sessions") return "sessions";
  if (/^\/api\/sessions\/[^/]+\/messages$/.test(path)) return "messages";
  if (path === "/__omg/session-auth") return "grant";
  return "request";
}
/** Includes native response delivery; it cannot distinguish native copies from network time. */
export const tracedFetch: typeof fetch = async (input, init) => {
  const stage = requestStage(input);
  const response = await timeConnection(`${stage}.headers`, () => fetch(input, init));
  return new Proxy(response, {
    get(target, key) {
      if (key === "text") return () => timeConnection(`${stage}.body`, async () => {
        const text = await target.text();
        recordConnectionTiming(`${stage}.size`, performance.now(), { size: text.length });
        return text;
      });
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
};

export function traceConnectionTransport(transport: import("@omg-dev/client").OmgTransport) {
  const request = transport.request.bind(transport);
  transport.request = <T>(path: string, init?: RequestInit) => timeConnection(
    `${requestStage(new URL(path, "https://connection.invalid"))}.complete`, () => request<T>(path, init),
  );
  const open = transport.openLiveSocket.bind(transport);
  transport.openLiveSocket = async query => {
    const started = performance.now();
    const socket = await open(query);
    socket.addEventListener("open", () => recordConnectionTiming("socket.open", started));
    let first = true;
    socket.addEventListener("message", event => {
      if (!first || typeof event.data !== "string") return;
      first = false;
      recordConnectionTiming("socket.first-frame", started);
    });
    return socket;
  };
  return transport;
}
