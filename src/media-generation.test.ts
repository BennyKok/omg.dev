import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { faststart, handleMediaRequest, MEDIA_MESSAGES, type MediaOptions } from "./media-generation.ts";

// A fake host media router. Each test sets `router` to shape its responses.
type Call = { method: string; path: string; body: any };
let calls: Call[] = [];
let router: {
  quote?: (body: any) => Response;
  submit?: (body: any) => Response;
  job?: (id: string, n: number) => Response;
  models?: () => Response;
} = {};
let jobPolls = 0;
let server: ReturnType<typeof Bun.serve>;
let base = "";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

beforeAll(() => {
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = req.method === "POST" ? await req.json().catch(() => null) : null;
      const path = url.pathname.replace(/^\/media/, "");
      calls.push({ method: req.method, path, body });
      if (path === "/quote" && router.quote) return router.quote(body);
      if (path === "/submit" && router.submit) return router.submit(body);
      if (path === "/models" && router.models) return router.models();
      const job = path.match(/^\/jobs\/(.+)$/);
      if (job && router.job) return router.job(decodeURIComponent(job[1]), ++jobPolls);
      if (path === "/files/out.png") return new Response(PNG, { headers: { "Content-Type": "image/png" } });
      return new Response("not found", { status: 404 });
    },
  });
  base = `http://127.0.0.1:${server.port}/media`;
});
afterAll(() => server.stop(true));

