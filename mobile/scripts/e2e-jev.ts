/**
 * The Jev-driven e2e runner: a plan of goals, judged step by step.
 *
 * ── Why a plan and not a flow ─────────────────────────────────────────────
 *
 * A Maestro flow is a fixed script: `tapOn: "Send sign-in code"`, then wait
 * up to 120 seconds for one exact string. It breaks on a copy change, and on
 * a real failure it does not break at all: it sits out the whole timeout in
 * front of an error screen before it says anything. Both cost a rebuild and a
 * rerun, at ten minutes each.
 *
 * A plan says what each step is FOR. For every step the runner reads the
 * screen (the accessibility tree, text only), asks Jev three things in one
 * call, and acts on the answers:
 *
 *   done     is the step's goal already on screen?      -> next step
 *   blocked  is this an error, a dead end, a challenge?  -> fail NOW, by name
 *   tap      which element moves toward the goal?        -> tap it, look again
 *
 * Exact facts stay in code. A step's `expect` strings must be present in the
 * tree and its `forbid` strings absent, checked deterministically, because a
 * feature proof is a claim about what the screen shows and not a vibe. Jev
 * only decides readiness and navigation, the part a fixed selector cannot.
 *
 * ── Speed ─────────────────────────────────────────────────────────────────
 *
 * One `maestro mcp` process for the run (no JVM restart per tap), one Jev
 * call per look (about half a second), and no fixed waits anywhere: a step
 * ends the moment its screen is there, and a failure ends the run the moment
 * the screen says so. `--record` composes the Maestro-style video: device on
 * the left, the step list ticking on the right, from the runner's own log.
 *
 * Plans live in `e2e/<name>.plan.json`; see `e2e/onboarding.plan.json`.
 */
import { join } from "node:path";

import { judge } from "./jev";
import { openMaestroMcp, type McpSession } from "./maestro-mcp";

export type Step = {
  name: string;
  /** What this step is for, in plain words. Jev uses it to pick the tap. */
  goal: string;
  /** What the screen shows once the step is done. Jev judges this. */
  done: string;
  /** Strings that MUST be in the tree once done. Exact, case-insensitive. */
  expect?: string[];
  /** Strings that must NOT be in the tree once done. */
  forbid?: string[];
  /** An element with this label must report selected/checked once done. */
  selected?: string;
  /** Text to type after tapping the target (or into the focused field). */
  type?: string;
  /** The field is already focused; type without a tap. */
  focused?: boolean;
  /**
   * Whether the typed text appears on screen. Default true.
   *
   * Set false for a field that is not meant to show what it receives — the
   * Computer viewer forwards every key to a remote desktop and keeps nothing
   * — so the runner does not fail a correct run on a read-back that can never
   * match. Nothing is erased first either: there is no visible value to clear,
   * and the backspaces would go to the desktop.
   */
  echo?: boolean;
  /** Type the sign-in code the runner reads from Gmail. */
  otp?: boolean;
  /** Press and hold the picked element instead of tapping it (context menus). */
  longPress?: boolean;
  /** Wall-clock ceiling for this step. Default 60s; provisioning gets more. */
  timeoutMs?: number;
  /**
   * A link to open before the first look (Maestro `openLink`). An https link
   * opens Safari, which is how a plan reaches another app's share sheet.
   */
  open?: string;
  /**
   * A screen point to tap once before the first look, as Maestro's "x%,y%".
   * For system UI whose tree reports frames in its own space: the iOS share
   * sheet lists its app icons relative to the sheet, so a tap on the reported
   * centre lands above the sheet and closes it.
   */
  tapAt?: string;
};

export type Plan = {
  appId: string;
  launch?: { clearState?: boolean };
  steps: Step[];
};

type Candidate = {
  i: number;
  label: string;
  id: string;
  x: number;
  y: number;
  hint?: string;
  focused?: boolean;
  selected?: boolean;
};

/**
 * The tree as a short list of things a person could tap or read.
 *
 * A label sits on the OUTER node of a control (the button), and the same
 * text often repeats on an inner text node. The outer one is the tap target,
 * so a node is listed the first time its label appears on the way down, and
 * descendants carrying the same label are folded into it.
 */
