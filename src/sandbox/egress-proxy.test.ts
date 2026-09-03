import { afterEach, describe, expect, test } from "bun:test";
import http from "node:http";
import net from "node:net";
import {
  DEFAULT_ALLOW_HOSTS,
  credentialsFromProxyAuth,
  hostAllowed,
  parseHostPort,
  startEgressProxy,
  type EgressProxy,
} from "./egress-proxy.ts";

describe("hostAllowed", () => {
  test("exact and suffix matching", () => {
    expect(hostAllowed("api.anthropic.com", [".anthropic.com"])).toBe(true);
    expect(hostAllowed("anthropic.com", [".anthropic.com"])).toBe(true);
    expect(hostAllowed("evil-anthropic.com", [".anthropic.com"])).toBe(false);
    expect(hostAllowed("api.openai.com", ["api.openai.com"])).toBe(true);
    expect(hostAllowed("api.openai.com.evil.com", ["api.openai.com"])).toBe(false);
    expect(hostAllowed("API.Anthropic.Com.", [".anthropic.com"])).toBe(true);
    expect(hostAllowed("example.com", [])).toBe(false);
  });

  test("the built-in model hosts cover the providers", () => {
    expect(hostAllowed("api.anthropic.com", DEFAULT_ALLOW_HOSTS)).toBe(true);
    expect(hostAllowed("generativelanguage.googleapis.com", DEFAULT_ALLOW_HOSTS)).toBe(true);
    expect(hostAllowed("pastebin.com", DEFAULT_ALLOW_HOSTS)).toBe(false);
  });
});

describe("parseHostPort", () => {
  test("host, host:port, and ipv6", () => {
    expect(parseHostPort("api.anthropic.com:443", 443)).toEqual({ host: "api.anthropic.com", port: 443 });
    expect(parseHostPort("api.anthropic.com", 443)).toEqual({ host: "api.anthropic.com", port: 443 });
    expect(parseHostPort("[::1]:8080", 443)).toEqual({ host: "::1", port: 8080 });
  });
});

describe("credentialsFromProxyAuth", () => {
  test("decodes Basic sessionId:token", () => {
    const header = `Basic ${Buffer.from("sess-1:tok-abc").toString("base64")}`;
    expect(credentialsFromProxyAuth(header)).toEqual({ sessionId: "sess-1", token: "tok-abc" });
    expect(credentialsFromProxyAuth(undefined)).toBeNull();
    expect(credentialsFromProxyAuth("Bearer x")).toBeNull();
  });
});

// A live proxy on loopback with a stub upstream. Proves the CONNECT tunnel is
// gated: an allowed host reaches the upstream, a denied host is 403, and a bad
// token is 407.
describe("egress proxy (live)", () => {
  let proxy: EgressProxy | null = null;
  let upstream: net.Server | null = null;

  afterEach(() => {
    proxy?.stop();
    upstream?.close();
    proxy = null;
    upstream = null;
  });

  function connectThrough(proxyPort: number, auth: string, target: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const sock = net.connect(proxyPort, "127.0.0.1", () => {
        sock.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\nProxy-Authorization: ${auth}\r\n\r\n`);
      });
      let buf = "";
      sock.on("data", (d) => {
        buf += d.toString();
        if (buf.includes("\r\n\r\n")) {
          resolve(buf.split("\r\n")[0]!);
          sock.end();
        }
      });
      sock.on("error", reject);
      setTimeout(() => reject(new Error("timeout")), 3000);
    });
  }

  test("allows an allowlisted host, denies others, refuses a bad token", async () => {
    // A trivial TCP upstream that accepts connections; the tunnel only needs it
    // to exist for the CONNECT to succeed.
    upstream = net.createServer((s) => s.end());
    await new Promise<void>((r) => upstream!.listen(0, "127.0.0.1", () => r()));
    const upstreamPort = (upstream.address() as net.AddressInfo).port;

    proxy = await startEgressProxy({
      resolve: (sessionId, token) =>
        token === "good" ? { sessionId, allow: ["127.0.0.1"] } : null,
    });
    const good = `Basic ${Buffer.from("s1:good").toString("base64")}`;
    const bad = `Basic ${Buffer.from("s1:bad").toString("base64")}`;

    const allowed = await connectThrough(proxy.port, good, `127.0.0.1:${upstreamPort}`);
    expect(allowed).toContain("200");

    const denied = await connectThrough(proxy.port, good, `example.com:443`);
    expect(denied).toContain("403");

    const unauth = await connectThrough(proxy.port, bad, `127.0.0.1:${upstreamPort}`);
    expect(unauth).toContain("407");
  });

  test("proxyUrlFor embeds the session credentials", async () => {
    proxy = await startEgressProxy({ resolve: () => null });
    const url = proxy.proxyUrlFor("s 1", "t/k");
    expect(url).toContain("@127.0.0.1:");
    expect(url).toContain("s%201");
    expect(url).toContain("t%2Fk");
  });
});
