import { describe, expect, test } from "bun:test";
import { museChildEnv, museFetchInit, museProxyUrl } from "./muse-proxy.ts";

describe("muse egress proxy", () => {
  test("only an http(s) URL counts", () => {
    expect(museProxyUrl({})).toBeUndefined();
    expect(museProxyUrl({ OMG_MUSE_PROXY: "socks5://127.0.0.1:18080" })).toBeUndefined();
    expect(museProxyUrl({ OMG_MUSE_PROXY: " http://127.0.0.1:18081 " })).toBe("http://127.0.0.1:18081");
  });

  test("the child env carries the CLI proxy variables and keeps local traffic direct", () => {
    const env = museChildEnv({ PATH: "/bin", OMG_MUSE_PROXY: "http://127.0.0.1:18081", NO_PROXY: "example.internal" });
    expect(env.HTTPS_PROXY).toBe("http://127.0.0.1:18081");
    expect(env.HTTP_PROXY).toBe("http://127.0.0.1:18081");
    expect(env.NO_PROXY).toBe("127.0.0.1,localhost,example.internal");
    expect(env.PATH).toBe("/bin");
    const direct = { PATH: "/bin" };
    expect(museChildEnv(direct)).toBe(direct);
  });

  test("fetch init gains the proxy only when one is configured", () => {
    expect(museFetchInit({ method: "GET" }, {})).toEqual({ method: "GET" });
    expect(museFetchInit({ method: "GET" }, { OMG_MUSE_PROXY: "http://127.0.0.1:18081" }) as Record<string, unknown>).toEqual({
      method: "GET",
      proxy: "http://127.0.0.1:18081",
    });
  });
});