function candidates(tree: any): { list: Candidate[]; text: string[] } {
  const list: Candidate[] = [];
  const text: string[] = [];
  const seen = new Set<string>();
  const parseBounds = (b: unknown): [number, number] | null => {
    if (typeof b !== "string") return null;
    const m = b.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
    if (!m) return null;
    return [(Number(m[1]) + Number(m[3])) / 2, (Number(m[2]) + Number(m[4])) / 2];
  };
  const walk = (n: any, inherited: string) => {
    if (Array.isArray(n)) {
      for (const child of n) walk(child, inherited);
      return;
    }
    if (!n || typeof n !== "object") return;
    // The keyboard is a hundred one-letter buttons. Never a tap target here
    // (typing goes through inputText), and it drowns the real candidates.
    if (/keyboard|inputView/i.test(String(n.rid || "")) || /^keyboard$/i.test(String(n.a11y || ""))) return;
    // iOS puts the meaningful name in a11y and a role ("radio button") in
    // txt, so a11y wins for the label. Every string is still searchable.
    // An empty text field has only its placeholder, which arrives as hint.
    const label = String(n.a11y || n.txt || n.hint || "").trim();
    const id = String(n.rid ?? "").trim();
    for (const v of [n.txt, n.a11y, n.val, n.hint]) {
      const t = String(v ?? "").trim();
      if (t && t !== inherited) text.push(t);
    }
    const c = parseBounds(n.b);
    if ((label || id) && c && n.enabled !== false && !(label && label === inherited)) {
      const key = `${label}|${id}`;
      if (!seen.has(key)) {
        seen.add(key);
        list.push({
          i: list.length,
          label,
          id,
          x: Math.round(c[0]),
          y: Math.round(c[1]),
          ...(n.hint ? { hint: String(n.hint) } : {}),
          ...(n.focused ? { focused: true } : {}),
          // "Is it picked" is state a label cannot carry. iOS reports it as
          // selected or checked; Jev needs it to know a choice step is done.
          ...(n.selected || n.checked ? { selected: true } : {}),
        });
      }
    }
    for (const child of n.c ?? []) walk(child, label || inherited);
  };
  walk(tree?.elements ?? tree, "");
  return { list, text };
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const hasText = (all: string[], want: string) => all.some((t) => norm(t).includes(norm(want)));

/**
 * Type, read back, retry. Maestro's iOS typing occasionally doubles a
 * character ("gmail.comv" for an alias ending in "v", seen 2026-09-18), and
 * a wrong email is a silent dead end two steps later. `expected` null skips
 * the read-back for fields that mask their value.
 */
async function typeVerified(
  mcp: McpSession,
  header: string,
  value: string,
  expected: string | null,
  log: (l: string) => void,
  erase = true,
): Promise<boolean> {
  const yamlText = value.replace(/"/g, '\\"');
  // A plan may reopen a persisted draft. Replace its field contents rather
  // than appending the same test text on every rerun.
  if (erase) await mcp.run(`${header}- eraseText\n`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await mcp.run(`${header}- inputText: "${yamlText}"\n`);
    if (!r.ok) log(`  inputText failed: ${r.text.slice(0, 200)}`);
    if (!expected) return r.ok;
    const { text } = candidates(await mcp.inspect());
    if (text.some((t) => t === expected)) {
      // The keyboard covers the buttons below the field and eats taps.
      await mcp.run(`${header}- hideKeyboard\n`);
      return true;
    }
    const got = text.find((t) => t.includes(expected.slice(0, 8))) ?? "?";
    log(`  typed wrong ("${got}"), retry ${attempt}/3`);
    await mcp.run(`${header}- eraseText: ${value.length + 8}\n`);
  }
  return false;
}

export type StepResult = { name: string; status: "pass" | "fail"; at: number; detail?: string; looks: number };

export async function runPlan(opts: {
  host: string;
  remoteEnv: string;
  udid: string;
  plan: Plan;
  vars: Record<string, string>;
  readOtp?: () => Promise<string>;
  /** Called at each step boundary, for the step log the video is drawn from. */
  onStep?: (r: StepResult) => void;
  log?: (line: string) => void;
}): Promise<{ ok: boolean; steps: StepResult[]; mcpStartMs: number }> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const t0 = Date.now();
  let mcp: McpSession = await openMaestroMcp(opts.host, opts.remoteEnv, opts.udid);
  const mcpStartMs = Date.now() - t0;
  log(`maestro mcp ready in ${(mcpStartMs / 1000).toFixed(1)}s`);
  /**
   * One dropped call is not a verdict. The Mac is a laptop on a tailnet; on
   * 2026-09-18 it went offline for minutes in the middle of a run and the
   * pending inspect timed out. Reopen the session and look again, once.
   * A second failure in a row is reported as the step's failure, by name.
   */
  const look = async (): Promise<any> => {
    try {
      return await mcp.inspect();
    } catch (e) {
      log(`  inspect failed (${e instanceof Error ? e.message : e}); reopening maestro mcp`);
      mcp.close();
      mcp = await openMaestroMcp(opts.host, opts.remoteEnv, opts.udid);
      return await mcp.inspect();
    }
  };
  const header = `appId: ${opts.plan.appId}\n---\n`;
  const results: StepResult[] = [];
  const sub = (s: string) => s.replace(/\$\{(\w+)\}/g, (_, k) => opts.vars[k] ?? "");

  try {
    if (opts.plan.launch) {
      const r = await mcp.run(`${header}- launchApp:\n    clearState: ${opts.plan.launch.clearState ? "true" : "false"}\n`);
      if (!r.ok) throw new Error(`launchApp failed: ${r.text.slice(0, 300)}`);
    }

    for (const step of opts.plan.steps) {
      const started = Date.now();
      const ceiling = started + (step.timeoutMs ?? 60_000);
      let looks = 0;
      let typed = false;
      let lastTap = "";
      let mismatchLooks = 0;
      let blockedLooks = 0;
      let verdict: StepResult | null = null;
      if (step.open) {
        const r = await mcp.run(`${header}- openLink: ${JSON.stringify(sub(step.open))}\n`);
        if (!r.ok) verdict = { name: step.name, status: "fail", at: Date.now(), looks, detail: `openLink failed: ${r.text.slice(0, 300)}` };
      }
      if (!verdict && step.tapAt) {
        const r = await mcp.run(`${header}- tapOn:\n    point: ${JSON.stringify(step.tapAt)}\n`);
        if (!r.ok) verdict = { name: step.name, status: "fail", at: Date.now(), looks, detail: `tap at ${step.tapAt} failed: ${r.text.slice(0, 300)}` };
      }

      while (!verdict) {
        let tree: any;
        try {
          tree = await look();
        } catch (e) {
          verdict = { name: step.name, status: "fail", at: Date.now(), looks, detail: `device unreachable: ${e instanceof Error ? e.message : e}` };
          break;
        }
        looks++;
        const { list, text } = candidates(tree);
        const exact = (step.expect ?? []).filter((w) => !hasText(text, w));
        const forbidden = (step.forbid ?? []).filter((w) => hasText(text, w));
        // iOS appends the state to the label ("Explain an error, selected").
        const unselected =
          step.selected && !list.some((c) => c.selected && norm(c.label).startsWith(norm(step.selected!)));

        const criteria: Record<string, string | null> = { none: "nothing on screen fits the goal; wait" };
        for (const c of list) criteria[String(c.i)] = `${c.label || "(no label)"}${c.id ? ` [id ${c.id}]` : ""}${c.hint ? ` (${c.hint})` : ""}`;

        const ask = await judge(
          {
            goal: step.goal,
            done_when: step.done,
            screen: list.map((c) => ({
              i: c.i,
              label: c.label,
              id: c.id || undefined,
              focused: c.focused,
              selected: c.selected,
            })),
            already_typed: typed,
          },
          {
            done: {
              type: "noul",
              instructions: "Judging only from the `screen` labels, is the state described by `done_when` already on screen?",
              criteria: { true: "the screen matches done_when", false: "the app is still on an earlier or different screen" },
            },
            blocked: {
              type: "noul",
              instructions:
                "Does the screen contain an explicit error or failure message, a 'confirm you are a person' challenge, a rate-limit notice, or a development-tool menu covering the app? Loading, waiting and ordinary screens are NOT blocked.",
              criteria: {
                true: "a visible label states an error, a challenge, or a limit",
                false: "no label on screen states a problem",
              },
            },
            tap: {
              type: "choice",
              instructions:
                "Which element should be tapped next to move toward `goal`? Pick the field to type into when `goal` involves entering text and nothing was typed yet.",
              criteria,
            },
          },
        );
        const done = (ask.done as any).noul as number;
        const blocked = (ask.blocked as any).noul as number;
        const pick = ask.tap as { choice: string; confidence: number };
        const elapsed = ((Date.now() - started) / 1000).toFixed(1);
        log(`  [${step.name}] look ${looks} ${elapsed}s: done=${done.toFixed(2)} blocked=${blocked.toFixed(2)} tap=${pick.choice}(${pick.confidence.toFixed(2)}) jev=${ask.ms}ms els=${list.length}`);

        // The exact strings are the proof. When a step names them and they
        // are all there, Jev only has to agree the screen is plausible; when a
        // step has none, Jev's judgment carries the whole decision.
        // With `expect` strings, the facts ARE the verdict: every listed
        // string on screen and no forbidden one is a pass, whatever Jev
        // thinks of the prose (it rated a finished Working screen 0.1 on
        // 2026-09-18 because `done` described an absence). Without them,
        // Jev's judgment carries the step.
        const factsHold = exact.length === 0 && forbidden.length === 0 && !unselected;
        const settled = step.expect?.length || step.selected ? factsHold : done >= 0.7 && factsHold;
        if (settled && !step.type && !step.otp) {
          verdict = { name: step.name, status: "pass", at: Date.now(), looks };
          break;
        }
        // A typing step is done when the text is in the field; that is a fact
        // the read-back already established, so Jev is not asked.
        if ((step.type || step.otp) && typed && factsHold) {
          verdict = { name: step.name, status: "pass", at: Date.now(), looks };
          break;
        }
        // Two looks in a row: a screen mid-transition can read as broken.
        blockedLooks = blocked >= 0.85 ? blockedLooks + 1 : 0;
        if (blockedLooks >= 2) {
          verdict = {
            name: step.name,
            status: "fail",
            at: Date.now(),
            looks,
            detail: `blocked (${blocked.toFixed(2)}): ${text.join(" | ")}`,
          };
          break;
        }
        // Three looks, not one: a selection or a label can lag the tap by a
        // frame, and one stale read must not turn a good run red.
        mismatchLooks = done >= 0.7 && !factsHold ? mismatchLooks + 1 : 0;
        if (mismatchLooks >= 3) {
          // Jev says the screen is here; the exact facts disagree. That is a
          // feature regression, and the run should say which string.
          verdict = {
            name: step.name,
            status: "fail",
            at: Date.now(),
            looks,
            detail: `screen reached but ${exact
              .map((w) => `missing "${w}"`)
              .concat(forbidden.map((w) => `has "${w}"`), unselected ? [`"${step.selected}" not selected`] : [])
              .join(", ")}`,
          };
          break;
        }
        if (Date.now() > ceiling) {
          verdict = { name: step.name, status: "fail", at: Date.now(), looks, detail: `timed out; screen: ${text.join(" | ")}` };
          break;
        }

        // Act.
        if ((step.type || step.otp) && !typed && (step.focused || pick.choice !== "none")) {
          if (!step.focused) {
            const c = list[Number(pick.choice)];
            if (!c) continue;
            const r = await mcp.run(`${header}- tapOn:\n    point: "${c.x},${c.y}"\n`);
            if (!r.ok) log(`  tap failed: ${r.text.slice(0, 200)}`);
          }
          const value = step.otp ? await opts.readOtp!() : sub(step.type!);
          const echoes = !step.otp && step.echo !== false;
          typed = await typeVerified(mcp, header, value, echoes ? value : null, log, echoes);
          if (!typed) {
            verdict = { name: step.name, status: "fail", at: Date.now(), looks, detail: `could not type "${value}" correctly after 3 tries` };
            break;
          }
          continue;
        }
        if (pick.choice !== "none" && pick.confidence >= 0.4) {
          const c = list[Number(pick.choice)];
          if (!c) continue;
          const key = `${c.label}@${c.x},${c.y}`;
          // Do not hammer the same element while the app is transitioning.
          if (key === lastTap) {
            await Bun.sleep(1000);
            lastTap = "";
            continue;
          }
          lastTap = key;
          const verb = step.longPress ? "longPressOn" : "tapOn";
          log(`  ${step.longPress ? "long press" : "tap"} "${c.label || c.id}" @ ${c.x},${c.y}`);
          const r = await mcp.run(`${header}- ${verb}:\n    point: "${c.x},${c.y}"\n`);
          if (!r.ok) log(`  tap failed: ${r.text.slice(0, 200)}`);
          continue;
        }
        await Bun.sleep(1000);
      }

      results.push(verdict);
      opts.onStep?.(verdict);
      log(`${verdict.status === "pass" ? "✓" : "✗"} ${step.name} (${((verdict.at - started) / 1000).toFixed(1)}s, ${verdict.looks} looks)${verdict.detail ? `: ${verdict.detail}` : ""}`);
      if (verdict.status === "fail") break;
    }
  } finally {
    mcp.close();
  }
  const planned = opts.plan.steps.length;
  return { ok: results.length === planned && results.every((r) => r.status === "pass"), steps: results, mcpStartMs };
}

/**
 * The Maestro-style recording: device on the left, the step list on the
 * right, each line ticking green (or red) at the moment the runner decided.
 * Composed here with ffmpeg from the plain device capture and the step log,
 * because `maestro record` only renders a static flow.
 */
export async function composeStepVideo(opts: {
  capture: string;
  out: string;
  recordingStartedAt: number;
  steps: { name: string; status: "pass" | "fail" | "todo"; at?: number }[];
  title: string;
}): Promise<boolean> {
  const font = process.env.OMG_E2E_FONT ?? "/usr/share/fonts/truetype/freefont/FreeSans.ttf";
  const H = 1080;
  const panel = 720;
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\u2019").replace(/:/g, "\\:").replace(/%/g, "\\%");
  const draws: string[] = [];
  draws.push(`drawtext=fontfile=${font}:text='${esc(opts.title)}':x=w-${panel}+40:y=48:fontsize=30:fontcolor=white`);
  opts.steps.forEach((s, i) => {
    const y = 130 + i * 48;
    const x = `w-${panel}+40`;
    draws.push(`drawtext=fontfile=${font}:text='\u25CB  ${esc(s.name)}':x=${x}:y=${y}:fontsize=26:fontcolor=0x8a8a8a`);
    if (s.at && s.status !== "todo") {
      const t = Math.max(0, (s.at - opts.recordingStartedAt) / 1000).toFixed(2);
      const mark = s.status === "pass" ? "\u2713" : "\u2717";
      const color = s.status === "pass" ? "0x3ddc84" : "0xff5c5c";
      draws.push(
        `drawtext=fontfile=${font}:text='${mark}  ${esc(s.name)}':x=${x}:y=${y}:fontsize=26:fontcolor=${color}:box=1:boxcolor=0x141414:boxborderw=6:enable='gte(t\\,${t})'`,
      );
    }
  });
  const filter = `[0:v]scale=-2:${H},pad=iw+${panel}:${H}:0:0:color=0x141414,${draws.join(",")}[v]`;
  const p = Bun.spawn(
    ["ffmpeg", "-y", "-loglevel", "error", "-i", opts.capture, "-filter_complex", filter, "-map", "[v]", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", opts.out],
    { stdout: "inherit", stderr: "inherit" },
  );
  return (await p.exited) === 0;
}

export async function loadPlan(dir: string, name: string): Promise<Plan> {
  const file = Bun.file(join(dir, `${name}.plan.json`));
  if (!(await file.exists())) throw new Error(`No plan e2e/${name}.plan.json`);
  return (await file.json()) as Plan;
}
