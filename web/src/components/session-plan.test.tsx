import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { mount, type Mounted } from "../test-support/render";
import type { OmgSessionPlan } from "@omg-dev/protocol";

const { SessionPlanChip, SessionPlanView, planActionMessage, planProgress, useSessionPlan } = await import("./session-plan");
import type { TeamMember } from "@/lib/session-team";
import { createSameOriginTransport } from "@omg-dev/client";
import { configureOmgTransport } from "../lib/omg-client";
const { AskProvider } = await import("./ask-center");

const plan: OmgSessionPlan = {
  source: "claude",
  updatedAt: 1,
  items: [
    { id: "todo-1", text: "Read the code", status: "completed" },
    { id: "todo-2", text: "Write the tests", activeText: "Writing the tests", status: "in_progress" },
    { id: "todo-3", text: "Ship it", status: "pending" },
  ],
  agents: [
    { id: "a1", title: "Search the repo", kind: "Explore", status: "running", startedAt: Date.now() - 65_000, detail: "Using Grep" },
    { id: "a2", title: "Review the diff", status: "failed", startedAt: 1_000, endedAt: 31_000, detail: "Timed out" },
  ],
};

let ui: Mounted;
beforeEach(() => {
  ui = mount();
});
afterEach(() => ui.cleanup());

const click = async (el: Element | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
    (el as HTMLElement).click();
  });
};
const button = (name: string) =>
  ui.queryAll("button").find((b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === name) ?? null;
const type = async (el: Element | null, value: string) => {
  const input = el as HTMLInputElement | HTMLTextAreaElement;
  const proto = Object.getPrototypeOf(input);
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
  });
};
const submit = async (form: Element | null) => {
  await act(async () => {
    form!.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event);
  });
};

describe("progress", () => {
  test("counts done steps, finds the current one, counts running sub-agents", () => {
    const p = planProgress(plan);
    expect(p).toMatchObject({ done: 1, total: 3, running: 1 });
    expect(p.current?.text).toBe("Write the tests");
    expect(planProgress(null)).toMatchObject({ done: 0, total: 0, current: null, running: 0 });
  });
});

describe("chip", () => {
  test("shows progress and running sub-agents, and opens the plan", async () => {
    let opened = 0;
    ui.render(<SessionPlanChip plan={plan} onClick={() => opened++} />);
    const chip = ui.query('[data-testid="session-plan-chip"]')!;
    expect(chip.textContent).toContain("1/3");
    expect(chip.getAttribute("aria-label")).toBe("Plan: 1 of 3 done, now Writing the tests, 1 agent working");
    await click(chip);
    expect(opened).toBe(1);
  });

  test("is absent when there is no plan", () => {
    ui.render(<SessionPlanChip plan={null} onClick={() => {}} />);
    expect(ui.query('[data-testid="session-plan-chip"]')).toBeNull();
    ui.render(<SessionPlanChip plan={{ ...plan, items: [], agents: [] }} onClick={() => {}} />);
    expect(ui.query('[data-testid="session-plan-chip"]')).toBeNull();
  });
});

