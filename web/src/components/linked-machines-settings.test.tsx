import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { mount, type Mounted } from "../test-support/render";

const { LinkedMachinesGroup } = await import("./remote-access-settings");
const { MACHINE_STORAGE_KEY } = await import("../lib/machines");

let ui: Mounted;
const originalFetch = globalThis.fetch;

/** A stand-in for /api/peers with an inbound switch the UI can flip. */
function fakePeersServer() {
  const state = { inboundEnabled: false, inboundCalls: [] as boolean[] };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/peers/inbound")) {
      const body = JSON.parse(String(init?.body)) as { enabled: boolean };
      state.inboundCalls.push(body.enabled);
      state.inboundEnabled = body.enabled;
      return Response.json({ ok: true, inboundEnabled: body.enabled });
    }
    return Response.json({
      self: {
        id: "local",
        name: "MacBook Pro",
        localUrl: "http://127.0.0.1:8766",
        tailscaleUrl: "https://mbp.example.ts.net",
        inboundEnabled: state.inboundEnabled,
        pairingCode: state.inboundEnabled ? "https://mbp.example.ts.net#omg_peer_fresh" : null,
      },
      peers: [],
    });
  }) as typeof fetch;
  return { state, fetchImpl };
}

beforeEach(() => {
  window.localStorage.removeItem(MACHINE_STORAGE_KEY);
  ui = mount();
});

afterEach(() => {
  ui.cleanup();
  globalThis.fetch = originalFetch;
});

describe("LinkedMachinesGroup", () => {
  test("shows no pairing code until the owner allows linking", async () => {
    const server = fakePeersServer();
    globalThis.fetch = server.fetchImpl;

    ui.render(<LinkedMachinesGroup />);
    await ui.flushAsync();

    expect(ui.text()).toContain("Allow linking from other machines");
    expect(ui.query('[data-testid="peer-pairing-code"]')).toBeNull();
    expect(ui.text()).not.toContain("omg_peer_");
    // Outbound linking works with inbound access off.
    expect(ui.query('[data-testid="peer-link-form"]')).not.toBeNull();

    const toggle = ui.query('[aria-label="Allow linking from other machines"]') as HTMLElement;
    expect(toggle).not.toBeNull();
    await act(async () => {
      toggle.click();
    });
    await ui.flushAsync();

    expect(server.state.inboundCalls).toEqual([true]);
    expect(ui.query('[data-testid="peer-pairing-code"]')?.textContent).toContain(
      "https://mbp.example.ts.net#omg_peer_fresh",
    );
  });
});
