// A stand-in for `lfg serve` that mounts ONLY the terminal routes, through the
// same src/term/routes.ts serve uses. test/browser/terminal-e2e.ts runs it as
// its own process so it can kill and restart it, the way a deploy restarts
// serve, and check that the shells (which live in the terminal host) survive.
//
//   bun test/browser/terminal-harness.ts <port> <cwd-for-sessions>
//
// The terminal host's socket and environment come from LFG_TERM_HOST_SOCKET
// and the environment this process was started with.
import type { ServerWebSocket } from "bun";
import { createTermRoutes, type TermSocketData } from "../../src/term/routes.ts";

const port = Number(process.argv[2] || 0);
const sessionCwd = process.argv[3] || process.cwd();

const routes = createTermRoutes({ sessionCwd: async () => sessionCwd, home: sessionCwd });

const server = Bun.serve<TermSocketData>({
  hostname: "127.0.0.1",
  port,
  async fetch(req, srv) {
    const url = new URL(req.url);
    const handled = await routes.handle(req, url, srv as never);
    if (handled !== null) return handled;
    return new Response("not found", { status: 404 });
  },
  websocket: {
    open: (ws: ServerWebSocket<TermSocketData>) => routes.open(ws),
    message: (ws: ServerWebSocket<TermSocketData>, m) => routes.message(ws, m as string | Uint8Array),
    close: (ws: ServerWebSocket<TermSocketData>) => routes.close(ws),
  },
});

console.log(`harness listening on ${server.port}`);