describe("view", () => {
  test("lists the steps with their status; the current one reads as what the agent is doing", () => {
    ui.render(<SessionPlanView plan={plan} send={async () => {}} />);
    const rows = ui.queryAll('[data-testid="plan-item"]');
    expect(rows.map((r) => r.getAttribute("data-status"))).toEqual(["completed", "in_progress", "pending"]);
    expect(rows[1].textContent).toContain("Writing the tests");
    expect(rows[2].textContent).toContain("Ship it");
    expect(ui.text()).toContain("1 of 3 done");
  });

  test("running sub-agents show with what they do; finished ones fold away", async () => {
    ui.render(<SessionPlanView plan={plan} send={async () => {}} />);
    let agents = ui.queryAll('[data-testid="plan-agent"]');
    expect(agents.map((a) => a.getAttribute("data-status"))).toEqual(["running"]);
    expect(agents[0].textContent).toContain("Explore · Using Grep");
    expect(agents[0].textContent).toMatch(/1m \d+s/);
    expect(ui.text()).toContain("Sub-agents · 1 running");
    await click(button("1 finished"));
    agents = ui.queryAll('[data-testid="plan-agent"]');
    expect(agents.map((a) => a.getAttribute("data-status"))).toEqual(["running", "failed"]);
    expect(agents[1].textContent).toContain("Timed out");
    expect(agents[1].textContent).toContain("30s");
    await click(button("Hide finished"));
    expect(ui.queryAll('[data-testid="plan-agent"]')).toHaveLength(1);
  });

  test("a pending step offers Do this next, Skip and a note; each sends a plain message", async () => {
    const sent: string[] = [];
    ui.render(<SessionPlanView plan={plan} send={async (t) => void sent.push(t)} />);
    const pending = ui.queryAll('[data-testid="plan-item"]')[2];
    await click(pending.querySelector("button"));
    await click(button("Do this next"));
    expect(sent).toEqual(['Please do this step next: "Ship it".']);
    expect(ui.text()).toContain("Sent to the agent");
    // The actions fold away after a send.
    expect(ui.query('[data-testid="plan-item-actions"]')).toBeNull();

    await click(pending.querySelector("button"));
    await click(button("Add a note"));
    await type(ui.query('textarea[aria-label="Note for the agent"]'), "Use the staging bucket");
    await submit(ui.query('[data-testid="plan-item-actions"] form'));
    expect(sent.at(-1)).toBe('About the step "Ship it": Use the staging bucket');
  });

  test("a done step offers only a note; the current one cannot be moved up", async () => {
    ui.render(<SessionPlanView plan={plan} send={async () => {}} />);
    const [done, current] = ui.queryAll('[data-testid="plan-item"]');
    await click(done.querySelector("button"));
    expect(button("Do this next")).toBeNull();
    expect(button("Skip")).toBeNull();
    expect(button("Add a note")).not.toBeNull();
    await click(current.querySelector("button"));
    expect(button("Do this next")).toBeNull();
    expect(button("Skip")).not.toBeNull();
  });

  test("a failed send says so and keeps the actions open", async () => {
    ui.render(
      <SessionPlanView
        plan={plan}
        send={async () => {
          throw new Error("session is not running");
        }}
      />,
    );
    await click(ui.queryAll('[data-testid="plan-item"]')[2].querySelector("button"));
    await click(button("Skip"));
    expect(ui.text()).toContain("Could not send: session is not running");
    expect(ui.query('[data-testid="plan-item-actions"]')).not.toBeNull();
  });

  test("with no plan it says so, and offers no way to write the list", () => {
    ui.render(<SessionPlanView plan={null} send={async () => {}} />);
    expect(ui.text()).toContain("No to-do list yet");
    expect(ui.queryAll("input, textarea")).toHaveLength(0);
  });
});

describe("useSessionPlan", () => {
  test("listens passively, follows plan events, and stops on unmount", async () => {
    let listener: ((e: { type: string; plan?: OmgSessionPlan | null }) => void) | null = null;
    const calls: Array<{ sid: string; passive?: boolean }> = [];
    let unsubscribed = 0;
    const subscribe = ((sid: string, l: typeof listener, options?: { passive?: boolean }) => {
      calls.push({ sid, passive: options?.passive });
      listener = l;
      return () => void unsubscribed++;
    }) as never;
    let seen: OmgSessionPlan | null | undefined;
    function Probe() {
      seen = useSessionPlan("s1", subscribe);
      return null;
    }
    ui.render(<Probe />);
    expect(calls).toEqual([{ sid: "s1", passive: true }]);
    expect(seen).toBeNull();
    await act(async () => listener!({ type: "busy" }));
    expect(seen).toBeNull();
    await act(async () => listener!({ type: "plan", plan }));
    expect(seen).toEqual(plan);
    await act(async () => listener!({ type: "plan", plan: null }));
    expect(seen).toBeNull();
    ui.render(<></>);
    expect(unsubscribed).toBe(1);
  });
});

test("action messages read as the user's own words", () => {
  expect(planActionMessage("skip", { text: "Ship it" })).toBe('Please skip this step: "Ship it".');
  expect(planActionMessage("note", { text: "Ship it" }, "  Use staging  ")).toBe('About the step "Ship it": Use staging');
});

