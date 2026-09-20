/**
 * Demo mode: a seeded OmgTransport.
 *
 * Demo mode exists so the app can be SEEN full — for the landing page, the App
 * Store screenshots, and any review of a screen that is empty on a fresh
 * account. A real account with no Computer and no sessions renders blank lists,
 * which show nothing about the product.
 *
 * The seam is the transport, not the client. `getHostedTransport` returns this
 * when demo mode is on, so the real `OmgClient`, the real readiness probe, and
 * every screen that reads `client.transport.request(...)` run completely
 * unchanged on top of seeded answers. That is the whole reason this is a
 * transport and not a fake client: there is one owner of the seam, and no
 * screen knows demo mode exists.
 *
 * Every string here is fiction this file owns. Nothing is read from a real
 * account, so demo mode cannot leak a session, an email, or a repository name.
 */

import type { OmgTransport } from "@omg-dev/client";
import type { OmgMessage, OmgSession } from "@omg-dev/protocol";

const MIN = 60_000;
const HOUR = 60 * MIN;

/** All timestamps are relative to load so "now / 3m / 2h" stay fresh. */
const now = () => Date.now();

/**
 * The session list. Busy rows land in WORKING, the rest in IDLE — the home
 * screen splits on `busy`. `botId` rows also drive the Bots screen's "working
 * now" cross-reference, so two of these carry one.
 */
/**
 * `botId` is not on the base `OmgSession` — the server adds it and the Bots
 * screen reads it back through a local cast (`OmgSession & { botId?: string }`).
 * The seeded rows carry it the same way so a bot's live session lights up.
 */
type DemoSession = OmgSession & { botId?: string };

/**
 * The home is scoped to ONE folder on the phone (session-options.ts picks the
 * first, or the binding's defaultFolder). So the default folder — api-gateway,
 * pinned by DEMO_BINDING.defaultFolder — carries a full board: two agents
 * working and two idle. The other folders hold one session each, enough to
 * populate the folder rail and to feed the Bots and Notifications screens.
 */
