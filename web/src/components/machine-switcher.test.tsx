import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";

const { MachineSwitcher } = await import("./machine-switcher");
const { LOCAL_MACHINE_ID, MACHINE_STORAGE_KEY } = await import("../lib/machines");

let ui: Mounted;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  window.localStorage.removeItem(MACHINE_STORAGE_KEY);
  ui = mount();
});

afterEach(() => {
  ui.cleanup();
  globalThis.fetch = originalFetch;
  window.localStorage.removeItem(MACHINE_STORAGE_KEY);
});

describe("MachineSwitcher", () => {
  test("hides rail variant when no remote peers are linked, but renders nav variant", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        self: {
          id: "local",
          name: "MacBook Pro",
          localUrl: "http://127.0.0.1:8766",
          tailscaleUrl: null,
          inboundEnabled: true,
          pairingCode: "http://127.0.0.1:8766#omg_peer_test1234567890",
        },
        peers: [],
      })) as typeof fetch;

    ui.render(<MachineSwitcher variant="rail" />);
    await ui.flushAsync();
    expect(ui.query('[data-machine-switcher="rail"]')).toBeNull();

    ui.render(<MachineSwitcher variant="nav" />);
    await ui.flushAsync();
    const button = ui.query('[data-machine-switcher="nav"]');
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain("MacBook Pro");
  });

  test("renders rail switcher with Unified indicator when remote peers are linked", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/peers/fleet")) {
        return Response.json({
          peers: [
            {
              id: "peer-1",
              name: "Mac Studio",
              url: "https://studio.ts.net",
              online: true,
              sessionCount: 2,
              busyCount: 1,
              sessions: [],
            },
          ],
          sessions: [],
        });
      }
      return Response.json({
        self: {
          id: LOCAL_MACHINE_ID,
          name: "MacBook Pro",
          localUrl: "http://127.0.0.1:8766",
          tailscaleUrl: null,
          inboundEnabled: true,
          pairingCode: "http://127.0.0.1:8766#omg_peer_test1234567890",
        },
        peers: [
          {
            id: "peer-1",
            name: "Mac Studio",
            url: "https://studio.ts.net",
            addedAt: 1,
            hasToken: true,
          },
        ],
      });
    }) as typeof fetch;

    ui.render(<MachineSwitcher variant="rail" />);
    await ui.flushAsync();
    const button = ui.query('[data-machine-switcher="rail"]');
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain("MacBook Pro · Unified");
  });
});
