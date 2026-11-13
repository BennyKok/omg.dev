import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createPeerMachineProxy,
  fetchPeersFleet,
  getLocalPeerToken,
  handlePeersRequest,
  parsePeerMachinePath,
  parsePeerPairingInput,
  readPeerStore,
  rewritePeerRedirectLocation,
} from "./peer-machines.ts";

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "omg-peers-test-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("parsePeerPairingInput", () => {
  test("parses URL with hash token and derives suggested name", () => {
    const parsed = parsePeerPairingInput({
      pairingCode: "https://mac-studio.tailnet.ts.net/#omg_peer_abc123",
    });
    expect(parsed).toEqual({
      url: "https://mac-studio.tailnet.ts.net",
      token: "omg_peer_abc123",
      suggestedName: "mac-studio",
    });
  });

  test("parses plain host:port and query token", () => {
    const parsed = parsePeerPairingInput({
      pairingCode: "192.168.1.44:8766?token=omg_peer_xyz",
      name: "Linux GPU",
    });
    expect(parsed).toEqual({
      url: "http://192.168.1.44:8766",
      token: "omg_peer_xyz",
      suggestedName: "Linux GPU",
    });
  });
});

describe("handlePeersRequest & fetchPeersFleet", () => {
  test("links a remote peer, discovers its machineName, aggregates fleet sessions, and turns inbound access on and rotates its token", async () => {
    let localName = "MacBook Pro";
    const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const auth = new Headers(init?.headers).get("authorization");
      if (url === "https://studio.example.ts.net/api/settings") {
        if (auth !== "Bearer omg_peer_secret") {
          return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
        }
        return Response.json({ settings: { machineName: "Mac Studio M4" } });
      }
      if (url === "https://studio.example.ts.net/api/sessions") {
        if (auth !== "Bearer omg_peer_secret") {
          return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
        }
        return Response.json({
          sessions: [
            {
              sessionId: "sess-remote-1",
              title: "Train embeddings on Studio",
              project: "ml-pipeline",
              busy: true,
              agent: "claude",
            },
          ],
        });
      }
      return new Response("not found", { status: 404 });
    };

    const deps = {
      dataDir,
      fetch: fakeFetch,
      localMachineName: () => localName,
      renameLocalMachine: async (next: string) => {
        localName = next;
      },
      localUrl: () => "http://127.0.0.1:8766",
      tailscaleUrl: async () => "https://mbp.example.ts.net",
    };

    // 1. Initial GET /api/peers
    const getRes = await handlePeersRequest(
      new Request("http://127.0.0.1:8766/api/peers"),
      new URL("http://127.0.0.1:8766/api/peers"),
      deps,
    );
    const initial = (await getRes!.json()) as {
      self: { id: string; name: string; pairingCode: string | null; inboundEnabled: boolean };
      peers: unknown[];
    };
    expect(initial.self.id).toBe("local");
    expect(initial.self.name).toBe("MacBook Pro");
    // Inbound access is off by default: no pairing code, and the gate gets no token.
    expect(initial.self.inboundEnabled).toBe(false);
    expect(initial.self.pairingCode).toBeNull();
    expect(getLocalPeerToken(dataDir)).toBeNull();
    expect(initial.peers).toEqual([]);

    // 1b. Rotation is refused while inbound access is off.
    const rotateOff = await handlePeersRequest(
      new Request("http://127.0.0.1:8766/api/peers/token", { method: "POST" }),
      new URL("http://127.0.0.1:8766/api/peers/token"),
      deps,
    );
    expect(rotateOff?.status).toBe(409);

    // 1c. Turning inbound access on issues a fresh token and a pairing code.
    const tokenBefore = readPeerStore(dataDir).peerToken;
    const enableRes = await handlePeersRequest(
      new Request("http://127.0.0.1:8766/api/peers/inbound", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true }),
      }),
      new URL("http://127.0.0.1:8766/api/peers/inbound"),
      deps,
    );
    expect(enableRes?.status).toBe(200);
    const enabledToken = getLocalPeerToken(dataDir);
    expect(enabledToken).toMatch(/^omg_peer_/);
    expect(enabledToken).not.toBe(tokenBefore);
    const afterEnable = (await (await handlePeersRequest(
      new Request("http://127.0.0.1:8766/api/peers"),
      new URL("http://127.0.0.1:8766/api/peers"),
      deps,
    ))!.json()) as { self: { pairingCode: string | null; inboundEnabled: boolean } };
    expect(afterEnable.self.inboundEnabled).toBe(true);
    expect(afterEnable.self.pairingCode).toBe(`https://mbp.example.ts.net#${enabledToken}`);

    // 1d. Rotation replaces the token.
    const rotateRes = await handlePeersRequest(
      new Request("http://127.0.0.1:8766/api/peers/token", { method: "POST" }),
      new URL("http://127.0.0.1:8766/api/peers/token"),
      deps,
    );
    expect(rotateRes?.status).toBe(200);
    expect(getLocalPeerToken(dataDir)).not.toBe(enabledToken);

    // 2. POST /api/peers with pairingCode
    const postRes = await handlePeersRequest(
      new Request("http://127.0.0.1:8766/api/peers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pairingCode: "https://studio.example.ts.net#omg_peer_secret",
        }),
      }),
      new URL("http://127.0.0.1:8766/api/peers"),
      deps,
    );
    expect(postRes?.status).toBe(200);
    const added = (await postRes!.json()) as {
      ok: boolean;
      peer: { id: string; name: string; url: string; hasToken: boolean };
    };
    expect(added.ok).toBe(true);
    expect(added.peer.name).toBe("Mac Studio M4");
    expect(added.peer.url).toBe("https://studio.example.ts.net");
    expect(added.peer.hasToken).toBe(true);

    // 3. GET /api/peers/fleet returns remote sessions tagged with peerId & peerName
    const fleet = await fetchPeersFleet({ dataDir, fetch: fakeFetch });
    expect(fleet.peers).toHaveLength(1);
    expect(fleet.peers[0]?.online).toBe(true);
    expect(fleet.peers[0]?.busyCount).toBe(1);
    expect(fleet.sessions).toEqual([
      {
        sessionId: "sess-remote-1",
        title: "Train embeddings on Studio",
        project: "ml-pipeline",
        busy: true,
        agent: "claude",
        peerId: added.peer.id,
        peerName: "Mac Studio M4",
      },
    ]);

    // 4. PATCH /api/peers renames the peer
    const patchRes = await handlePeersRequest(
      new Request("http://127.0.0.1:8766/api/peers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: added.peer.id, name: "Office Studio" }),
      }),
      new URL("http://127.0.0.1:8766/api/peers"),
      deps,
    );
    expect(patchRes?.status).toBe(200);
    expect(readPeerStore(dataDir).peers[0]?.name).toBe("Office Studio");

    // 5. DELETE /api/peers removes the peer
    const delRes = await handlePeersRequest(
      new Request(`http://127.0.0.1:8766/api/peers?id=${added.peer.id}`, {
        method: "DELETE",
      }),
      new URL(`http://127.0.0.1:8766/api/peers?id=${added.peer.id}`),
      deps,
    );
    expect(delRes?.status).toBe(200);
    expect(readPeerStore(dataDir).peers).toHaveLength(0);
  });
});

