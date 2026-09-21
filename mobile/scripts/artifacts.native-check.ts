import { expect, test } from "bun:test";
import { artifactHtmlDocument, artifactPath } from "../src/omg/artifact-html";
import { loadSessionArtifacts, type SessionArtifact } from "../src/omg/session-artifacts";
import { Window } from "happy-dom";

test("auth fetch paths stay within the artifact byte route", () => {
  expect(artifactPath(undefined, "dashboard")).toBe("/api/artifacts/dashboard");
  expect(artifactPath("/api/artifacts/dashboard?v=2")).toBe("/api/artifacts/dashboard?v=2");
  for (const url of ["https://evil.test", "/api/sessions", "/api/artifacts/../sessions", "//evil.test", "/api/artifacts/a/file"]) expect(artifactPath(url)).toBeNull();
});

test("authored HTML is confined to one opaque sandbox with no network access", () => {
  const window = new Window({ settings: { enableJavaScriptEvaluation: false } });
  const html = '<h1>Dashboard</h1><script>window.counter=1</script><img src="https://evil.test/x"><p>" & </iframe>';
  window.document.write(artifactHtmlDocument(html, "dark"));
  const frames = window.document.querySelectorAll("iframe");
  expect(frames.length).toBe(1);
  const frame = frames[0];
  expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
  expect(window.document.querySelector("script")).toBeNull();
  const inner = new Window({ settings: { enableJavaScriptEvaluation: false } });
  inner.document.write(frame.getAttribute("srcdoc")!);
  expect(inner.document.querySelector("h1")?.textContent).toBe("Dashboard");
  expect(inner.document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute("content")).toContain("default-src 'none'");
  expect(inner.document.documentElement.getAttribute("data-theme")).toBe("dark");
  window.close(); inner.close();
});

test("session list scans past other sessions and deduplicates overlapping pages", async () => {
  const own = { id: "a", sessionId: "own", kind: "html" } as SessionArtifact;
  const paths: string[] = [];
  const pages = [{ artifacts: [{ id: "other", sessionId: "other" }], total: 4 }, { artifacts: [own, own, { ...own, id: "b", kind: "file" }], total: 4 }];
  const items = await loadSessionArtifacts(async <T>(path: string) => { paths.push(path); return pages.shift() as T; }, "own");
  expect(items.map(item => item.id)).toEqual(["a", "b"]);
  expect(paths).toEqual(["/api/artifacts?limit=500&offset=0", "/api/artifacts?limit=500&offset=1"]);
});

test("session list stops after navigation and propagates failures", async () => {
  let active = true;
  let calls = 0;
  await loadSessionArtifacts(async <T>() => { calls++; active = false; return { artifacts: [{ id: "x", sessionId: "elsewhere" }], total: 10 } as T; }, "own", () => active);
  expect(calls).toBe(1);
  await expect(loadSessionArtifacts(async () => { throw new Error("offline"); }, "own")).rejects.toThrow("offline");
});


test("legacy artifact indexes without a total do not loop", async () => {
  let calls = 0;
  const items = await loadSessionArtifacts(async <T>() => {
    calls++;
    if (calls > 1) throw new Error("repeated legacy page");
    return { artifacts: [{ id: "legacy", sessionId: "own", kind: "html" }] } as T;
  }, "own");
  expect(items.map(item => item.id)).toEqual(["legacy"]);
  expect(calls).toBe(1);
});
