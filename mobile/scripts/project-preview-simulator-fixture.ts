/** Local fixture for project-preview-simulator.plan.json. Forward port 18491 to the Mac. */
let state: "idle" | "ready" = "idle";
let stream = "A";
let polls = 0;
let released = false;
const loads: Record<string, number> = {};
const taps: Record<string, number> = {};
const base = "http://localhost:18491";

Bun.serve({
  hostname: "127.0.0.1", port: 18491,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/checks") return Response.json({ loads, taps, polls, stream, released });
    if (url.pathname === "/replace" && request.method === "POST") {
      stream = "B";
      state = "ready";
      return Response.json({ ok: true });
    }
    if (url.pathname === "/action" && request.method === "POST") {
      const { action } = await request.json();
      state = action === "start" ? "ready" : "idle";
      released = action === "stop";
      return Response.json({ state });
    }
    if (url.pathname === "/snapshot") {
      if (state === "ready") polls++;
      return Response.json({
        live: true,
        preview: {
          sessionId: "88888888-8888-4888-8888-888888888888", title: "My simulator app",
          url: `${base}/web`, expoGoUrl: "exp://localhost:18491", port: 18491,
          kind: "sandbox-preview", visibility: "owner", temporary: true, createdAt: 1,
        },
        simulator: state === "ready" ? { state, streamId: stream, streamUrl: `${base}/sim/${stream}?token=rotation-${polls}` } : { state },
      });
    }
    if (url.pathname === "/tap" && request.method === "POST") {
      taps[url.searchParams.get("stream") ?? ""] = Number(url.searchParams.get("value"));
      return Response.json({ ok: true });
    }
    const id = url.pathname.match(/^\/sim\/([AB])$/)?.[1];
    if (id) {
      loads[id] = (loads[id] ?? 0) + 1;
      return new Response(`<!doctype html><html><meta name="viewport" content="width=device-width, initial-scale=1"><style>
        body{margin:0;padding:28px;font:26px system-ui;background:#162333;color:white}button{font:24px system-ui;padding:24px;background:#8cdebc;border:0;border-radius:16px}
        </style><h1>Stream ${id} ready</h1><button id="tap">Tap preview</button><p id="count">Preview taps: 0</p><script>
        let count=0;document.querySelector('#tap').onclick=()=>{count++;document.querySelector('#count').textContent='Preview taps: '+count;fetch('/tap?stream=${id}&value='+count,{method:'POST'});};
        </script></html>`, { headers: { "content-type": "text/html", "cache-control": "no-store" } });
    }
    if (url.pathname === "/web") return new Response('<!doctype html><meta name="viewport" content="width=device-width"><h1>Web fallback ready</h1>', { headers: { "content-type": "text/html" } });
    return new Response("Not found", { status: 404 });
  },
});
console.log("Simulator preview fixture on 127.0.0.1:18491");