describe("createPeerMachineProxy", () => {
  test("forwards HTTP requests with Bearer token and rewrites redirects", async () => {
    const Calls: Array<{ url: string; auth: string | null; method: string }> = [];
    const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      Calls.push({
        url,
        auth: new Headers(init?.headers).get("authorization"),
        method: init?.method ?? "GET",
      });
      if (url.endsWith("/redirect")) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://studio.example.ts.net/api/sessions/s1/files/out.png" },
        });
      }
      return Response.json({ proxied: true });
    };

    await handlePeersRequest(
      new Request("http://127.0.0.1:8766/api/peers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pairingCode: "https://studio.example.ts.net#omg_peer_token_99",
          name: "Studio",
          allowOffline: true,
        }),
      }),
      new URL("http://127.0.0.1:8766/api/peers"),
      {
        dataDir,
        fetch: fakeFetch,
        localMachineName: () => "Local",
        localUrl: () => "http://127.0.0.1:8766",
      },
    );

    const peer = readPeerStore(dataDir).peers[0]!;
    const proxy = createPeerMachineProxy({ dataDir, fetch: fakeFetch });

    const reqUrl = new URL(`http://127.0.0.1:8766/api/peers/machines/${peer.id}/api/sessions?full=1`);
    expect(parsePeerMachinePath(reqUrl)).toEqual({
      peerId: peer.id,
      path: "/api/sessions?full=1",
    });

    const res = await proxy.handleHttp(new Request(reqUrl.toString()), reqUrl);
    expect(res.status).toBe(200);
    // A linked box's documents must not run as this origin.
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("content-security-policy")).not.toContain("allow-same-origin");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.json()).toEqual({ proxied: true });
    expect(Calls.at(-1)).toEqual({
      url: "https://studio.example.ts.net/api/sessions?full=1",
      auth: "Bearer omg_peer_token_99",
      method: "GET",
    });

    const redirectUrl = new URL(`http://127.0.0.1:8766/api/peers/machines/${peer.id}/redirect`);
    const redirectRes = await proxy.handleHttp(new Request(redirectUrl.toString()), redirectUrl);
    expect(redirectRes.status).toBe(302);
    expect(redirectRes.headers.get("location")).toBe(
      `/api/peers/machines/${peer.id}/api/sessions/s1/files/out.png`,
    );
    expect(
      rewritePeerRedirectLocation("/api/bootstrap", "https://studio.example.ts.net", peer.id),
    ).toBe(`/api/peers/machines/${peer.id}/api/bootstrap`);
  });
});
