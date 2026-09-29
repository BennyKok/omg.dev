// A closed session that the kernel OOM killer stopped says so in the picker.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, type Mounted } from "../test-support/render";
import { createSameOriginTransport } from "@omg-dev/client";
import { configureOmgTransport } from "../lib/omg-client";

const { default: ResumeSessionSheet } = await import("./resume-session-sheet");

let ui: Mounted;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  ui = mount();
});

afterEach(() => {
  ui.cleanup();
  globalThis.fetch = originalFetch;
  configureOmgTransport(createSameOriginTransport());
});

test("an out-of-memory session is labelled, others are not", async () => {
  const row = (sessionId: string, title: string, exitReason?: "out_of_memory") => ({
    sessionId,
    cwd: "/home/dev/repos/lfg",
    project: "lfg",
    title,
    lastActivityAt: 1_000,
    lastUserText: null,
    agent: "claude",
    ...(exitReason ? { exitReason } : {}),
  });
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes("/api/sessions/resumable")) return new Response("not found", { status: 404 });
    const sessions = [row("a", "connect expo", "out_of_memory"), row("b", "fix onboarding")];
    return Response.json({ sessions, total: 2, scheduledTotal: 0, facets: { agents: [], projects: [] } });
  }) as typeof fetch;
  configureOmgTransport(createSameOriginTransport());

  ui.render(
    <ResumeSessionSheet initial={null} scopedProject="__all" onRestore={() => {}} onPick={() => {}} onClose={() => {}} />,
  );
  await ui.flushAsync();

  // The sheet is a Drawer that portals to document.body.
  const rows = [...document.body.querySelectorAll("button[title]")].map((el) => el.textContent ?? "");
  const oom = rows.find((text) => text.includes("connect expo"));
  const ok = rows.find((text) => text.includes("fix onboarding"));
  expect(oom).toContain("Out of memory");
  expect(ok).toBeDefined();
  expect(ok).not.toContain("Out of memory");
});
