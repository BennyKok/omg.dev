// Agent-facing image and video generation, billed to the user's omg credits.
//
// On a managed omg Computer, OMG_MEDIA_URL points at the per-sandbox host
// media router (http://169.254.0.1:9090/media). Reaching it is the auth: there
// is no key, and the Computer's owner pays. The MCP tools in
// src/commands/mcp.ts call the /api/media/* routes below, so every network
// call and every spend guardrail lives in `omg serve`, never in an MCP child
// that may not inherit the env.
//
// A self-hosted box has no sandbox router. When it is signed in with
// `omg login`, the same router is reached through the control-plane CLI gate
// (/api/cli/media/*), which bills the signed-in account. OMG_MEDIA_URL wins
// when both exist.
//
// Flow for one generate: quote -> enforce per-call and per-day caps -> submit
// with maxCostMicros -> record spend -> optionally poll the job -> download
// each result to a local file.
//
// Router contract (vibes host media router):
//   POST /quote  {model, input, kind}            -> {model, kind, provider, costMicros}
//   GET  /models?all=1&q=&kind=&task=&provider=&limit=
//                                                -> {models:[{id, kind, task, provider, curated, defaultCostMicros}]}
//   POST /submit {model, provider, input, maxCostMicros} -> 202 {jobId, status, costMicros}
// model is a curated id, any fal or WaveSpeed id (priced live), or "auto".
//   GET  /jobs/:id                               -> {jobId, status, model, results:[{url, contentType}], error}
// 1 credit = 1_000_000 micros = $1.
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";

export const MICROS_PER_USD = 1_000_000;
/** Agent skill with the curated model list and prices. */
export const MEDIA_SKILL_PATH = join(import.meta.dir, "..", "agents", "skills", "media-generation", "SKILL.md");
/**
 * "auto" asks the router for the cheapest curated model for the task, priced
 * with the request's own params. The quote names the model it chose.
 */
export const AUTO_MODEL = "auto";
export const DEFAULT_IMAGE_MODEL = AUTO_MODEL;
export const DEFAULT_VIDEO_MODEL = AUTO_MODEL;
export const DEFAULT_MAX_CALL_USD = 1;
export const DEFAULT_MAX_DAY_USD = 5;
const IMAGE_WAIT_MS = 120_000;
const VIDEO_WAIT_MS = 300_000;
const DEFAULT_POLL_MS = 2_500;

export const MEDIA_MESSAGES = {
  notOnComputer:
    "Media generation needs an omg.dev Computer or an omg.dev sign-in. OMG_MEDIA_URL is not set on this machine and it is not signed in, so there is no media router to bill the omg credits. Sign in with `omg login` or in Settings.",
  quoteUnavailable: "Media pricing preview is not available on this Computer yet. Generation is refused until the Computer can quote a price.",
  outOfCredits: "The omg credits on this account are used up. Add credits at omg.dev to keep generating.",
  grantDenied: "This Computer is not allowed to generate media (runtime grant denied: media.invoke).",
};