function demoSessions(): DemoSession[] {
  const t = now();
  const sessions: DemoSession[] = [
    // ── api-gateway: the default folder, shown full on home ────────────────
    {
      sessionId: "demo-rate-limiter",
      tmuxTarget: "omg-demo:demo-rate-limiter",
      agent: "claude",
      agentLabel: "Claude Code",
      title: "Refactor the rate limiter to a sliding window",
      lastUserText: "Switch the rate limiter from a fixed window to a sliding one.",
      project: "api-gateway",
      cwd: "/home/user/api-gateway",
      model: "claude-sonnet",
      startedAt: t - 22 * MIN,
      lastActivityAt: t - 20_000,
      busy: true,
      last: { role: "assistant", text: "Running the limiter tests…", ts: t - 20_000 },
    },
    {
      sessionId: "demo-token-refresh",
      tmuxTarget: "omg-demo:demo-token-refresh",
      agent: "codex",
      agentLabel: "Codex",
      title: "Fix the token refresh race on cold start",
      lastUserText: "Two requests refresh the token at once on boot — dedupe it.",
      project: "api-gateway",
      cwd: "/home/user/api-gateway",
      model: "gpt-5",
      startedAt: t - 12 * MIN,
      lastActivityAt: t - 8_000,
      busy: true,
      last: { role: "assistant", text: "Wrapping the mint in a single-flight promise.", ts: t - 8_000 },
    },
    {
      sessionId: "demo-orders-pagination",
      tmuxTarget: "omg-demo:demo-orders-pagination",
      agent: "codex",
      agentLabel: "Codex",
      title: "Add pagination to /v1/orders",
      lastUserText: "Add cursor-based pagination to GET /v1/orders.",
      project: "api-gateway",
      cwd: "/home/user/api-gateway",
      model: "gpt-5",
      startedAt: t - 6 * HOUR,
      lastActivityAt: t - 2 * HOUR,
      busy: false,
      last: { role: "assistant", text: "Cursor param wired, tests green.", ts: t - 2 * HOUR },
    },
    {
      sessionId: "demo-webhook-retry",
      tmuxTarget: "omg-demo:demo-webhook-retry",
      agent: "claude",
      agentLabel: "Claude Code",
      title: "Write integration tests for the webhook retry logic",
      lastUserText: "Cover the retry-with-backoff path with an integration test.",
      project: "api-gateway",
      cwd: "/home/user/api-gateway",
      model: "claude-sonnet",
      startedAt: t - 26 * HOUR,
      lastActivityAt: t - 4 * HOUR,
      busy: false,
      last: { role: "assistant", text: "Added 3 tests. Two green, one flakes on timing.", ts: t - 4 * HOUR },
    },
    // ── other folders: one each, to populate the rail and other screens ────
    {
      sessionId: "demo-checkout-test",
      tmuxTarget: "omg-demo:demo-checkout-test",
      agent: "codex",
      agentLabel: "Codex",
      title: "Fix the failing checkout test",
      lastUserText: "Fix the failing checkout test and ship it.",
      project: "checkout",
      cwd: "/home/user/checkout",
      model: "gpt-5",
      startedAt: t - 8 * MIN,
      lastActivityAt: t - 5_000,
      busy: true,
      last: { role: "assistant", text: "Reproduced the timeout, patching the retry.", ts: t - 5_000 },
    },
    {
      sessionId: "demo-onboarding-emails",
      tmuxTarget: "omg-demo:demo-onboarding-emails",
      agent: "claude",
      agentLabel: "Claude Code",
      title: "Migrate the onboarding emails to Resend",
      lastUserText: "Port the 5 onboarding emails off the old template.",
      project: "email-service",
      cwd: "/home/user/email-service",
      model: "claude-sonnet",
      startedAt: t - 5 * HOUR,
      lastActivityAt: t - 55 * MIN,
      busy: false,
      last: { role: "assistant", text: "3 of 5 ported. Two need a product-owner sign-off.", ts: t - 55 * MIN },
    },
    // ── bot-driven: hidden from home, shown on the Bots screen ─────────────
    {
      sessionId: "demo-changelog",
      tmuxTarget: "omg-demo:demo-changelog",
      agent: "claude",
      agentLabel: "Claude Code",
      title: "Draft the v0.5 changelog",
      lastUserText: "Draft release notes for v0.5 from the merged PRs.",
      project: "docs",
      cwd: "/home/user/docs",
      model: "claude-sonnet",
      startedAt: t - 3 * HOUR,
      lastActivityAt: t - 28 * MIN,
      busy: false,
      managed: true,
      botId: "demo-bot-docs",
      last: { role: "assistant", text: "Draft is in CHANGELOG.md with 11 entries.", ts: t - 28 * MIN },
    },
    {
      sessionId: "demo-saml-sso",
      tmuxTarget: "omg-demo:demo-saml-sso",
      agent: "claude",
      agentLabel: "Claude Code",
      title: "Add SAML SSO to the admin app",
      lastUserText: "Add SAML SSO to /admin after the IdP callback.",
      project: "admin",
      cwd: "/home/user/admin",
      model: "claude-sonnet",
      startedAt: t - 26 * HOUR,
      lastActivityAt: t - 6 * HOUR,
      busy: false,
      managed: true,
      botId: "demo-bot-security",
      last: { role: "assistant", text: "SSO flow lands on /admin, 4 files changed.", ts: t - 6 * HOUR },
    },
  ];
  // Explicit local stress fixture. Never used by a real transport or default demo.
  if (process.env.EXPO_PUBLIC_OMG_PERFORMANCE_FIXTURE === "1") {
    for (let i = 1; i <= 60; i++) sessions.push({
      ...sessions[0], sessionId: `demo-perf-${i}`, tmuxTarget: `omg-demo:perf-${i}`,
      title: `Performance session ${String(i).padStart(2, "0")}`,
      busy: i % 3 === 0, lastActivityAt: t - (i + 30) * MIN,
    });
  }
  return sessions;
}

/** A single session's transcript, for the opened-chat screen. */
function demoMessages(sessionId: string): OmgMessage[] {
  const t = now();
  if (process.env.EXPO_PUBLIC_OMG_PERFORMANCE_FIXTURE === "1" && sessionId === "demo-rate-limiter") {
    return Array.from({ length: 100 }, (_, i) => ({
      id: `perf-message-${i + 1}`, role: i % 2 ? "assistant" : "user", kind: "text",
      text: `History message ${String(i + 1).padStart(3, "0")}. ` +
        (i % 2 ? "Checked the sliding window. The per-key limits remain unchanged." : "Check the next sliding-window case."),
      ts: t - (101 - i) * MIN,
    }));
  }

  if (sessionId === "demo-rate-limiter") {
    return [
      { id: "m1", role: "user", kind: "text", text: "Switch the rate limiter from a fixed window to a sliding one. Keep the same per-key limits.", ts: t - 22 * MIN },
      { id: "m2", role: "assistant", kind: "text", text: "On it. The fixed window lets a burst through at the boundary — a sliding window over the same interval fixes that. I'll keep the per-key config and swap the counter.", ts: t - 21 * MIN },
      { id: "m3", role: "assistant", kind: "text", text: "Replaced the fixed-window counter in `limiter.ts` with a sliding log keyed by client id. Added a test that fires two bursts across a window boundary and asserts the second is throttled.", ts: t - 12 * MIN },
      { id: "m4", role: "user", kind: "text", text: "Nice. Run the suite and push if it's green.", ts: t - 6 * MIN },
      { id: "m5", role: "assistant", kind: "text", text: "Running the limiter tests…", ts: t - 20_000, pending: true },
    ];
  }
  return [
    { id: "g1", role: "user", kind: "text", text: "What's the status?", ts: t - 30 * MIN },
    { id: "g2", role: "assistant", kind: "text", text: "Done and pushed to main. Tests are green.", ts: t - 28 * MIN },
  ];
}

