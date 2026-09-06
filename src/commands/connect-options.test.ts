import { expect, test } from "bun:test";
import { cmdConnect, parseRelayOption } from "./connect";
test("copied omg command carries its relay without an environment prefix", () => {
  expect(parseRelayOption(["ABC123", "--relay", "wss://relay.example/connect", "--url", "https://box.example"])).toEqual({
    args: ["ABC123", "--url", "https://box.example"], relayUrl: "wss://relay.example/connect",
  });
  expect(parseRelayOption(["status", "--json"])).toEqual({ args: ["status", "--json"] });
});

test("pairing opens the explicit relay instead of the legacy environment default", async () => {
  const originalSocket = globalThis.WebSocket;
  const originalRelay = process.env.LFG_RELAY_URL;
  const originalManaged = process.env.OMG_CONNECT_MANAGED;
  const originalPublicUrl = process.env.LFG_PUBLIC_URL;
  const opened: string[] = [];
  class FailedSocket extends EventTarget {
    constructor(url: string) {
      super();
      opened.push(url);
      queueMicrotask(() => this.dispatchEvent(new Event("error")));
    }
  }
  try {
    globalThis.WebSocket = FailedSocket as unknown as typeof WebSocket;
    process.env.LFG_RELAY_URL = "wss://legacy.example/connect";
    delete process.env.OMG_CONNECT_MANAGED;
    delete process.env.LFG_PUBLIC_URL;
    await expect(cmdConnect(["ABC123", "--relay", "wss://chosen.example/connect"])).rejects.toThrow("relay connection failed");
    expect(opened).toEqual(["wss://chosen.example/connect"]);
    await expect(cmdConnect(["ABC123"])).rejects.toThrow("relay connection failed");
    expect(opened[1]).toBe("wss://legacy.example/connect");
  } finally {
    globalThis.WebSocket = originalSocket;
    for (const [key, value] of Object.entries({ LFG_RELAY_URL: originalRelay, OMG_CONNECT_MANAGED: originalManaged, LFG_PUBLIC_URL: originalPublicUrl })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
test("relay option rejects missing, duplicate and unsafe values", () => {
  for (const args of [["--relay"], ["--relay", "--url"], ["--relay", "file:///tmp/x"], ["--relay", "https://relay.example"], ["--relay", "wss://user:pass@relay.example"], ["--relay", "wss://a", "--relay", "wss://b"]]) {
    expect(() => parseRelayOption(args)).toThrow("omg connect:");
  }
});
