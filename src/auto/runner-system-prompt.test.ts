// The auto-agent header must describe the tools the run was actually granted.
//
// The librarian is granted Bash and told to publish a docs PR every night. It
// read a header that always said "read-only", filed "blocked by read-only
// access", and the refresh stopped. These cases pin the header to the grant so
// a write-capable agent is not told it cannot write.

import { expect, test } from "bun:test";
import { systemPrompt } from "./runner.ts";
import { WATCH_AGENT_OPENING } from "./watch-agent-signature.ts";

test("read-only agent is told it has read-only tools", () => {
  const prompt = systemPrompt({});
  expect(prompt).toContain("You have read-only tools (Read, Grep, Glob, WebSearch, WebFetch)");
  expect(prompt).not.toContain("and Bash");
  expect(prompt).not.toContain("carry it out yourself");
});

test("a Bash grant is named and the agent is told to do its own writes", () => {
  const prompt = systemPrompt({ tools: ["Bash"] });
  expect(prompt).toContain("and Bash");
  expect(prompt).toContain("carry it out yourself with the granted tools");
  expect(prompt).toContain("open or merge a pull request");
});

test("read-only entries in the grant are not repeated", () => {
  const prompt = systemPrompt({ tools: ["Read", "Grep", "Bash"] });
  expect(prompt).toContain(
    "You have read-only tools (Read, Grep, Glob, WebSearch, WebFetch) and Bash.",
  );
});

test("the scheduled-run marker still opens every header", () => {
  expect(systemPrompt({}).startsWith(WATCH_AGENT_OPENING)).toBe(true);
  expect(systemPrompt({ tools: ["Bash"] }).startsWith(WATCH_AGENT_OPENING)).toBe(true);
});
