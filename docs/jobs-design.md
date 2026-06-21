# Jobs: action-first scheduled agents

Replaces the report-writing agents. The artifact is no longer a markdown
document — it's a deduplicated list of **action items with reasoning**. A run
that produces zero items is a success, not an empty report.

## Why

The old model made the *report* the artifact and scraped actions out of it. The
format rewarded coverage, so agents padded the document and re-surfaced the same
low-value findings every day. Noise accumulated over time with no way to say "I
already saw that, stop."

The fix is structural, not a better prompt:

- No document to pad — an item must carry a concrete action + reasoning or it
  doesn't exist.
- Stable per-item `key` → recurring findings collapse onto one item instead of
  re-accumulating as fresh prose each run.
- Dismiss is a fed-back signal — a dismissed item's key is injected into the
  next run so the agent won't resurface it.
- Limits (`maxItems`, `minSeverity`) enforced in code, not prompt pleas.

## Domain model

```ts
// A saved, schedulable instruction. Created/edited from the web UI.
type Job = {
  id: string;
  name: string;
  schedule: string | null;        // cron expr; null = manual-only
  enabled: boolean;
  sources: InputSpec[];           // reuse existing collectors unchanged
  instruction: string;            // free text: what to do / what to watch for
  limits: { maxItems: number; minSeverity: Severity };
};

type Severity = "low" | "medium" | "high";

// What the model emits per run (validated). NOT prose.
type ItemDraft = {
  key: string;                    // model-chosen stable slug → identity
  title: string;                  // one line
  reasoning: string;              // WHY — the part worth keeping
  severity: Severity;
  action?: { directive: string; labels?: string[]; scope?: CodeRef[] };
};

// Persisted item, keyed by (jobId, key). Survives across runs.
type Item = ItemDraft & {
  jobId: string;
  status: "open" | "accepted" | "snoozed" | "dismissed" | "done";
  firstSeen: string;              // ISO date
  lastSeen: string;
  lastRunId: string;
  snoozedUntil?: string;
};

// Thin run log. Replaces the markdown report.
type Run = {
  id: string; jobId: string;
  startedAt: string; finishedAt?: string;
  ok: boolean; error?: string;
  inputsSeen: string[];           // anti-hallucination receipt
  itemKeys: string[];             // keys produced this run
};

type CodeRef = { file: string; line?: number };
```

## Merge / dedup (the heart of the noise fix)

On each run, for every `ItemDraft` emitted, upsert by `(jobId, key)`:

- **new key** → create Item, `status: open`, `firstSeen = now`.
- **exists & open/accepted** → refresh title/reasoning/severity, bump `lastSeen`.
- **exists & dismissed** → skip (do NOT resurface). The key is already in the
  dismiss-feedback block, so a well-behaved run won't even emit it.
- **exists & snoozed** → reopen only if `now >= snoozedUntil`.

Items not re-emitted this run are left untouched (they persist as open until
acted on). We never delete items the agent stopped mentioning — the human closes
the loop, not the model.

### Dismiss feedback

Before building the prompt, load this job's `dismissed` (and active `snoozed`)
items and inject:

```
## Do not resurface
The human has dismissed these. Do not propose them again:
- <title> (key: <key>)
```

This is the loop the old system completely lacked — it never knew what you
ignored.

## Output contract

Default backend: `claude -p` (CLI, subscription auth). The agent is instructed
to emit a **single trailing ```json block** matching the `ItemDraft[]` schema.
The runner extracts it, validates with zod, and does **one** repair-retry on
failure. (ai-sdk `generateObject` remains an optional backend.)

The runner then applies `limits`: filter below `minSeverity`, sort by severity,
`slice(maxItems)`. Enforced in code.

## Scheduler

`lfg-serve` already runs persistently, so the scheduler lives in-process:

- On startup and every 60s, evaluate each enabled job's cron against its
  persisted `lastRunAt`.
- When due and not already running, trigger `runJob(id)`.
- Persist `lastRunAt` so restarts don't double-fire or skip.
- Per-job concurrency guard so a slow run can't overlap itself.

Use a small cron parser (e.g. `croner`). The `schedule` field, inert today,
finally drives execution.

## API (new `/api/jobs` surface)

```
GET    /api/jobs                 list
POST   /api/jobs                 create
GET    /api/jobs/:id             get
PUT    /api/jobs/:id             update
DELETE /api/jobs/:id
POST   /api/jobs/:id/run         manual trigger (reuse SSE run streaming)

GET    /api/items?status=open    inbox feed across all jobs
POST   /api/items/:id/accept     dispatch action, mark done
POST   /api/items/:id/dismiss    fed back into future runs
POST   /api/items/:id/snooze     {until}
```

`accept` reuses the existing action-execution pipeline
(`POST /api/actions/execute`).

## UI

Two surfaces replace `AgentView` / `ActionsPanel`:

1. **Action inbox** (primary) — one feed of open items across all jobs, sortable
   by severity/job. Each row: title, severity, expandable reasoning, action
   preview, and accept / dismiss / snooze. This is the thing you check daily.
2. **Jobs** — list with enable toggles + a **New Job** form: name, schedule
   (presets + raw cron), sources picker, instruction textarea, limits. Writes
   through `POST /api/jobs`.

## Reuse vs retire

**Reuse:** collectors (`src/agents/collectors/*`), the `claude -p` pipe, SSE run
streaming, the action-execution pipeline.

**Retire:** markdown report generation, `parseActions` / `.actions.jsonl`
scraping, `AgentView` / `ActionsPanel` report pages, the `data/agents/*.md`
authoring flow.

## File layout

```
src/jobs/
  schema.ts       zod: Job, ItemDraft, Item, Run
  registry.ts     load/save Job defs   (data/jobs/<id>/job.json)
  store.ts        item persistence + merge/dedup/dismiss
  runner.ts       runJob(): prompt -> claude -> parse -> merge
  scheduler.ts    in-process cron tick loop
  sources/        re-export of existing collectors
data/jobs/<id>/
  job.json
  items.jsonl
  runs/<runId>.json
```

## Build order

1. **Item model + store + runner** — emit `ItemDraft[]`, merge/dedup, dismiss
   feedback. Validate by running one job by hand. (The noise fix lives here.)
2. **Scheduler** — cron loop in serve; now autonomous.
3. **UI** — inbox + New Job form.