export type MediaKind = "image" | "video";
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type MediaOptions = {
  /** Router base URL. Defaults to env OMG_MEDIA_URL. */
  mediaUrl?: string | null;
  /**
   * The box's omg.dev account. Used only when there is no router URL: calls
   * go to /api/cli/media/* on the control plane with the account Bearer.
   */
  cloud?: {
    signedIn: () => boolean;
    fetch: (path: string, init?: RequestInit) => Promise<Response>;
  };
  fetch?: FetchLike;
  /** JSON file that records spend for the current UTC day. */
  spendPath: string;
  /** Root for downloaded results. Defaults to ~/omg-media. */
  outputRoot?: string;
  maxCallUsd?: number;
  maxDayUsd?: number;
  pollMs?: number;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

export class MediaError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly status: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export type GenerateRequest = {
  kind?: MediaKind;
  model?: string;
  /** "fal" or "wavespeed" for a non-curated id the router cannot infer. */
  provider?: string;
  input?: Record<string, unknown>;
  outputPath?: string;
  wait?: boolean;
  waitSeconds?: number;
};

type JobResult = { url: string; contentType?: string };
type RouterJob = {
  jobId: string;
  status: string;
  model?: string;
  results?: JobResult[];
  error?: string | null;
};

// ---------------------------------------------------------------- config

function envUsd(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function settings(opts: MediaOptions) {
  const base = (opts.mediaUrl === undefined ? process.env.OMG_MEDIA_URL : opts.mediaUrl)?.trim();
  const cloud = !base && opts.cloud?.signedIn() ? opts.cloud : null;
  return {
    base: base ? base.replace(/\/+$/, "") : cloud ? CLOUD_MEDIA_PATH : null,
    cloud,
    fetch: opts.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init)),
    maxCallMicros: Math.round((opts.maxCallUsd ?? envUsd("OMG_MEDIA_MAX_CALL_USD", DEFAULT_MAX_CALL_USD)) * MICROS_PER_USD),
    maxDayMicros: Math.round((opts.maxDayUsd ?? envUsd("OMG_MEDIA_MAX_DAY_USD", DEFAULT_MAX_DAY_USD)) * MICROS_PER_USD),
    outputRoot: opts.outputRoot ?? join(homedir(), "omg-media"),
    pollMs: opts.pollMs ?? DEFAULT_POLL_MS,
    now: opts.now ?? (() => new Date()),
    sleep: opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
  };
}

/** Control-plane CLI route that fronts the media router for a signed-in box. */
export const CLOUD_MEDIA_PATH = "/api/cli/media";

function requireBase(base: string | null): string {
  if (!base) throw new MediaError(MEDIA_MESSAGES.notOnComputer, 400, "not_on_computer");
  return base;
}

export const usd = (micros: number) => Math.round(micros) / MICROS_PER_USD;

// ---------------------------------------------------------------- daily spend

type SpendRecord = { day: string; spentMicros: number };
const utcDay = (d: Date) => d.toISOString().slice(0, 10);

async function readSpend(path: string, day: string): Promise<SpendRecord> {
  try {
    const data = JSON.parse(await readFile(path, "utf8")) as Partial<SpendRecord>;
    if (data.day === day && typeof data.spentMicros === "number" && data.spentMicros >= 0) {
      return { day, spentMicros: data.spentMicros };
    }
  } catch {}
  return { day, spentMicros: 0 };
}

async function writeSpend(path: string, record: SpendRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(record));
  await rename(tmp, path);
}

// Quote, cap check, submit, and the spend write run under one lock. Without it
// two concurrent generates both read the same spend and both pass the daily cap.
let spendLock: Promise<unknown> = Promise.resolve();
function withSpendLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = spendLock.then(fn, fn);
  spendLock = next.catch(() => {});
  return next;
}

// ---------------------------------------------------------------- router calls

async function readBody(res: Response): Promise<{ json: Record<string, unknown> | null; text: string }> {
  const text = await res.text().catch(() => "");
  try {
    const json = JSON.parse(text);
    return { json: json && typeof json === "object" ? json : null, text };
  } catch {
    return { json: null, text };
  }
}

function routerMessage(body: { json: Record<string, unknown> | null; text: string }, res: Response): string {
  const msg = typeof body.json?.error === "string" ? body.json.error : body.text.trim();
  return msg || `media router returned ${res.status}`;
}

async function routerCall(
  s: ReturnType<typeof settings>,
  path: string,
  init?: RequestInit,
): Promise<{ res: Response; body: { json: Record<string, unknown> | null; text: string } }> {
  const base = requireBase(s.base);
  let res: Response;
  try {
    // Only router calls carry the account Bearer. Result downloads use s.fetch.
    res = s.cloud ? await s.cloud.fetch(`${base}${path}`, init) : await s.fetch(`${base}${path}`, init);
  } catch (e) {
    throw new MediaError(`Could not reach the omg media router at ${base}: ${(e as Error)?.message || e}`, 502, "router_unreachable");
  }
  return { res, body: await readBody(res) };
}