/** Notifications: open questions and shipped posts. */
function demoAsk() {
  const t = now();
  return {
    questions: [
      { id: "q1", question: "Pricing page headline A/B — should the control be A (\"Deploy AI agents for teams\") or B (\"Ship while you sleep\")?", sessionId: "demo-growth", agent: "claude", createdAt: t - 6 * MIN },
      { id: "q2", question: "The changelog has two entries that need a product-owner to confirm the wording. Approve as written?", sessionId: "demo-changelog", agent: "claude", createdAt: t - 28 * MIN },
    ],
  };
}

function demoShipped() {
  const t = now();
  return {
    posts: [
      { id: "s1", title: "Checkout test fixed", summary: "Reproduced the boundary timeout, retried with backoff. Tests green, pushed to main.", sessionId: "demo-checkout-test", agent: "codex", ts: t - 2 * MIN },
      { id: "s2", title: "Sliding-window rate limiter landed", summary: "Burst traffic at the window edge no longer doubles the allowance.", sessionId: "demo-rate-limiter", agent: "claude", ts: t - 2 * HOUR },
      { id: "s3", title: "Orders pagination shipped", summary: "GET /v1/orders now takes a cursor. Old callers unaffected.", sessionId: "demo-orders-pagination", agent: "codex", ts: t - 5 * HOUR },
    ],
  };
}

/** Bots: persistent colleagues. Two are cross-referenced by the sessions above. */
function demoBots() {
  const t = now();
  return {
    bots: [
      { id: "demo-bot-docs", name: "Docs", blurb: "Keeps the changelog and docs in sync with merged PRs.", lastMessageAt: t - 28 * MIN, lastMessagePreview: "Draft is in CHANGELOG.md with 11 entries." },
      { id: "demo-bot-security", name: "Security", blurb: "Reviews auth and access-control changes before they land.", lastMessageAt: t - 6 * HOUR, lastMessagePreview: "SSO flow lands on /admin, 4 files changed." },
      { id: "demo-bot-release", name: "Release", blurb: "Cuts releases and posts what shipped.", lastMessageAt: t - 26 * HOUR, lastMessagePreview: "v0.4 is out. Notes attached." },
    ],
  };
}

/** Schedules: agents that run on a timer. */
function demoAutoAgents() {
  return {
    tz: "Asia/Hong_Kong",
    agents: [
      { id: "demo-auto-prs", name: "Review open PRs", enabled: true, schedule: "Every weekday at 09:00", lastRunAt: now() - 3 * HOUR },
      { id: "demo-auto-bugs", name: "Triage new bug reports", enabled: true, schedule: "Every 6 hours", lastRunAt: now() - 2 * HOUR },
      { id: "demo-auto-deps", name: "Weekly dependency audit", enabled: false, schedule: "Mondays at 08:00", lastRunAt: now() - 30 * HOUR },
    ],
  };
}

function demoAutoFindings() {
  const t = now();
  return {
    findings: [
      { id: "f1", agentId: "demo-auto-bugs", title: "Two deals at risk in this week's call reviews", createdAt: t - 45 * MIN },
      { id: "f2", agentId: "demo-auto-prs", title: "3 PRs waiting on review for over a day", createdAt: t - 3 * HOUR },
    ],
  };
}

/** The readiness / bootstrap answer: a ready Computer with a roster. */
function demoBootstrap() {
  return {
    version: "demo",
    sessions: demoSessions(),
    codingAgents: [
      { key: "claude", label: "Claude Code", visible: true, status: { configured: true, accountConnected: true } },
      { key: "codex", label: "Codex", visible: true, status: { configured: true, accountConnected: true } },
    ],
    repos: [
      { name: "api-gateway", cwd: "/home/user/api-gateway", project: "api-gateway" },
      { name: "checkout", cwd: "/home/user/checkout", project: "checkout" },
      { name: "docs", cwd: "/home/user/docs", project: "docs" },
      { name: "email-service", cwd: "/home/user/email-service", project: "email-service" },
    ],
  };
}

