import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  OMG_CAPABILITIES,
  OMG_CAPABILITY_VERSION,
  OMG_MCP_INSTRUCTIONS,
  botRuntimeContract,
  omgCapabilityAccess,
  omgRuntimeContract,
  omgUserInstructionsBlock,
  sessionTitleFromPrompt,
  stripOmgRuntimeContract,
  withOmgRuntimeContract,
} from "./omg-capabilities.ts";

describe("omg.dev runtime capabilities", () => {
  test("injects the product workflow into a normal root task", () => {
    const prompt = withOmgRuntimeContract("Fix the mobile navigation")!;
    expect(prompt).toContain(`capability version ${OMG_CAPABILITY_VERSION}`);
    expect(prompt).not.toContain("omg_output");
    expect(prompt).toContain("omg_input");
    expect(prompt).not.toContain("advisor");
    expect(prompt).toContain("normal assistant messages");
    expect(prompt).toContain("omg_display_image");
    expect(prompt).toContain("omg_display_video");
    // Regression guard: 83ea6d3 split omg_output into native replies plus
    // omg_ship and dropped the shipping bullet entirely, so agents stopped
    // shipping for two days while CI stayed green. Shipping is how finished
    // work reaches the human — it must never fall out of the contract again.
    expect(prompt).toContain("omg_ship");
    // Publishing is no longer a lifecycle event. The contract must not tell
    // agents to close a session by shipping it.
    expect(prompt).not.toContain("closeSession");
    expect(prompt).toContain("Publishing does not close the session");
    expect(prompt).toContain("Shipped is not deployed");
    // Landing is a local self-repo concern. The ship endpoint owns that gate
    // and returns its exact recovery command only to an affected LFG session.
    // Putting it in this global prompt leaks LFG release plumbing into every
    // unrelated application session and invites agents to run it in app repos.
    expect(prompt).not.toContain("scripts/land-session.sh");
    expect(prompt).not.toContain("uncommitted, unmerged, or not deployed");
    expect(prompt).toContain("omg_find_sessions");
    expect(prompt).toContain("omg_close_session");
    expect(prompt).toEndWith("=== USER TASK ===\nFix the mobile navigation");
  });

  test("brands every agent-facing surface as omg.dev, never bare OMG", () => {
    // The company is omg.dev. This envelope is the most-read piece of copy the
    // product has — every managed session opens with it — so the brand has to
    // be spelled the same way here as on the site, in the tool catalog, and in
    // the transcript header the UI labels it with.
    const contract = omgRuntimeContract();
    expect(contract).toStartWith("=== omg.dev RUNTIME CONTRACT");
    expect(contract).toContain("=== END omg.dev RUNTIME CONTRACT ===");
    expect(contract).toContain("omg.dev-managed coding agent");
    for (const copy of [contract, OMG_MCP_INSTRUCTIONS]) {
      expect(copy).not.toMatch(/\bOMG\b/);
      expect(copy).not.toMatch(/\bLFG\b/);
    }
  });

  test("keeps the runtime contract compact", () => {
    // Headroom is deliberate: a line budget the contract already sits flush
    // against turns every future edit into a choice about which bullet to
    // delete, which is how shipping was lost in the first place.
    expect(omgRuntimeContract().split("\n").length).toBeLessThanOrEqual(12);
    expect(omgRuntimeContract().length).toBeLessThan(2_400);
  });

  test("does not duplicate the contract", () => {
    const once = withOmgRuntimeContract("Do the work")!;
    expect(withOmgRuntimeContract(once)).toBe(once);
  });

  test("keeps bot conversations persistent and outside the ship workflow", () => {
    const contract = botRuntimeContract("Scout", "Be concise and curious.");
    expect(contract).toContain(`capability version ${OMG_CAPABILITY_VERSION}`);
    expect(contract).toContain("You are Scout");
    expect(contract).toContain("Be concise and curious.");
    expect(contract).toContain("normal assistant messages");
    expect(contract).toContain("Do not use `omg_ship`");
    expect(contract).toContain("Do not close this session");
    expect(withOmgRuntimeContract(contract)).toBe(contract);
  });

  // A bot runs on the ordinary coding-agent harness — same tools, same skills,
  // same box — so identity alone left it behaving like a task session. Asked
  // "how is our bot system doing?", one spent four minutes on 25+ tool calls,
  // ran an unrelated status skill, SSH'd into two production hosts and read the
  // customer database before saying anything. These are the rules that make a
  // chat turn a chat turn; each one is load-bearing, so each one is asserted.
  test("gives a bot the shape of a conversational turn, not an investigation", () => {
    const contract = botRuntimeContract("Scout", "Be concise and curious.");
    // Answering is the deliverable, and it happens in the turn the message came in.
    expect(contract).toContain("same turn");
    // Chat-shaped, not report-shaped.
    expect(contract).toContain("Talk like a person in a chat");
    // Long work is handed off to the background, and the turn ends there —
    // waiting on the child is the same wall of silence, one level down.
    expect(contract).toContain("omg_create_subagent");
    expect(contract).toContain("Do not wait for it");
    // The child's report is the bot's source, not its output: the human reads a
    // sentence from the bot, not a pasted `[subagent complete]` block.
    expect(contract).toContain("in your own words");
    // The blast radius the production-database dig walked straight out of.
    expect(contract).toContain("Stay inside your own repo");
    expect(contract).toContain("production hosts");
    // The MCP server tells every session to ship; a bot has to be told that
    // instruction is not addressed to it, or the two contradict.
    expect(contract).toContain("do not apply here");
  });

  // Benny's direct feedback: replies read as essays (multi-paragraph, headed,
  // bolded lead-ins, hedged) instead of chat. Each rule below is asserted
  // because each one is a habit he named explicitly.
  test("gives a bot chat-shaped reply style: short, beat-by-beat, confident", () => {
    const contract = botRuntimeContract("Scout", "Be concise and curious.");
    // Length is earned by the question, not by everything the bot knows.
    expect(contract).toContain("Length is earned by the question");
    // The multi-bubble mechanism is real: sessions.ts splits each content
    // block of an assistant turn (text around a tool call) into its own
    // message, and chat-render-items.ts never coalesces separate text
    // messages back into one bubble — the contract names what already
    // happens instead of inventing a tool that doesn't exist.
    expect(contract).toContain("becomes its own bubble");
    expect(contract).toContain("never call a tool just to force a break");
    // Confidence: no hedging, no both-sides framing, no performed uncertainty.
    expect(contract).toContain("Say what you think, once, plainly");
    expect(contract).toContain("No hedging");
    // The concrete habits Benny named to cut.
    expect(contract).toContain("a bolded label leading every paragraph");
    expect(contract).toContain("markdown headings in a chat reply");
    expect(contract).toContain("a bulleted recap of what you just did");
    expect(contract).toContain("restating the question before you answer it");
    expect(contract).toContain("want me to do X or Y?");
  });

  // Two envelopes reach a bot: this contract and the MCP server's instructions,
  // which used to order "ship or stay invisible" at every session indiscriminately.
  test("the MCP instructions scope shipping to task sessions", () => {
    expect(OMG_MCP_INSTRUCTIONS).toContain("In a task session, publish every verified result");
    expect(OMG_MCP_INSTRUCTIONS).toContain("never ships, and never closes");
  });

  // The first "Hey Scout!" went unanswered because the launch envelope told the
  // bot not to reply to its setup message while the greeting was bundled into
  // that same turn. Silence is only correct when nothing is attached.
  test("a bundled first message is answered, not treated as setup to ignore", () => {
    const withMessage = botRuntimeContract("Scout", "Be concise.");
    expect(withMessage).toContain("Reply to it now");
    expect(withMessage).not.toContain("Say nothing");

    const empty = botRuntimeContract("Scout", "Be concise.", { awaitingFirstMessage: true });
    expect(empty).toContain("Say nothing");
    expect(empty).not.toContain("Reply to it now");
  });

  test("does not turn an empty composer into an autonomous turn", () => {
    expect(withOmgRuntimeContract(undefined)).toBeUndefined();
    expect(withOmgRuntimeContract("   ")).toBe("   ");
  });

  test("publishes a bootstrap entry for every promoted workflow", () => {
    expect(OMG_CAPABILITIES.map((item) => item.tool)).toEqual([
      "omg_create_owned_bot / omg_update_self / omg_list_owned_bots / omg_send_message_to_peer",
      "omg_ship",
      "omg_display_image / omg_display_video",
      "omg_input",
      "omg_find_sessions",
      "omg_close_session",
      "omg_create_subagent / omg_delegate_*",
      "omg_list_auto_agents / omg_save_auto_agent / omg_run_auto_agent",
    ]);
  });

  test("keeps visual display tools without registering omg_output", () => {
    const mcpSource = readFileSync(new URL("./commands/mcp.ts", import.meta.url), "utf8");
    const serveSource = readFileSync(new URL("./commands/serve.ts", import.meta.url), "utf8");
    expect(mcpSource).not.toContain('registerTool(\n    "omg_output"');
    expect(mcpSource).toContain('registerTool(\n    "omg_display_image"');
    expect(mcpSource).toContain('registerTool(\n    "omg_display_video"');
    expect(mcpSource).toContain('registerTool(\n    "omg_ship"');
    expect(mcpSource).not.toContain('registerTool(\n    "omg_ask_question"');
    expect(mcpSource).not.toContain('"advisor"');
    expect(serveSource).not.toContain('/api/voice/consult');
    expect(serveSource).not.toContain('ADVISOR_BRIEF');
  });

  // Bot-owned automations (docs/bot-owned-automations-plan.md §4): a bot needs
  // to know it can self-schedule, what the fired nudge looks like so it
  // doesn't mistake it for a human message, and that the cap/frequency limits
  // are real and enforced — not just self-service tools with no guidance.
  test("gives a bot the self-scheduling tools, its own live cap, and the nudge shape", () => {
    const contract = botRuntimeContract("Scout", "Be concise.", { maxBotSchedules: 3 });
    expect(contract).toContain("omg_schedule_routine");
    expect(contract).toContain("omg_list_my_routines");
    expect(contract).toContain("omg_unschedule_routine");
    // The number in the prompt must be the live setting, not a hardcoded guess.
    expect(contract).toContain("at most 3 at a time");
    expect(contract).toContain("[Scheduled routine: <name>]");
    expect(contract).toContain("frequency ceiling");
  });

  test("falls back to the default cap when the live setting isn't threaded through", () => {
    const contract = botRuntimeContract("Scout", "Be concise.");
    expect(contract).toContain("at most 5 at a time");
  });

  test("does not duplicate the bot contract either", () => {
    const contract = botRuntimeContract("Scout", "Be concise.", { maxBotSchedules: 5 });
    expect(withOmgRuntimeContract(contract)).toBe(contract);
  });

  test("reports honest harness access", () => {
    expect(omgCapabilityAccess("aisdk")).toBe("mcp");
    expect(omgCapabilityAccess("codex-aisdk")).toBe("mcp");
    expect(omgCapabilityAccess("opencode")).toBe("mcp");
    expect(omgCapabilityAccess("grok")).toBe("mcp");
    expect(omgCapabilityAccess("cursor")).toBe("mcp");
    expect(omgCapabilityAccess("copilot")).toBe("contract-only");
    expect(omgCapabilityAccess("hermes")).toBe("contract-only");
    // "contract-only" is a promise, not a label: it is surfaced to the Coding
    // agents page (coding-agents.ts) as "this agent hears from omg.dev through
    // the contract rather than MCP". deepseek claimed it while tmux.ts stripped
    // the contract from its prompt, so it actually heard nothing. The launch
    // side is pinned in src/launch-custom-instructions.test.ts.
    expect(omgCapabilityAccess("deepseek")).toBe("contract-only");
    expect(omgCapabilityAccess("pi")).toBe("contract-only");
  });
});

