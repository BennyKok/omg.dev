import { describe, expect, test } from "bun:test";
import { antigravityEnv, antigravityProxyUrl } from "./antigravity-env.ts";

describe("Antigravity proxy environment", () => {
  test("leaves the environment unchanged when no proxy is set", () => {
    const base = { PATH: "/bin" };
    expect(antigravityEnv(base)).toBe(base);
  });

  test("points agy at a loopback proxy and keeps the local server direct", () => {
    const env = antigravityEnv({ LFG_ANTIGRAVITY_PROXY: "http://127.0.0.1:18931", NO_PROXY: "corp.internal" });
    expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:18931");
    expect(env.https_proxy).toBe("http://127.0.0.1:18931");
    expect(env.NO_PROXY).toBe("corp.internal,127.0.0.1,localhost,::1");
    expect(env.no_proxy).toBe(env.NO_PROXY);
  });

  // agy's traffic carries its Google credentials, so it must never be sent to
  // a proxy on another machine.
  test("ignores a proxy that is not a plain loopback http URL", () => {
    expect(antigravityProxyUrl({ LFG_ANTIGRAVITY_PROXY: "http://10.0.0.5:3128" })).toBeNull();
    expect(antigravityProxyUrl({ LFG_ANTIGRAVITY_PROXY: "http://127.0.0.1.evil.example:1" })).toBeNull();
    expect(antigravityProxyUrl({ LFG_ANTIGRAVITY_PROXY: "http://user:pw@127.0.0.1:1" })).toBeNull();
    expect(antigravityProxyUrl({ LFG_ANTIGRAVITY_PROXY: "socks5://127.0.0.1:1" })).toBeNull();
    expect(antigravityProxyUrl({ LFG_ANTIGRAVITY_PROXY: "not a url" })).toBeNull();
    expect(antigravityProxyUrl({ LFG_ANTIGRAVITY_PROXY: "http://localhost:18931/" })).toBe("http://localhost:18931");
  });
});
