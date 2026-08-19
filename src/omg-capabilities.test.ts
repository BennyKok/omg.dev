import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  OMG_CAPABILITIES,
  OMG_CAPABILITY_VERSION,
  OMG_MCP_INSTRUCTIONS,
  botRuntimeContract,
  omgCapabilityAccess,
  omgRuntimeContract,
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
    expect(prompt).toContain("closeSession:true");
    expect(prompt).toContain("closeSession:false");
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
      "omg_create_owned_bot / omg_update_self / omg_list_owned_bots",
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

  test("reports honest harness access", () => {
    expect(omgCapabilityAccess("aisdk")).toBe("mcp");
    expect(omgCapabilityAccess("codex-aisdk")).toBe("mcp");
    expect(omgCapabilityAccess("opencode")).toBe("mcp");
    expect(omgCapabilityAccess("grok")).toBe("mcp");
    expect(omgCapabilityAccess("cursor")).toBe("mcp");
    expect(omgCapabilityAccess("copilot")).toBe("contract-only");
    expect(omgCapabilityAccess("hermes")).toBe("contract-only");
  });
});
