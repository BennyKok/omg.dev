// The egress proxy: a per-box HTTP CONNECT proxy that a sandboxed session's
// harness is pointed at, so its outbound traffic reaches only an allowlist of
// hosts (the model API, plus whatever the role permits) and nothing else.
//
// This is the "best-effort" layer of network isolation (docs/team-tooling-
// design.md): the harness gets HTTP_PROXY / HTTPS_PROXY in its environment and
// the SDKs honour them, so ordinary model and tool traffic is filtered and
// logged. It is not a jail on its own — an agent that dials a raw IP past the
// proxy env escapes it. The strict layer that closes that gap is an
// `--unshare-net` namespace with nftables allowing only this proxy, added
// separately; this proxy is what that namespace would forward to.
//
// One in-process listener on loopback identifies the calling session from the
// proxy credentials (the same per-session token the MCP endpoints use), so a
// single proxy serves every session and each is held to its own role's
// allowlist.
import http from "node:http";
import net from "node:net";

export type EgressResolution = { sessionId: string; allow: string[] } | null;

/** Hosts every sandboxed session may reach regardless of role: the model APIs. */
export const DEFAULT_ALLOW_HOSTS = [
  ".anthropic.com",
  ".openai.com",
  ".openai.azure.com",
  ".googleapis.com",
  ".x.ai",
  ".deepseek.com",
  ".githubusercontent.com",
];

/**
 * Does `host` match one entry of `allow`?
 *
 * An entry that starts with a dot is a suffix match on the domain
 * (`.anthropic.com` allows `api.anthropic.com` and `anthropic.com`); anything
 * else is an exact host match. Case-insensitive; a trailing dot on the host is
 * ignored.
 */
export function hostAllowed(host: string, allow: string[]): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!h) return false;
  for (const raw of allow) {
    const entry = raw.trim().toLowerCase().replace(/\.$/, "");
    if (!entry) continue;
    if (entry.startsWith(".")) {
      const domain = entry.slice(1);
      if (h === domain || h.endsWith(entry)) return true;
    } else if (h === entry) {
      return true;
    }
  }
  return false;
}

/** Split `host:port` from a CONNECT target or an absolute URL authority. */
export function parseHostPort(target: string, defaultPort: number): { host: string; port: number } | null {
  // IPv6 literal in brackets.
  const v6 = target.match(/^\[([0-9a-fA-F:]+)\](?::(\d+))?$/);
  if (v6) return { host: v6[1]!, port: v6[2] ? Number(v6[2]) : defaultPort };
  const idx = target.lastIndexOf(":");
  if (idx > 0 && /^\d+$/.test(target.slice(idx + 1))) {
    return { host: target.slice(0, idx), port: Number(target.slice(idx + 1)) };
  }
  return target ? { host: target, port: defaultPort } : null;
}

/** Read the sessionId and token from a Proxy-Authorization: Basic header. */
export function credentialsFromProxyAuth(header: string | undefined): { sessionId: string; token: string } | null {
  if (!header) return null;
  const m = header.match(/^Basic\s+(.+)$/i);
  if (!m) return null;
  let decoded: string;
  try {
    decoded = Buffer.from(m[1]!, "base64").toString("utf8");
  } catch {
    return null;
  }
  const sep = decoded.indexOf(":");
  if (sep < 0) return null;
  return { sessionId: decoded.slice(0, sep), token: decoded.slice(sep + 1) };
}

export interface EgressProxy {
  port: number;
  /** The HTTP_PROXY value a session uses: carries its own credentials. */
  proxyUrlFor: (sessionId: string, token: string) => string;
  stop: () => void;
}

export interface EgressProxyOptions {
  /** Resolve the caller from its proxy credentials to a session + allowlist. */
  resolve: (sessionId: string, token: string) => EgressResolution;
  /** Preferred loopback port; falls back to an ephemeral one. */
  port?: number;
  log?: (line: string) => void;
}

/**
 * Start the loopback egress proxy. Returns once it is listening.
 *
 * CONNECT (HTTPS) is the path that matters — every model API is TLS — and is
 * tunnelled byte-for-byte after the allowlist check. Plain HTTP requests are
 * checked the same way and refused when not allowed; the proxy does not try to
 * be a general forward cache.
 */
export function startEgressProxy(opts: EgressProxyOptions): Promise<EgressProxy> {
  const log = opts.log ?? (() => {});
  const server = http.createServer();

  // Plain HTTP through the proxy: the request line carries an absolute URL.
  server.on("request", (req, res) => {
    const creds = credentialsFromProxyAuth(req.headers["proxy-authorization"] as string | undefined);
    const resolved = creds ? opts.resolve(creds.sessionId, creds.token) : null;
    if (!resolved) {
      res.writeHead(407, { "Proxy-Authenticate": 'Basic realm="omg-egress"' });
      res.end("proxy authentication required");
      return;
    }
    let url: URL;
    try {
      url = new URL(req.url ?? "");
    } catch {
      res.writeHead(400);
      res.end("the egress proxy only forwards absolute-form requests");
      return;
    }
    if (!hostAllowed(url.hostname, resolved.allow)) {
      log(`[egress] deny ${resolved.sessionId} http ${url.hostname}`);
      res.writeHead(403);
      res.end(`host ${url.hostname} is not allowed for this session`);
      return;
    }
    log(`[egress] allow ${resolved.sessionId} http ${url.hostname}`);
    const upstream = http.request(
      {
        host: url.hostname,
        port: url.port ? Number(url.port) : 80,
        method: req.method,
        path: url.pathname + url.search,
        headers: { ...req.headers, "proxy-authorization": undefined },
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end("upstream unreachable");
    });
    req.pipe(upstream);
  });

  // CONNECT: the HTTPS tunnel. Authorise, then splice the two sockets.
  server.on("connect", (req, clientSocket, head) => {
    const creds = credentialsFromProxyAuth(req.headers["proxy-authorization"] as string | undefined);
    const resolved = creds ? opts.resolve(creds.sessionId, creds.token) : null;
    if (!resolved) {
      clientSocket.write("HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm=\"omg-egress\"\r\n\r\n");
      clientSocket.end();
      return;
    }
    const target = parseHostPort(req.url ?? "", 443);
    if (!target || !hostAllowed(target.host, resolved.allow)) {
      log(`[egress] deny ${resolved.sessionId} connect ${req.url}`);
      clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      clientSocket.end();
      return;
    }
    log(`[egress] allow ${resolved.sessionId} connect ${target.host}:${target.port}`);
    const upstream = net.connect(target.port, target.host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    const drop = () => {
      upstream.destroy();
      clientSocket.destroy();
    };
    upstream.on("error", drop);
    clientSocket.on("error", drop);
  });

  return new Promise((resolve) => {
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : (opts.port ?? 0);
      log(`[egress] listening on 127.0.0.1:${port}`);
      resolve({
        port,
        proxyUrlFor: (sessionId, token) =>
          `http://${encodeURIComponent(sessionId)}:${encodeURIComponent(token)}@127.0.0.1:${port}`,
        stop: () => server.close(),
      });
    });
  });
}