/** A socket that opens and then stays quiet — enough to read as connected. */
function demoSocket() {
  const openListeners: Array<() => void> = [];
  const socket = {
    binaryType: "arraybuffer" as BinaryType,
    readyState: 1,
    send() {},
    close() {},
    addEventListener(type: string, listener: unknown) {
      if (type === "open") {
        openListeners.push(listener as () => void);
        // Fire on the next tick so the caller has finished wiring its handlers.
        setTimeout(() => {
          for (const l of openListeners) l();
        }, 0);
      }
      // "message" / "close" / "error" are never emitted: the seeded lists are
      // the whole story, and a static screen wants no live churn on top.
    },
  };
  return socket as unknown as Awaited<ReturnType<OmgTransport["openSocket"]>>;
}

/** Two Claude logins so the usage drawer has a profile to name, not one merged ring. */
function demoUsageProviders() {
  const t = now();
  return [
    {
      id: "claude:one",
      kind: "claude",
      label: "Claude 1",
      accountLabel: "Claude 1",
      available: true,
      plan: "Max",
      windows: [
        { label: "7 day", pct: 42, resetsAt: t + 2 * 24 * HOUR },
        { label: "5 hr", pct: 18, resetsAt: t + 3 * HOUR },
      ],
    },
    {
      id: "claude:two",
      kind: "claude",
      label: "Claude 2",
      accountLabel: "Claude 2",
      available: true,
      plan: "Pro",
      windows: [
        { label: "7 day", pct: 81, resetsAt: t + 4 * 24 * HOUR },
        { label: "5 hr", pct: 55, resetsAt: t + HOUR },
      ],
    },
    {
      id: "codex",
      kind: "codex",
      label: "Codex",
      available: true,
      plan: "Plus",
      windows: [
        { label: "Weekly", pct: 30, resetsAt: t + 3 * 24 * HOUR },
        { label: "5 hr", pct: 12, resetsAt: t + 4 * HOUR },
      ],
    },
  ];
}

/** Route a path to its seeded body. Returns null for an unknown path. */
function answer(path: string): unknown | null {
  const clean = path.split("?")[0];
  if (clean === "/api/bootstrap") return demoBootstrap();
  if (clean === "/api/sessions") return { sessions: demoSessions() };
  if (clean === "/api/ask") return demoAsk();
  if (clean === "/api/shipped") return demoShipped();
  if (clean === "/api/bots") return demoBots();
  if (clean === "/api/auto/agents") return demoAutoAgents();
  if (clean === "/api/auto/findings") return demoAutoFindings();
  if (clean === "/api/usage") return { providers: demoUsageProviders() };
  if (clean === "/api/usage/summary") return { providers: demoUsageProviders() };
  if (clean === "/api/usage/providers") {
    return {
      providers: demoUsageProviders().map(({ id, kind, label }) => ({ id, kind, label })),
    };
  }
  const usageOne = clean.match(/^\/api\/usage\/(.+)$/);
  if (usageOne) {
    const id = decodeURIComponent(usageOne[1]);
    const provider = demoUsageProviders().find((entry) => entry.id === id);
    return provider ? { provider } : {};
  }
  const messages = clean.match(/^\/api\/sessions\/([^/]+)\/messages$/);
  if (messages) {
    const limit = Number(new URL(path, "https://demo.invalid").searchParams.get("limit")) || 40;
    return { messages: demoMessages(decodeURIComponent(messages[1])).slice(-limit) };
  }
  // Writes (send / interrupt / toggles) succeed silently — demo mode never
  // reaches a real box, and a screenshot is not going to send a message.
  return {};
}

let demoTransport: OmgTransport | null = null;

/**
 * The seeded transport, built once. Every method the client and the screens
 * use is answered from the fixtures above; anything unknown returns an empty
 * object rather than throwing, so a new screen added later degrades to blank
 * instead of crashing demo mode.
 */
export function getDemoTransport(): OmgTransport {
  if (demoTransport) return demoTransport;
  demoTransport = {
    async fetch(path: string) {
      const body = answer(path);
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify(body ?? {});
        },
        async json() {
          return body ?? {};
        },
      } as unknown as Response;
    },
    async request<T>(path: string): Promise<T> {
      return (answer(path) ?? {}) as T;
    },
    async openSocket() {
      return demoSocket();
    },
    async openLiveSocket() {
      return demoSocket();
    },
  };
  return demoTransport;
}