let dir = "";
let opts: MediaOptions;
beforeEach(() => {
  const root = join(homedir(), ".cache", "lfg", "tmp");
  mkdirSync(root, { recursive: true });
  dir = mkdtempSync(join(root, "media-test-"));
  calls = [];
  jobPolls = 0;
  router = {
    quote: (b) => Response.json({ model: b.model, kind: "image", costMicros: 8_000 }),
    submit: () => Response.json({ jobId: "job-1", status: "queued", costMicros: 8_000 }, { status: 202 }),
    job: (id, n) =>
      Response.json(
        n < 2
          ? { jobId: id, status: "running", model: "m", results: [] }
          : { jobId: id, status: "succeeded", model: "m", results: [{ url: `${base}/files/out.png`, contentType: "image/png" }] },
      ),
  };
  opts = {
    mediaUrl: base,
    spendPath: join(dir, "media-spend.json"),
    outputRoot: join(dir, "out"),
    pollMs: 5,
    now: () => new Date("2026-09-28T12:00:00Z"),
  };
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function call(method: string, path: string, body?: unknown, o: MediaOptions = opts) {
  const url = new URL(`http://127.0.0.1${path}`);
  const req = new Request(url.toString(), {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await handleMediaRequest(req, url, o);
  if (!res) throw new Error("route not handled");
  return { status: res.status, data: (await res.json()) as any };
}

describe("media generation routes", () => {
  test("quote, submit, wait, and download an image", async () => {
    const { status, data } = await call("POST", "/api/media/generate", {
      kind: "image",
      input: { prompt: "a red fox", aspect_ratio: "1:1" },
    });
    expect(status).toBe(200);
    expect(data.status).toBe("succeeded");
    expect(data.jobId).toBe("job-1");
    expect(data.model).toBe("m");
    expect(data.costMicros).toBe(8_000);
    expect(data.costUsd).toBe(0.008);
    expect(data.spentTodayUsd).toBe(0.008);
    expect(data.dailyCapUsd).toBe(5);
    expect(data.urls).toEqual([`${base}/files/out.png`]);
    expect(data.paths).toEqual([join(dir, "out", "2026-09-28", "job-1-1.png")]);
    expect(new Uint8Array(readFileSync(data.paths[0]))).toEqual(PNG);

    const quote = calls.find((c) => c.path === "/quote")!;
    expect(quote.body).toEqual({ model: "recraft-ai/recraft-v4.1-flash/text-to-image", input: { prompt: "a red fox", aspect_ratio: "1:1" } });
    const submit = calls.find((c) => c.path === "/submit")!;
    // Tightest of the per-call cap ($1) and what is left today ($5).
    expect(submit.body.maxCostMicros).toBe(1_000_000);
    expect(JSON.parse(readFileSync(opts.spendPath, "utf8"))).toEqual({ day: "2026-09-28", spentMicros: 8_000 });
  });

  test("writes to the caller outputPath", async () => {
    const target = join(dir, "custom", "fox.png");
    const { data } = await call("POST", "/api/media/generate", { input: { prompt: "fox" }, outputPath: target });
    expect(data.paths).toEqual([target]);
    expect(existsSync(target)).toBe(true);
  });

  test("refuses a job above the per-call cap without submitting", async () => {
    router.quote = () => Response.json({ model: "x", kind: "video", costMicros: 1_120_000 });
    const { status, data } = await call("POST", "/api/media/generate", { kind: "video", model: "x", input: { prompt: "p" } });
    expect(status).toBe(400);
    expect(data.status).toBe("per_call_cap");
    expect(data.error).toContain("$1.120");
    expect(data.error).toContain("per-call cap of $1.00");
    expect(calls.some((c) => c.path === "/submit")).toBe(false);
  });

  test("refuses a job above what is left of the daily cap and says how much is left", async () => {
    writeFileSync(opts.spendPath, JSON.stringify({ day: "2026-09-28", spentMicros: 4_900_000 }));
    router.quote = () => Response.json({ model: "x", kind: "video", costMicros: 200_000 });
    const { status, data } = await call("POST", "/api/media/generate", { kind: "video", input: { prompt: "p" } });
    expect(status).toBe(400);
    expect(data.status).toBe("daily_cap");
    expect(data.leftTodayUsd).toBe(0.1);
    expect(data.error).toContain("only $0.100 of the $5.00 daily media cap is left");
    expect(calls.some((c) => c.path === "/submit")).toBe(false);
  });

  test("a previous UTC day's spend does not count", async () => {
    writeFileSync(opts.spendPath, JSON.stringify({ day: "2026-09-27", spentMicros: 5_000_000 }));
    const { status, data } = await call("POST", "/api/media/generate", { input: { prompt: "p" } });
    expect(status).toBe(200);
    expect(data.spentTodayUsd).toBe(0.008);
  });

  test("maps 402 to the out-of-credits message and records no spend", async () => {
    router.submit = () => Response.json({ error: "insufficient credits", status: "upgrade_required" }, { status: 402 });
    const { status, data } = await call("POST", "/api/media/generate", { input: { prompt: "p" } });
    expect(status).toBe(402);
    expect(data.status).toBe("upgrade_required");
    expect(data.error).toBe(MEDIA_MESSAGES.outOfCredits);
    expect(existsSync(opts.spendPath)).toBe(false);
  });

  test("passes provider input errors through", async () => {
    router.submit = () => Response.json({ error: "duration must be 4-12", status: "invalid_input" }, { status: 400 });
    const { status, data } = await call("POST", "/api/media/generate", { input: { prompt: "p" } });
    expect(status).toBe(400);
    expect(data.status).toBe("invalid_input");
    expect(data.error).toContain("duration must be 4-12");
  });

  test("fails clearly when the router cannot quote", async () => {
    router.quote = () => new Response("not found", { status: 404 });
    const { status, data } = await call("POST", "/api/media/generate", { input: { prompt: "p" } });
    expect(status).toBe(501);
    expect(data.status).toBe("quote_unavailable");
    expect(data.error).toContain("pricing preview is not available on this Computer yet");
    expect(calls.some((c) => c.path === "/submit")).toBe(false);
  });

  test("returns the unknown-model error with no fallback", async () => {
    router.quote = () => new Response("unknown model: nope", { status: 400 });
    const { status, data } = await call("POST", "/api/media/generate", { model: "nope", input: { prompt: "p" } });
    expect(status).toBe(400);
    expect(data.status).toBe("unknown_model");
    expect(data.error).toContain("unknown model: nope");
    expect(calls.filter((c) => c.path === "/quote")).toHaveLength(1);
  });

  test("says a Computer is needed when OMG_MEDIA_URL is unset", async () => {
    const { status, data } = await call("POST", "/api/media/generate", { input: { prompt: "p" } }, { ...opts, mediaUrl: null });
    expect(status).toBe(400);
    expect(data.status).toBe("not_on_computer");
    expect(data.error).toContain("Media generation needs an omg.dev Computer");
    expect(calls).toHaveLength(0);
  });

  test("a wait timeout returns the jobId and charges once; omg_media_job finishes it", async () => {
    router.job = (id, n) =>
      Response.json(
        n < 50
          ? { jobId: id, status: "running", model: "m" }
          : { jobId: id, status: "succeeded", model: "m", results: [{ url: `${base}/files/out.png`, contentType: "image/png" }] },
      );
    const first = await call("POST", "/api/media/generate", { input: { prompt: "p" }, waitSeconds: 0.02 });
    expect(first.status).toBe(200);
    expect(first.data.pending).toBe(true);
    expect(first.data.jobId).toBe("job-1");
    expect(first.data.status).toBe("running");
    expect(first.data.paths).toEqual([]);
    expect(first.data.next).toContain("omg_media_job");

    jobPolls = 49;
    const second = await call("GET", "/api/media/jobs/job-1");
    expect(second.data.status).toBe("succeeded");
    expect(second.data.paths).toHaveLength(1);
    expect(existsSync(second.data.paths[0])).toBe(true);
    expect(calls.filter((c) => c.path === "/submit")).toHaveLength(1);
    expect(JSON.parse(readFileSync(opts.spendPath, "utf8")).spentMicros).toBe(8_000);
  });

  test("wait:false returns right after submit", async () => {
    const { data } = await call("POST", "/api/media/generate", { input: { prompt: "p" }, wait: false });
    expect(data.pending).toBe(true);
    expect(data.status).toBe("queued");
    expect(calls.some((c) => c.path.startsWith("/jobs/"))).toBe(false);
  });

  test("a failed job reports the provider error", async () => {
    router.job = (id) => Response.json({ jobId: id, status: "failed", model: "m", error: "nsfw" });
    const { data } = await call("POST", "/api/media/generate", { input: { prompt: "p" } });
    expect(data.status).toBe("failed");
    expect(data.error).toBe("nsfw");
    expect(data.paths).toEqual([]);
  });

  test("lists models with USD prices, caps, and the guide path", async () => {
    router.models = () =>
      Response.json({ models: [{ id: "recraft-ai/recraft-v4.1-flash/text-to-image", kind: "image", defaultCostMicros: 8_000 }] });
    const { status, data } = await call("GET", "/api/media/models");
    expect(status).toBe(200);
    expect(data.models[0].defaultCostUsd).toBe(0.008);
    expect(data.maxCallUsd).toBe(1);
    expect(data.dailyCapUsd).toBe(5);
    expect(existsSync(data.guidePath)).toBe(true);
  });

  test("reads caps from the environment", async () => {
    const prev = process.env.OMG_MEDIA_MAX_CALL_USD;
    process.env.OMG_MEDIA_MAX_CALL_USD = "0.005";
    try {
      const { data } = await call("POST", "/api/media/generate", { input: { prompt: "p" } });
      expect(data.status).toBe("per_call_cap");
    } finally {
      if (prev === undefined) delete process.env.OMG_MEDIA_MAX_CALL_USD;
      else process.env.OMG_MEDIA_MAX_CALL_USD = prev;
    }
  });
});

describe("faststart", () => {
  const hasFfmpeg = Bun.spawnSync(["which", "ffmpeg"]).exitCode === 0;
  test.skipIf(!hasFfmpeg)("moves the moov atom before mdat so AVPlayer can stream it", async () => {
    const dir = mkdtempSync(join(homedir(), ".cache", "media-faststart-"));
    try {
      const clip = join(dir, "clip.mp4");
      const made = Bun.spawnSync([
        "ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=red:s=64x64:d=1",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", clip,
      ]);
      expect(made.exitCode).toBe(0);
      const before = readFileSync(clip);
      expect(before.indexOf("moov")).toBeGreaterThan(before.indexOf("mdat"));
      await faststart(clip);
      const after = readFileSync(clip);
      expect(after.indexOf("moov")).toBeLessThan(after.indexOf("mdat"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