// The owner's standing instructions (GlobalSettings.customInstructions) ride in
// the envelope's preamble region, between the contract's END line and USER
// TASK. Two things have to stay true: the agent reads them, and no display
// surface does.
describe("user standing instructions", () => {
  const RULES = "Always run the tests before you say you are done.";

  test("appends the owner's instructions after the contract and before the task", () => {
    const prompt = withOmgRuntimeContract("Fix the mobile navigation", RULES)!;
    expect(prompt).toContain(RULES);
    expect(prompt).toContain("=== USER STANDING INSTRUCTIONS ===");
    expect(prompt.indexOf("=== END omg.dev RUNTIME CONTRACT ===")).toBeLessThan(
      prompt.indexOf("=== USER STANDING INSTRUCTIONS ==="),
    );
    expect(prompt.indexOf("=== USER STANDING INSTRUCTIONS ===")).toBeLessThan(
      prompt.indexOf("=== USER TASK ==="),
    );
    // Ordered after the task marker it would read as part of the ask.
    expect(prompt.indexOf(RULES)).toBeLessThan(prompt.indexOf("Fix the mobile navigation"));
  });

  test("says repository instructions win, so a standing rule cannot override AGENTS.md", () => {
    const prompt = withOmgRuntimeContract("Fix it", RULES)!;
    expect(prompt).toContain("AGENTS.md");
  });

  test("adds nothing at all when unset, so today's envelope is byte-identical", () => {
    const before = withOmgRuntimeContract("Fix the mobile navigation")!;
    expect(withOmgRuntimeContract("Fix the mobile navigation", "")).toBe(before);
    expect(withOmgRuntimeContract("Fix the mobile navigation", "   \n ")).toBe(before);
    expect(before).not.toContain("=== USER STANDING INSTRUCTIONS ===");
  });

  test("is stripped from titles — the card shows the ask, not the standing rules", () => {
    const prompt = withOmgRuntimeContract("Fix the mobile navigation", RULES)!;
    expect(stripOmgRuntimeContract(prompt)).toBe("Fix the mobile navigation");
    expect(sessionTitleFromPrompt(prompt)).toBe("Fix the mobile navigation");
  });

  test("is stripped from a subagent prompt too, which carries two envelopes", () => {
    const delegated = "=== omg.dev SUBAGENT OPERATING CONTRACT ===\nrules\n=== USER TASK ===\nShip the fix";
    const prompt = withOmgRuntimeContract(delegated, RULES)!;
    expect(prompt).toContain(RULES);
    expect(stripOmgRuntimeContract(prompt)).toBe("Ship the fix");
  });

  test("an already-wrapped prompt is not re-wrapped, so a resume gains no second copy", () => {
    const prompt = withOmgRuntimeContract("Fix the mobile navigation", RULES)!;
    expect(withOmgRuntimeContract(prompt, RULES)).toBe(prompt);
    expect(prompt.split("=== USER STANDING INSTRUCTIONS ===").length - 1).toBe(1);
  });

  test("an empty prompt stays empty — a launch with no ask injects nothing", () => {
    expect(withOmgRuntimeContract(undefined, RULES)).toBeUndefined();
    expect(withOmgRuntimeContract("", RULES)).toBe("");
  });

  test("the bot envelope is still left alone", () => {
    const contract = botRuntimeContract("Scout", "Be concise.", { maxBotSchedules: 5 });
    expect(withOmgRuntimeContract(contract, RULES)).toBe(contract);
  });

  test("omgUserInstructionsBlock is empty for empty input", () => {
    expect(omgUserInstructionsBlock("")).toBe("");
    expect(omgUserInstructionsBlock(undefined)).toBe("");
    expect(omgUserInstructionsBlock("  ")).toBe("");
    expect(omgUserInstructionsBlock(RULES)).toContain(RULES);
  });
});
