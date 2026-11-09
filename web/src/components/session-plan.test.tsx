import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { mount, type Mounted } from "../test-support/render";
import type { OmgSessionPlan } from "@omg-dev/protocol";

const { SessionPlanChip, SessionPlanView, planActionMessage, planProgress, useSessionPlan } = await import("./session-plan");
import type { TeamMember } from "@/lib/session-team";

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
      title: "APPS OWNER: move every app",
      agent: "Codex",
      state: "working",
      activity: "Running a command",
      lastActivityAt: now - 120_000,
      plan: { done: 2, total: 5, current: "Move games", running: [{ title: "Check parity", detail: "Using Bash" }], finished: 1 },
      children: [
        { id: "g1", title: "GROUP B mover", agent: "Codex", state: "blocked", activity: "Out of credits", lastActivityAt: now, plan: null, children: [] },
      ],
    },
    { id: "c2", title: "Storage cleanup", agent: "Claude", state: "idle", activity: "Waiting for your OK", lastActivityAt: now - 3 * 3600_000, plan: null, children: [] },
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
    expect(members[0].textContent).toContain("Codex · 2m");
    expect(ui.queryAll('[data-testid="team-subagent"]')[0].textContent).toContain("Check parity · Using Bash");
    expect(members[1].textContent).toContain("Out of credits");
    expect(members[2].textContent).toContain("Claude · 3h");
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
