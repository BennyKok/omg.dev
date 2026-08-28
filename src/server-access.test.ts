import { describe, expect, test } from "bun:test";
import {
  handleServerAccessRequest,
  parseTailscaleStatus,
  serverAccessInfo,
  tailscaleServeTargetsPort,
  type TailscaleCommandRunner,
} from "./server-access.ts";

const STATUS = JSON.stringify({
  BackendState: "Running",
  Self: {
    DNSName: "computer.example.ts.net.",
    Online: true,
    TailscaleIPs: ["100.64.0.10", "fd7a:115c:a1e0::1"],
  },
});

describe("Tailscale server access", () => {
  test("normalizes the device name", () => {
    expect(parseTailscaleStatus(STATUS)).toEqual({
      connected: true,
      dnsName: "computer.example.ts.net",
    });
  });

  test("recognizes only a loopback proxy for this server port", () => {
    expect(
      tailscaleServeTargetsPort(
        JSON.stringify({ Web: { "computer.example.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:8766" } } } } }),
        8766,
      ),
    ).toBe(true);
    expect(
      tailscaleServeTargetsPort(
        JSON.stringify({ Web: { "computer.example.ts.net:443": { Handlers: { "/": { Proxy: "http://10.0.0.8:8766" } } } } }),
        8766,
      ),
    ).toBe(false);
  });

  test("returns the active private URL and the exact setup command", async () => {
    const run: TailscaleCommandRunner = async (argv) =>
      argv[0] === "status"
        ? { ok: true, text: STATUS }
        : {
            ok: true,
            text: JSON.stringify({
              Web: {
                "computer.example.ts.net:443": {
                  Handlers: { "/": { Proxy: "http://127.0.0.1:8766" } },
                },
              },
            }),
          };

    expect(
      await serverAccessInfo({ env: {}, localUrl: "http://127.0.0.1:8766", run }),
    ).toEqual({
      runtime: "self-hosted",
      localUrl: "http://127.0.0.1:8766",
      tailscale: {
        installed: true,
        connected: true,
        dnsName: "computer.example.ts.net",
        serveEnabled: true,
        serveUrl: "https://computer.example.ts.net",
        command: "tailscale serve --bg localhost:8766",
      },
    });
  });

  test("serves the access payload through the HTTP handler", async () => {
    const run: TailscaleCommandRunner = async () => ({ ok: false, text: "" });
    const response = await handleServerAccessRequest({
      env: {},
      localUrl: "http://127.0.0.1:8766",
      run,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      access: {
        runtime: "self-hosted",
        localUrl: "http://127.0.0.1:8766",
        tailscale: {
          installed: false,
          connected: false,
          dnsName: null,
          serveEnabled: false,
          serveUrl: null,
          command: "tailscale serve --bg localhost:8766",
        },
      },
    });
  });

  test("marks the desktop-owned runtime so Settings can keep it private", async () => {
    const run: TailscaleCommandRunner = async () => ({ ok: false, text: "" });
    const info = await serverAccessInfo({
      env: { OMG_DESKTOP_PARENT_PID: "123" },
      localUrl: "http://127.0.0.1:62280",
      run,
    });
    expect(info.runtime).toBe("desktop");
    expect(info.tailscale.command).toBe("tailscale serve --bg localhost:62280");
    expect(info.tailscale.serveUrl).toBeNull();
  });

  test("keeps a persistent desktop background runtime private", async () => {
    const run: TailscaleCommandRunner = async () => ({ ok: false, text: "" });
    const info = await serverAccessInfo({
      env: { OMG_DESKTOP_RUNTIME_ID: "desktop-123" },
      localUrl: "http://127.0.0.1:8766",
      run,
    });
    expect(info.runtime).toBe("desktop");
  });
});