function mapSubmitError(res: Response, body: { json: Record<string, unknown> | null; text: string }): MediaError {
  const status = typeof body.json?.status === "string" ? body.json.status : "";
  const msg = routerMessage(body, res);
  if (res.status === 402 || status === "upgrade_required") {
    return new MediaError(MEDIA_MESSAGES.outOfCredits, 402, "upgrade_required");
  }
  if (res.status === 403) return new MediaError(`${MEDIA_MESSAGES.grantDenied} Router said: ${msg}`, 403, "grant_denied");
  if (status === "cost_cap_exceeded") {
    const cost = Number(body.json?.costMicros ?? 0);
    const cap = Number(body.json?.maxCostMicros ?? 0);
    return new MediaError(
      `The router priced this job at $${usd(cost).toFixed(3)}, above the $${usd(cap).toFixed(3)} cap sent with it. Nothing was charged.`,
      400,
      "cost_cap_exceeded",
      { costMicros: cost, maxCostMicros: cap },
    );
  }
  if (status === "invalid_input") return new MediaError(`The provider rejected the input: ${msg}`, 400, "invalid_input");
  return new MediaError(msg, res.status >= 400 && res.status < 600 ? res.status : 502, status || "router_error");
}

export type ModelQuery = { all?: boolean; q?: string; kind?: string; task?: string; provider?: string; limit?: number };

