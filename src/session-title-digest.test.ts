import { describe, expect, test } from "bun:test";
import {
  buildSessionTitleDigest,
  DIGEST_FIRST_USER_MAX,
  DIGEST_LAST_ASSISTANT_MAX,
} from "./session-title-digest.ts";
import { buildContinueSessionPrompt, CONTINUE_PROMPT_DEFAULT_EXTRA } from "./session-continue-prompt.ts";

describe("what an automatic title is generated from", () => {
  test("labels the three turns so the model can tell them apart", () => {
    expect(
      buildSessionTitleDigest({
        firstUser: "Fix the composer height",
        lastUser: "Now ship it",
        lastAssistant: "Landed on main and restarted the service",
      }),
    ).toBe(
      [
        "First request: Fix the composer height",
        "Latest request: Now ship it",
        "Latest answer: Landed on main and restarted the service",
      ].join("\n"),
    );
  });

  test("a session with one turn spends no budget repeating it", () => {
    const only = "Fix the composer height";
    expect(buildSessionTitleDigest({ firstUser: only, lastUser: only, lastAssistant: null })).toBe(
      `First request: ${only}`,
    );
  });

  test("nothing titleable yields an empty string, not a prompt", () => {
    expect(buildSessionTitleDigest({})).toBe("");
    expect(buildSessionTitleDigest({ firstUser: "   ", lastUser: null, lastAssistant: null })).toBe("");
  });

  // The defect this digest exists for. A continued session's first user turn
  // is the continue envelope, so titling it produced "Review auto-rename
  // feature status" — the title of the template, not of the work.
  test("a continued session is titled by what the human actually asked for", () => {
    const digest = buildSessionTitleDigest({
      firstUser: buildContinueSessionPrompt({
        sourceId: "4217a92d-234c-4d1a-9b4d-63ac8f057b8d",
        title: "We did worked on an auto rename features",
        cwd: "/home/dev/lfg-worktrees/lfg-7dc946",
        transcript: "/home/dev/transcript.jsonl",
        extra: "Make the rename button configurable",
      }),
    });
    expect(digest).toBe("First request: Make the rename button configurable");
    expect(digest).not.toContain("Source transcript JSONL");
    expect(digest).not.toContain("NOT a resume");
  });

  // When the human typed nothing, the envelope's own default describes the
  // mechanism rather than the work, so the source title is the better label.
  test("a continued session with no instruction falls back to the source title", () => {
    const digest = buildSessionTitleDigest({
      firstUser: buildContinueSessionPrompt({
        sourceId: "4217a92d-234c-4d1a-9b4d-63ac8f057b8d",
        title: "Composer height on iPad",
        cwd: "/home/dev",
        transcript: "/home/dev/transcript.jsonl",
        extra: null,
      }),
      lastUser: "Now ship it",
    });
    expect(digest).toContain("First request: Composer height on iPad");
    expect(digest).not.toContain(CONTINUE_PROMPT_DEFAULT_EXTRA);
  });

  test("the omg runtime contract never reaches the model", () => {
    const digest = buildSessionTitleDigest({
      firstUser:
        "=== omg.dev RUNTIME CONTRACT (capability version 2026-09-18.1) ===\n" +
        "- You are an omg.dev-managed coding agent.\n" +
        "=== END omg.dev RUNTIME CONTRACT ===\nFix the rename button",
    });
    expect(digest).toBe("First request: Fix the rename button");
  });

  // Redaction runs before the clamp on purpose: clamping first can cut a key
  // in half, and half a key matches no pattern.
  test("a credential is redacted even when the clamp would have split it", () => {
    const key = `sk-ant-api03-${"a".repeat(80)}`;
    const digest = buildSessionTitleDigest({
      firstUser: `${"padding ".repeat(70)}${key}`,
    });
    expect(digest).not.toContain("sk-ant-api03-");
    expect(digest).not.toContain("aaaaaaaaaa");
  });

  test("each part is clamped to its own budget", () => {
    const digest = buildSessionTitleDigest({
      firstUser: "x".repeat(5_000),
      lastAssistant: "y".repeat(5_000),
    });
    const first = digest.split("\n")[0]!.replace("First request: ", "");
    const answer = digest.split("\n")[1]!.replace("Latest answer: ", "");
    expect(first.length).toBe(DIGEST_FIRST_USER_MAX);
    expect(answer.length).toBe(DIGEST_LAST_ASSISTANT_MAX);
    expect(first.endsWith("…")).toBe(true);
  });
});
