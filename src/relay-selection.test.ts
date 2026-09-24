import { test, expect } from "bun:test";
import { selectRelay, readRelayCandidates } from "./relay-selection";
const candidates = [{ id: "de", connectUrl: "wss://de.example/relay/" }, { id: "ca", connectUrl: "wss://ca.example/" }];
test("chooses a healthy nearby relay without sending credentials", async () => {
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    if (String(url).endsWith("regions")) return Response.json({ regions: candidates });
    await Bun.sleep(String(url).includes("de.example") ? 45 : 1);
    return new Response("ok");
  };
  const chosen = await selectRelay(candidates[0]!.connectUrl, [], { fetch: fetcher as typeof fetch });
  expect(chosen.url).toBe(candidates[1]!.connectUrl);
});
test("uses cached candidates when discovery is offline and excludes failed region", async () => {
  const selected = await selectRelay(candidates[0]!.connectUrl, candidates, {
    avoid: candidates[0]!.connectUrl,
    fetch: (async (url: string) => { if (url.endsWith("regions")) throw Error("offline"); return new Response("ok"); }) as typeof fetch,
  });
  expect(selected.url).toBe(candidates[1]!.connectUrl);
});
test("rejects discovery endpoints that could expose credentials", () => {
  expect(readRelayCandidates([{ id: "bad", connectUrl: "ws://bad.example" }, { id: "bad", connectUrl: "wss://a:b@bad.example" }])).toEqual([]);
});

test("updating relay discovery does not restart the managed Bridge", async () => {
  const { relayCredentialRevision } = await import("./connect-manager");
  const base = { token: "token-a", boxId: "box", relayUrl: "wss://de.example/relay/" };
  expect(relayCredentialRevision(JSON.stringify({ ...base, relayCandidates: candidates }))).toBe(relayCredentialRevision(JSON.stringify(base)));
  expect(relayCredentialRevision(JSON.stringify({ ...base, token: "token-b" }))).not.toBe(relayCredentialRevision(JSON.stringify(base)));
});