describe("team", () => {
  const now = Date.now();
  const team: TeamMember[] = [
    {
      id: "c1",
      nativeId: null,
      title: "APPS OWNER: move every app",
      agent: "Codex",
      state: "working",
      activity: "Running a command",
      lastActivityAt: now - 120_000,
      plan: { done: 2, total: 5, current: "Move games", running: [{ title: "Check parity", detail: "Using Bash" }], finished: 1 },
      children: [
        { id: "g1", nativeId: "g1-native", title: "GROUP B mover", agent: "Codex", state: "blocked", activity: "Out of credits", lastActivityAt: now, plan: null, children: [] },
      ],
    },
    { id: "c2", nativeId: null, title: "Storage cleanup", agent: "Claude", state: "idle", activity: "Waiting for your OK", lastActivityAt: now - 3 * 3600_000, plan: null, children: [] },
  ];

  test("shows every child session, nested, with its state, activity, progress and sub-agents", () => {
    ui.render(<SessionPlanView plan={null} team={team} send={async () => {}} />);
    const members = ui.queryAll('[data-testid="team-member"]');
    expect(members.map((m) => [m.getAttribute("data-id"), m.getAttribute("data-state")])).toEqual([
      ["c1", "working"],
      ["g1", "blocked"],
      ["c2", "idle"],
    ]);
    // The grandchild sits inside its parent's row.
    expect(members[0].contains(members[1])).toBe(true);
    expect(members[0].textContent).toContain("2/5");
    expect(members[0].textContent).toContain("Running a command");
    // The age, without which coding agent runs it.
    expect(members[0].textContent).toContain("2m");
    expect(members[0].textContent).not.toContain("Codex");
    expect(ui.queryAll('[data-testid="team-subagent"]')[0].textContent).toContain("Check parity · Using Bash");
    expect(members[1].textContent).toContain("Out of credits");
    expect(members[2].textContent).toContain("3h");
    expect(members[2].textContent).not.toContain("Claude");
    expect(ui.text()).toContain("Team · 3 · 1 working · 1 blocked");
    // A team alone is enough: no "No to-do list yet".
    expect(ui.text()).not.toContain("No to-do list yet");
  });

  test("a tap opens that session", async () => {
    const opened: string[] = [];
    ui.render(<SessionPlanView plan={plan} team={team} send={async () => {}} onOpenMember={(id) => opened.push(id)} />);
    const grandchild = ui.queryAll('[data-testid="team-member"]')[1];
    await click(grandchild.querySelector("button"));
    expect(opened).toEqual(["g1"]);
  });

  test("the chip shows for a team alone and counts its working agents", () => {
    ui.render(<SessionPlanChip plan={null} team={team} onClick={() => {}} />);
    const chip = ui.query('[data-testid="session-plan-chip"]')!;
    expect(chip.getAttribute("aria-label")).toBe("Plan: 1 agent working");
    ui.render(<SessionPlanChip plan={plan} team={team} onClick={() => {}} />);
    expect(ui.query('[data-testid="session-plan-chip"]')!.getAttribute("aria-label")).toBe(
      "Plan: 1 of 3 done, now Writing the tests, 2 agents working",
    );
  });
});

