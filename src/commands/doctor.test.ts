// `omg doctor` exists because a user could not tell us what went wrong.
//
// On 2026-08-18 a report arrived as a screenshot of a spinner. That was all the
// user had: the failure behind it produced no output at all, so there was
// nothing to send. Finding it took a clean VM and a traced subprocess.
//
// The output of this command goes into Discord and GitHub issues, which makes
// leaking a credential the one failure mode worse than the bug it diagnoses.
// These tests are mostly about that.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recentLogTail, redact, sanitize, shortenHome } from "./doctor.ts";

describe("redacting a report before a user pastes it in public", () => {
  // Pattern-based, not name-based, on purpose: an allowlist of known key names
  // only covers the secrets we already thought of.
  test("removes provider keys of every shape we ship", () => {
    const out = redact(
      [
        "ANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnop",
        "OPENAI_API_KEY=sk-proj-ABCDEFGHIJKLMNOPQRST",
        "omg login --token omg_sk_live_abcdef123456789",
        "XAI_API_KEY=xai-abcdefghijklmnopqrst",
      ].join("\n"),
    );
    expect(out).not.toContain("sk-ant-api03-abcdefghijklmnop");
    expect(out).not.toContain("sk-proj-ABCDEFGHIJKLMNOPQRST");
    expect(out).not.toContain("omg_sk_live_abcdef123456789");
    expect(out).not.toContain("xai-abcdefghijklmnopqrst");
  });

  test("removes GitHub tokens and tailnet auth keys", () => {
    const out = redact("ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA and tskey-auth-kFooBar-abcdef123456");
    expect(out).not.toContain("ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(out).not.toContain("tskey-auth-kFooBar-abcdef123456");
  });

  test("removes bearer tokens and JWTs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const out = redact(`Authorization: Bearer ${jwt}`);
    expect(out).not.toContain(jwt);
  });

  // The important one: a secret we have never seen, under a name nobody added
  // to this file, still has to be caught by shape.
  test("removes a key-shaped value under an unknown variable name", () => {
    const out = redact("FUTURE_PROVIDER_TOKEN=abcd1234efgh5678ijkl");
    expect(out).not.toContain("abcd1234efgh5678ijkl");
    // The name survives, because knowing WHICH setting is present is useful.
    expect(out).toContain("FUTURE_PROVIDER_TOKEN");
  });

  // Found while probing this function against a realistic environment: a
  // password inside a URL survived every other pattern, because the secret is
  // positional and no key name points at it. Git remotes and proxy settings
  // both carry these.
  test("removes a password embedded in a URL", () => {
    expect(redact("https://user:hunter2@example.com/repo.git")).not.toContain("hunter2");
    expect(redact("postgres://admin:s3cr3t@db.internal:5432/omg")).not.toContain("s3cr3t");
    // The host and user stay, because knowing WHICH remote is the diagnosis.
    expect(redact("https://user:hunter2@example.com/repo.git")).toContain("example.com");
  });

  // A URL with no credentials must survive intact — the server line is one.
  test("leaves ordinary URLs alone", () => {
    expect(redact("http://127.0.0.1:8766/api/sessions")).toBe("http://127.0.0.1:8766/api/sessions");
  });

  // Redaction that eats the diagnosis is its own failure. The report has to
  // stay readable or nobody learns anything from it.
  test("leaves the diagnostic content intact", () => {
    const line = "Native CLI binary for linux-x64 not found. Reinstall @anthropic-ai/claude-agent-sdk";
    expect(redact(line)).toBe(line);
    expect(redact("claude 2.1.233 (Claude Code)")).toBe("claude 2.1.233 (Claude Code)");
    expect(redact("responding on 127.0.0.1:8766 (3 sessions)")).toContain("127.0.0.1:8766");
  });

  test("hides the user's home directory, and so their username", () => {
    expect(shortenHome("/home/alice/omg/data", "/home/alice")).toBe("~/omg/data");
    // A home of "/" would turn every path into nonsense; leave it alone.
    expect(shortenHome("/home/alice/omg", "/")).toBe("/home/alice/omg");
  });

  test("sanitize applies both, in a form safe to paste", () => {
    const out = sanitize("/home/bob/.config key=sk-ant-abcdefghijklmnop", "/home/bob");
    expect(out).not.toContain("/home/bob");
    expect(out).not.toContain("sk-ant-abcdefghijklmnop");
  });
});

describe("choosing which log lines to include", () => {
  function logDir(contents: string): string {
    const dir = mkdtempSync(join(tmpdir(), "omg-doctor-log-"));
    writeFileSync(join(dir, "trace-2026-08-18.jsonl"), contents);
    return dir;
  }

  // These logs are mostly per-request timing rows. A plain tail would be 25
  // lines of healthy noise, pushing the one useful line out of the report.
  test("surfaces problem lines instead of the raw tail", () => {
    const noise = Array.from({ length: 60 }, (_, i) => `{"event":"api_timing","durationMs":${i}}`);
    const dir = logDir([...noise.slice(0, 30), '{"event":"sendq_failed","error":"session is not in a tmux pane"}', ...noise.slice(30)].join("\n"));

    const out = recentLogTail(dir);
    expect(out).toContain("session is not in a tmux pane");
    expect(out).toContain("1 problem lines");
  });

  // A quiet log is a real finding, not an empty section.
  test("says so when nothing looks wrong", () => {
    const dir = logDir(Array.from({ length: 20 }, (_, i) => `{"event":"api_timing","durationMs":${i}}`).join("\n"));
    expect(recentLogTail(dir)).toContain("no problem lines found");
  });

  // It runs on a broken box by definition, so missing files are normal input.
  test("does not throw when there is no log at all", () => {
    expect(recentLogTail(join(tmpdir(), "omg-doctor-does-not-exist"))).toBe("(no log directory)");
    expect(recentLogTail(mkdtempSync(join(tmpdir(), "omg-doctor-empty-")))).toBe("(no log files)");
  });

  test("reads the newest log when several exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "omg-doctor-multi-"));
    writeFileSync(join(dir, "old.jsonl"), '{"error":"stale failure"}');
    writeFileSync(join(dir, "new.jsonl"), '{"error":"current failure"}');
    const old = new Date(Date.now() - 86_400_000);
    utimesSync(join(dir, "old.jsonl"), old, old);

    const out = recentLogTail(dir);
    expect(out).toContain("current failure");
    expect(out).not.toContain("stale failure");
  });
});