export async function listModels(opts: MediaOptions, query: ModelQuery = {}) {
  const s = settings(opts);
  const params = new URLSearchParams();
  if (query.all) params.set("all", "1");
  for (const key of ["q", "kind", "task", "provider"] as const) {
    const v = query[key]?.trim();
    if (v) params.set(key, v);
  }
  if (query.limit && query.limit > 0) params.set("limit", String(Math.floor(query.limit)));
  const qs = params.toString();
  const { res, body } = await routerCall(s, `/models${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new MediaError(routerMessage(body, res), res.status, "router_error");
  const models = Array.isArray(body.json?.models) ? (body.json!.models as Array<Record<string, unknown>>) : [];
  const spend = await readSpend(opts.spendPath, utcDay(s.now()));
  return {
    models: models.map((m) => ({
      id: String(m.id ?? ""),
      kind: m.kind,
      ...(typeof m.task === "string" ? { task: m.task } : {}),
      ...(typeof m.provider === "string" ? { provider: m.provider } : {}),
      ...(typeof m.name === "string" && m.name ? { name: m.name } : {}),
      ...(typeof m.curated === "boolean" ? { curated: m.curated } : {}),
      defaultCostMicros: Number(m.defaultCostMicros ?? 0),
      defaultCostUsd: usd(Number(m.defaultCostMicros ?? 0)),
    })),
    ...(Array.isArray(body.json?.warnings) ? { warnings: body.json!.warnings } : {}),
    defaults: { image: DEFAULT_IMAGE_MODEL, video: DEFAULT_VIDEO_MODEL },
    guidePath: MEDIA_SKILL_PATH,
    maxCallUsd: usd(s.maxCallMicros),
    dailyCapUsd: usd(s.maxDayMicros),
    spentTodayUsd: usd(spend.spentMicros),
  };
}

// ---------------------------------------------------------------- downloads

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
};

function extensionFor(result: JobResult): string {
  const type = result.contentType?.split(";")[0]?.trim().toLowerCase();
  if (type && EXT_BY_TYPE[type]) return EXT_BY_TYPE[type];
  try {
    const ext = extname(new URL(result.url).pathname).toLowerCase();
    if (/^\.[a-z0-9]{2,5}$/.test(ext)) return ext;
  } catch {}
  return ".bin";
}

function safeJobId(jobId: string): string {
  return jobId.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80) || "job";
}

async function downloadResults(
  s: ReturnType<typeof settings>,
  job: RouterJob,
  outputPath: string | undefined,
): Promise<string[]> {
  const results = job.results ?? [];
  const paths: string[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const ext = extensionFor(r);
    let target: string;
    if (outputPath) {
      const abs = resolve(outputPath);
      if (results.length === 1) target = abs;
      else {
        const e = extname(abs);
        target = `${e ? abs.slice(0, -e.length) : abs}-${i + 1}${e || ext}`;
      }
    } else {
      target = join(s.outputRoot, utcDay(s.now()), `${safeJobId(job.jobId)}-${i + 1}${ext}`);
    }
    let res: Response;
    try {
      res = await s.fetch(r.url);
    } catch (e) {
      throw new MediaError(`Could not download result ${i + 1} of job ${job.jobId}: ${(e as Error)?.message || e}`, 502, "download_failed", { jobId: job.jobId });
    }
    if (!res.ok) {
      throw new MediaError(`Could not download result ${i + 1} of job ${job.jobId}: HTTP ${res.status}`, 502, "download_failed", { jobId: job.jobId });
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, new Uint8Array(await res.arrayBuffer()));
    if (/\.(mp4|m4v|mov)$/i.test(target)) await faststart(target);
    paths.push(target);
  }
  return paths;
}

/**
 * Provider MP4s put the moov atom at the end. The iOS app streams videos in
 * ranges with AVPlayer, which needs moov first. Remux in place (no re-encode).
 * Best effort: without ffmpeg, or on failure, the original file stays.
 */
export async function faststart(path: string): Promise<void> {
  const tmp = `${path}.faststart${extname(path)}`;
  try {
    const proc = Bun.spawn(["ffmpeg", "-v", "error", "-y", "-i", path, "-c", "copy", "-movflags", "+faststart", tmp], {
      stdout: "ignore",
      stderr: "ignore",
    });
    if ((await proc.exited) === 0) await rename(tmp, path);
    else await rm(tmp, { force: true });
  } catch {
    await rm(tmp, { force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------- jobs

async function fetchJob(s: ReturnType<typeof settings>, jobId: string): Promise<RouterJob> {
  const { res, body } = await routerCall(s, `/jobs/${encodeURIComponent(jobId)}`);
  if (!res.ok || !body.json) throw new MediaError(routerMessage(body, res), res.ok ? 502 : res.status, "router_error", { jobId });
  return body.json as unknown as RouterJob;
}

const isTerminal = (status: string) => status === "succeeded" || status === "failed";

async function waitForJob(s: ReturnType<typeof settings>, jobId: string, timeoutMs: number): Promise<RouterJob> {
  const deadline = Date.now() + timeoutMs;
  let job = await fetchJob(s, jobId);
  while (!isTerminal(job.status) && Date.now() + s.pollMs <= deadline) {
    await s.sleep(s.pollMs);
    job = await fetchJob(s, jobId);
  }
  return job;
}

async function finishJob(
  s: ReturnType<typeof settings>,
  opts: MediaOptions,
  job: RouterJob,
  extra: { costMicros?: number; outputPath?: string },
) {
  const spend = await readSpend(opts.spendPath, utcDay(s.now()));
  const base = {
    jobId: job.jobId,
    status: job.status,
    model: job.model,
    ...(extra.costMicros !== undefined ? { costMicros: extra.costMicros, costUsd: usd(extra.costMicros) } : {}),
    spentTodayUsd: usd(spend.spentMicros),
    dailyCapUsd: usd(s.maxDayMicros),
  };
  if (job.status === "failed") {
    return { ...base, error: job.error || "The provider failed the job.", urls: [], paths: [] };
  }
  if (job.status !== "succeeded") {
    return {
      ...base,
      pending: true,
      urls: [],
      paths: [],
      next: `The job is still ${job.status}. Call omg_media_job with jobId "${job.jobId}" later to wait for it and download the result. Do not generate again; that would charge twice.`,
    };
  }
  const paths = await downloadResults(s, job, extra.outputPath);
  return { ...base, urls: (job.results ?? []).map((r) => r.url), paths };
}

function waitMsFor(kind: MediaKind, req: { wait?: boolean; waitSeconds?: number }): number {
  if (req.wait === false) return 0;
  const cap = kind === "video" ? VIDEO_WAIT_MS : IMAGE_WAIT_MS;
  if (typeof req.waitSeconds === "number" && req.waitSeconds >= 0) return Math.min(req.waitSeconds * 1000, VIDEO_WAIT_MS);
  return cap;
}

export async function generateMedia(req: GenerateRequest, opts: MediaOptions) {
  const s = settings(opts);
  requireBase(s.base);
  const kind: MediaKind = req.kind === "video" ? "video" : "image";
  const model = req.model?.trim() || (kind === "video" ? DEFAULT_VIDEO_MODEL : DEFAULT_IMAGE_MODEL);
  const input = req.input ?? {};

  const submitted = await withSpendLock(async () => {
    const quote = await routerCall(s, "/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input, kind, ...(req.provider ? { provider: req.provider } : {}) }),
    });
    if (quote.res.status === 404) throw new MediaError(MEDIA_MESSAGES.quoteUnavailable, 501, "quote_unavailable");
    if (!quote.res.ok) {
      const msg = routerMessage(quote.body, quote.res);
      const status = typeof quote.body.json?.status === "string" ? quote.body.json.status : "";
      throw new MediaError(`Could not price ${model}: ${msg}`, quote.res.status, status || (quote.res.status === 400 ? "unknown_model" : "router_error"));
    }
    const costMicros = Number(quote.body.json?.costMicros);
    if (!Number.isFinite(costMicros) || costMicros < 0) {
      throw new MediaError(`The media router returned no price for ${model}.`, 502, "router_error");
    }
    const quotedKind = quote.body.json?.kind;
    // "auto" resolves at quote time. Submit the model that was priced, so the
    // cap check and the charge describe the same job.
    const chosen = typeof quote.body.json?.model === "string" && quote.body.json.model ? quote.body.json.model : model;
    const provider = typeof quote.body.json?.provider === "string" && quote.body.json.provider ? quote.body.json.provider : req.provider;

    if (costMicros > s.maxCallMicros) {
      throw new MediaError(
        `This ${chosen} job costs $${usd(costMicros).toFixed(3)}, above the per-call cap of $${usd(s.maxCallMicros).toFixed(2)}. Choose a cheaper model or smaller settings, or raise OMG_MEDIA_MAX_CALL_USD.`,
        400,
        "per_call_cap",
        { costMicros, costUsd: usd(costMicros), maxCallUsd: usd(s.maxCallMicros) },
      );
    }
    const day = utcDay(s.now());
    const spend = await readSpend(opts.spendPath, day);
    const leftMicros = Math.max(0, s.maxDayMicros - spend.spentMicros);
    if (costMicros > leftMicros) {
      throw new MediaError(
        `This ${chosen} job costs $${usd(costMicros).toFixed(3)}, but only $${usd(leftMicros).toFixed(3)} of the $${usd(s.maxDayMicros).toFixed(2)} daily media cap is left today (UTC). Try again tomorrow, choose a cheaper model, or raise OMG_MEDIA_MAX_DAY_USD.`,
        400,
        "daily_cap",
        { costMicros, costUsd: usd(costMicros), spentTodayUsd: usd(spend.spentMicros), dailyCapUsd: usd(s.maxDayMicros), leftTodayUsd: usd(leftMicros) },
      );
    }

    // The router refuses the job if its real price exceeds this, so the caps
    // hold even when the price moves between quote and submit.
    const maxCostMicros = Math.min(s.maxCallMicros, leftMicros);
    const sub = await routerCall(s, "/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: chosen, input, maxCostMicros, ...(provider ? { provider } : {}) }),
    });
    if (!sub.res.ok) throw mapSubmitError(sub.res, sub.body);
    const jobId = typeof sub.body.json?.jobId === "string" ? sub.body.json.jobId : "";
    if (!jobId) throw new MediaError("The media router accepted the job but returned no jobId.", 502, "router_error");
    const charged = Number(sub.body.json?.costMicros);
    const chargedMicros = Number.isFinite(charged) && charged >= 0 ? charged : costMicros;
    await writeSpend(opts.spendPath, { day, spentMicros: spend.spentMicros + chargedMicros });
    return {
      jobId,
      status: String(sub.body.json?.status ?? "queued"),
      costMicros: chargedMicros,
      model: chosen,
      kind: (quotedKind === "video" || quotedKind === "image" ? quotedKind : kind) as MediaKind,
    };
  });

  const timeoutMs = waitMsFor(submitted.kind, req);
  const job: RouterJob =
    timeoutMs > 0
      ? await waitForJob(s, submitted.jobId, timeoutMs)
      : { jobId: submitted.jobId, status: submitted.status, model: submitted.model };
  return finishJob(s, opts, { ...job, model: job.model ?? submitted.model }, { costMicros: submitted.costMicros, outputPath: req.outputPath });
}

export async function mediaJob(
  jobId: string,
  req: { outputPath?: string; wait?: boolean; waitSeconds?: number },
  opts: MediaOptions,
) {
  const s = settings(opts);
  requireBase(s.base);
  const timeoutMs = req.wait === false ? 0 : waitMsFor("video", req);
  const job = timeoutMs > 0 ? await waitForJob(s, jobId, timeoutMs) : await fetchJob(s, jobId);
  return finishJob(s, opts, job, { outputPath: req.outputPath });
}

// ---------------------------------------------------------------- HTTP

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

function errorResponse(e: unknown): Response {
  if (e instanceof MediaError) return json({ error: e.message, status: e.status, ...e.extra }, e.httpStatus);
  return json({ error: (e as Error)?.message || String(e), status: "error" }, 500);
}

function plainObject(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

export function isMediaPath(path: string): boolean {
  return path === "/api/media/models" || path === "/api/media/generate" || /^\/api\/media\/jobs\/[^/]+$/.test(path);
}

/**
 * Routes:
 *   GET  /api/media/models
 *   POST /api/media/generate {kind?, model?, input?, outputPath?, wait?, waitSeconds?}
 *   GET  /api/media/jobs/:id?wait=1&outputPath=...
 */
export async function handleMediaRequest(req: Request, url: URL, opts: MediaOptions): Promise<Response | null> {
  const path = url.pathname;
  if (!isMediaPath(path)) return null;
  try {
    if (path === "/api/media/models" && req.method === "GET") {
      const q = url.searchParams;
      const limit = Number(q.get("limit"));
      return json(
        await listModels(opts, {
          all: q.get("all") === "1" || q.get("all") === "true",
          q: q.get("q") ?? undefined,
          kind: q.get("kind") ?? undefined,
          task: q.get("task") ?? undefined,
          provider: q.get("provider") ?? undefined,
          limit: Number.isFinite(limit) && limit > 0 ? limit : undefined,
        }),
      );
    }
    if (path === "/api/media/generate" && req.method === "POST") {
      const body = plainObject(await req.json().catch(() => null));
      if (!body) return json({ error: "JSON body required", status: "invalid_request" }, 400);
      return json(
        await generateMedia(
          {
            kind: body.kind === "video" ? "video" : "image",
            model: typeof body.model === "string" ? body.model : undefined,
            provider: body.provider === "fal" || body.provider === "wavespeed" ? body.provider : undefined,
            input: plainObject(body.input),
            outputPath: typeof body.outputPath === "string" && body.outputPath.trim() ? body.outputPath.trim() : undefined,
            wait: typeof body.wait === "boolean" ? body.wait : undefined,
            waitSeconds: typeof body.waitSeconds === "number" ? body.waitSeconds : undefined,
          },
          opts,
        ),
      );
    }
    const m = path.match(/^\/api\/media\/jobs\/([^/]+)$/);
    if (m && req.method === "GET") {
      const waitParam = url.searchParams.get("wait");
      const waitSeconds = Number(url.searchParams.get("waitSeconds"));
      return json(
        await mediaJob(
          decodeURIComponent(m[1]),
          {
            outputPath: url.searchParams.get("outputPath")?.trim() || undefined,
            wait: waitParam === null ? undefined : waitParam !== "0" && waitParam !== "false",
            waitSeconds: Number.isFinite(waitSeconds) && url.searchParams.has("waitSeconds") ? waitSeconds : undefined,
          },
          opts,
        ),
      );
    }
    return json({ error: "method not allowed" }, 405);
  } catch (e) {
    return errorResponse(e);
  }
}