describe("status", () => {
  const status = {
    updatedAt: Date.now() - 5 * 60_000,
    headline: "Migrating tables: 12 of 40 done",
    text: "Next: **orders**.",
    stats: [
      { label: "Rows copied", value: "1.2M" },
      { label: "Errors", value: "3", tone: "bad" as const },
    ],
    chart: { kind: "line" as const, title: "Tables done", points: [{ label: "09:00", value: 2 }, { label: "10:00", value: 7 }, { label: "11:00", value: 12 }] },
  };

  test("shows the agent's headline, numbers, chart and text before the plan", async () => {
    ui.render(<SessionPlanView plan={{ ...plan, status }} send={async () => {}} />);
    await ui.flushAsync();
    const section = ui.query('[data-testid="plan-status"]')!;
    expect(section.textContent).toContain("Migrating tables: 12 of 40 done");
    expect(section.textContent).toContain("5m ago");
    const stats = ui.queryAll('[data-testid="panel-stat"]');
    expect(stats.map((s) => s.textContent)).toEqual(["Rows copied1.2M", "Errors3"]);
    expect(stats[1].querySelector("dd")!.className).toContain("text-red-600");
    const chart = ui.query('[data-testid="panel-chart"]')!;
    expect(chart.getAttribute("data-kind")).toBe("line");
    expect(chart.querySelector("svg")!.getAttribute("aria-label")).toBe("Tables done: 3 points, latest 11:00 12");
    // A line spans its own range: the lowest point sits at the bottom, the highest at the top.
    const ys = chart.querySelector("polyline")!.getAttribute("points")!.split(" ").map((p) => Number(p.split(",")[1]));
    expect(ys[0]).toBeGreaterThan(60);
    expect(ys[2]).toBeLessThan(10);
    expect(section.textContent).toContain("orders");
    // The status leads; the to-do list follows it.
    const items = ui.queryAll('[data-testid="plan-item"]');
    expect(section.compareDocumentPosition(items[0]) & window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("a few bars get a labeled row each", () => {
    const bars = { kind: "bar" as const, unit: "rows", points: [{ label: "users", value: 300 }, { label: "orders", value: 1500 }] };
    ui.render(<SessionPlanView plan={{ source: "omg", updatedAt: 1, items: [], agents: [], status: { ...status, chart: bars } }} send={async () => {}} />);
    const chart = ui.query('[data-testid="panel-chart"]')!;
    expect(chart.getAttribute("data-kind")).toBe("bar");
    expect(chart.textContent).toContain("users300 rows");
    expect(chart.textContent).toContain("orders1,500 rows");
    // A status alone is enough: no "No to-do list yet".
    expect(ui.text()).not.toContain("No to-do list yet");
  });

  test("the chip shows for a status alone and leads with its headline", () => {
    ui.render(<SessionPlanChip plan={{ source: "omg", updatedAt: 1, items: [], agents: [], status }} onClick={() => {}} />);
    expect(ui.query('[data-testid="session-plan-chip"]')!.getAttribute("aria-label")).toBe(
      "Plan: now Migrating tables: 12 of 40 done",
    );
  });

  test("a child's headline is its line in the team, unless it is blocked", () => {
    const team: TeamMember[] = [
      { id: "c1", nativeId: null, title: "Mover", agent: "Codex", state: "working", activity: "Running a command", lastActivityAt: null, plan: { done: 0, total: 0, running: [], finished: 0, headline: "Moved 4 of 9 apps" }, children: [] },
      { id: "c2", nativeId: null, title: "Blocked", agent: "Codex", state: "blocked", activity: "Out of credits", lastActivityAt: null, plan: { done: 0, total: 0, running: [], finished: 0, headline: "Moved 1 of 9" }, children: [] },
    ];
    ui.render(<SessionPlanView plan={null} team={team} send={async () => {}} />);
    const rows = ui.queryAll('[data-testid="team-member"]');
    expect(rows[0].textContent).toContain("Moved 4 of 9 apps");
    expect(rows[0].textContent).not.toContain("Running a command");
    expect(rows[1].textContent).toContain("Out of credits");
  });
});

describe("needs you", () => {
  const originalFetch = globalThis.fetch;
  let calls: { url: string; body: unknown }[] = [];
  let open: Record<string, unknown>[] = [];
  const team: TeamMember[] = [
    {
      id: "c1", nativeId: null, title: "APPS OWNER", agent: "Codex", state: "working", activity: "", lastActivityAt: null, plan: null,
      children: [{ id: "g1", nativeId: "g1-native", title: "GROUP B mover", agent: "Codex", state: "blocked", activity: "", lastActivityAt: null, plan: null, children: [] }],
    },
  ];

  beforeEach(() => {
    calls = [];
    open = [
      { id: "q1", question: "Delete the **old** bucket?", options: ["Delete it", "Keep it"], sessionId: "g1-native", createdAt: 2 },
      { id: "q2", question: "Which region?", sessionId: "c1", createdAt: 1 },
      { id: "q3", question: "Not on this team", options: ["Yes"], sessionId: "other", createdAt: 3 },
    ];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.includes("/api/ask?status=open")) return Response.json({ questions: open });
      return Response.json({});
    }) as typeof fetch;
    configureOmgTransport(createSameOriginTransport());
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("lists the team's open questions, oldest first, answerable in place", async () => {
    const opened: string[] = [];
    ui.render(
      <AskProvider>
        <SessionPlanView plan={null} team={team} send={async () => {}} onOpenMember={(id) => opened.push(id)} />
      </AskProvider>,
    );
    await ui.flushAsync();
    const needs = ui.queryAll('[data-testid="team-need"]');
    expect(needs.map((n) => n.getAttribute("data-id"))).toEqual(["q2", "q1"]);
    expect(ui.text()).toContain("Needs you · 2");
    expect(needs[1].textContent).toContain("GROUP B mover");
    expect(needs[1].textContent).toContain("Delete the old bucket?");

    // No options: the way to answer is the session that asked.
    await click(button("Open to reply"));
    expect(opened).toEqual(["c1"]);

    await click(button("Delete it"));
    const answer = calls.find((c) => c.url.endsWith("/api/ask/q1/answer"));
    expect(answer?.body).toEqual({ answer: "Delete it", via: "web" });
    expect(ui.queryAll('[data-testid="team-need"]').map((n) => n.getAttribute("data-id"))).toEqual(["q2"]);
  });

  test("the chip counts them", async () => {
    ui.render(
      <AskProvider>
        <SessionPlanChip plan={null} team={team} onClick={() => {}} />
      </AskProvider>,
    );
    await ui.flushAsync();
    expect(ui.query('[data-testid="session-plan-chip"]')!.getAttribute("aria-label")).toBe("Plan: 2 need you, 1 agent working");
  });

  test("without the questions feed the view still renders", () => {
    ui.render(<SessionPlanView plan={null} team={team} send={async () => {}} />);
    expect(ui.query('[data-testid="plan-needs"]')).toBeNull();
    expect(ui.queryAll('[data-testid="team-member"]')).toHaveLength(2);
  });
});

describe("finished members", () => {
  const live: TeamMember = { id: "c1", nativeId: null, title: "Live mover", agent: "Codex", state: "working", activity: "Copying", lastActivityAt: null, plan: null, children: [] };
  const done = (id: string): TeamMember => ({ id, nativeId: null, title: `Done ${id}`, agent: "Codex", state: "done", activity: "Moved 9 of 9", lastActivityAt: null, plan: null, children: [] });

  test("fold under 'N done' while any member is open", async () => {
    ui.render(<SessionPlanView plan={null} team={[live, done("d1"), done("d2")]} send={async () => {}} />);
    expect(ui.queryAll('[data-testid="team-member"]').map((m) => m.getAttribute("data-id"))).toEqual(["c1"]);
    expect(ui.text()).toContain("Team · 3 · 1 working");
    await click(button("2 done"));
    expect(ui.queryAll('[data-testid="team-member"]').map((m) => m.getAttribute("data-state"))).toEqual(["working", "done", "done"]);
    expect(ui.text()).toContain("Moved 9 of 9");
  });

  test("show, with 'all done', when every member is finished", () => {
    ui.render(<SessionPlanView plan={null} team={[done("d1"), done("d2")]} send={async () => {}} />);
    expect(ui.queryAll('[data-testid="team-member"]')).toHaveLength(2);
    expect(ui.text()).toContain("Team · 2 · all done");
    expect(button("2 done")).toBeNull();
  });
});

describe("status media", () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    configureOmgTransport(createSameOriginTransport());
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("each visual renders in place, in order, with its caption", async () => {
    const media = [
      { kind: "image" as const, artifactId: "a1", url: "/api/artifacts/a1", caption: "Front render", width: 800, height: 600, version: 1 },
      { kind: "video" as const, artifactId: "a2", url: "/api/artifacts/a2", version: 1 },
      { kind: "html" as const, artifactId: "panel-x-2", url: "/api/artifacts/panel-x-2", caption: "Migration graph", version: 3 },
      { kind: "model" as const, artifactId: "a4", url: "/api/artifacts/a4", caption: "Chair asset", version: 1 },
    ];
    ui.render(<SessionPlanView plan={{ source: "omg", updatedAt: 1, items: [], agents: [], status: { updatedAt: Date.now(), headline: "Assets", media } }} send={async () => {}} />);
    await ui.flushAsync();
    const figures = ui.queryAll('[data-testid="panel-media"]');
    expect(figures.map((f) => f.getAttribute("data-kind"))).toEqual(["image", "video", "html", "model"]);
    expect(figures[0].textContent).toContain("Front render");
    expect(figures[3].textContent).toContain("Chair asset");
    // The model waits for its viewer; the pane does not break meanwhile.
    expect(figures[3].textContent).toMatch(/3D model/);
  });
});
