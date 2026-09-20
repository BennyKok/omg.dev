/**
 * A persistent Maestro session on the Mac, over `maestro mcp`.
 *
 * `maestro test` starts a JVM and re-attaches the device driver on every
 * call: five seconds of overhead before the first tap. A decision loop that
 * looks at the screen between every action cannot pay that per step. The MCP
 * server pays it once. It speaks JSON-RPC over stdio, so this pipes it through
 * one ssh and keeps the process for the whole run.
 *
 * Two tools are used: `inspect_screen` (the accessibility tree as compact
 * JSON) and `run` (inline flow YAML). Nothing else.
 */

export type McpSession = {
  inspect: () => Promise<any>;
  run: (yaml: string, env?: Record<string, string>) => Promise<{ ok: boolean; text: string }>;
  close: () => void;
};

export async function openMaestroMcp(
  host: string,
  remoteEnv: string,
  deviceId: string,
): Promise<McpSession> {
  const port = process.env.OMG_MAESTRO_DRIVER_PORT;
  if (port && (!/^\d+$/.test(port) || +port < 1024 || +port > 65535)) {
    throw new Error("OMG_MAESTRO_DRIVER_PORT must be a port from 1024 to 65535");
  }
  if (port) {
    const { isolatedMaestroSession } = await import("./maestro-cli-session");
    return isolatedMaestroSession(host, remoteEnv, deviceId, Number(port));
  }
  const p = Bun.spawn(["ssh", "-o", "BatchMode=yes", host, `${remoteEnv} maestro mcp 2>/dev/null`], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const pending = new Map<number, (v: any) => void>();
  let nextId = 1;

  (async () => {
    const reader = p.stdout.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith("{")) continue;
        try {
          const msg = JSON.parse(line);
          const resolve = pending.get(msg.id);
          if (resolve) {
            pending.delete(msg.id);
            resolve(msg);
          }
        } catch {
          // Not a frame. The server also prints a viewer notice.
        }
      }
    }
    for (const resolve of pending.values()) resolve({ error: { message: "maestro mcp exited" } });
    pending.clear();
  })();

  const send = (obj: object) => {
    p.stdin.write(JSON.stringify(obj) + "\n");
    p.stdin.flush();
  };
  const call = (method: string, params: object, timeoutMs = 120_000): Promise<any> => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`maestro mcp: ${method} timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);
      pending.set(id, (msg) => {
        clearTimeout(t);
        if (msg.error) reject(new Error(`maestro mcp: ${msg.error.message ?? JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      });
      send({ jsonrpc: "2.0", id, method, params });
    });
  };

  await call("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "omg-e2e", version: "1.0" },
  });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });

  const text = (result: any) =>
    ((result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "").join("\n");

  return {
    async inspect() {
      const result = await call("tools/call", { name: "inspect_screen", arguments: { device_id: deviceId } });
      // The payload is the longest text part; the server may prepend a notice.
      const parts = ((result?.content ?? []) as { text?: string }[]).map((c) => c.text ?? "");
      const raw = parts.sort((a, b) => b.length - a.length)[0] ?? "";
      const start = raw.indexOf("{");
      if (start === -1) throw new Error(`inspect_screen returned no JSON: ${raw.slice(0, 200)}`);
      return JSON.parse(raw.slice(start));
    },
    async run(yaml, env) {
      const result = await call("tools/call", {
        name: "run",
        arguments: { device_id: deviceId, yaml, ...(env ? { env } : {}) },
      });
      return { ok: !result?.isError, text: text(result) };
    },
    close() {
      try {
        p.stdin.end();
      } catch {}
      p.kill();
    },
  };
}
