import { describe, expect, test } from "bun:test";
import { redactSecrets } from "./redact-secrets.ts";

// One case per shape. The point of this file is that adding a shape to
// `SECRET_PATTERNS` without a case here is visible, and that removing one
// breaks a named test rather than quietly widening what leaks.
describe("redacting credential-shaped strings", () => {
  test("provider keys of every shape we ship", () => {
    const out = redactSecrets(
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

  test("GitHub tokens, Slack tokens and tailnet auth keys", () => {
    const out = redactSecrets(
      "ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA xoxb-1234567890-abcdefghij tskey-auth-kFooBar-abcdef123456",
    );
    expect(out).not.toContain("ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(out).not.toContain("xoxb-1234567890-abcdefghij");
    expect(out).not.toContain("tskey-auth-kFooBar-abcdef123456");
  });

  test("AWS and Google keys, which only rotation used to catch", () => {
    const out = redactSecrets("AKIAIOSFODNN7EXAMPLE and AIzaSyD-abcdefghijklmnopqrstuvwxyz0123456");
    expect(out).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(out).not.toContain("AIzaSyD-abcdefghijklmnopqrstuvwxyz0123456");
  });

  test("bearer tokens and JWTs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(redactSecrets(`Authorization: Bearer ${jwt}`)).not.toContain(jwt);
  });

  test("a whole PEM private key block, armour included", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA1234\nabcd/efgh+ijkl=\n-----END RSA PRIVATE KEY-----";
    const out = redactSecrets(`deploy key:\n${pem}\ndone`);
    expect(out).not.toContain("MIIEowIBAAKCAQEA1234");
    expect(out).not.toContain("BEGIN RSA PRIVATE KEY");
    expect(out).toContain("[redacted-private-key]");
    expect(out).toContain("done");
  });

  // The important one: a secret we have never seen, under a name nobody added
  // to this file, still has to be caught by shape.
  test("a key-shaped value under an unknown variable name", () => {
    const out = redactSecrets("FUTURE_PROVIDER_TOKEN=abcd1234efgh5678ijkl");
    expect(out).not.toContain("abcd1234efgh5678ijkl");
    // The name survives, because knowing WHICH setting is present is useful.
    expect(out).toContain("FUTURE_PROVIDER_TOKEN");
  });

  test("a password embedded in a URL, where no key name points at it", () => {
    expect(redactSecrets("https://user:hunter2@example.com/repo.git")).not.toContain("hunter2");
    expect(redactSecrets("postgres://admin:s3cr3t@db.internal:5432/omg")).not.toContain("s3cr3t");
    // The host and user stay, because knowing WHICH remote is the diagnosis.
    expect(redactSecrets("https://user:hunter2@example.com/repo.git")).toContain("example.com");
  });

  // Redaction that eats the content is its own failure: a doctor report has to
  // stay diagnosable and a title digest has to stay titleable.
  test("leaves ordinary prose and URLs intact", () => {
    expect(redactSecrets("http://127.0.0.1:8766/api/sessions")).toBe("http://127.0.0.1:8766/api/sessions");
    const line = "Native CLI binary for linux-x64 not found. Reinstall @anthropic-ai/claude-agent-sdk";
    expect(redactSecrets(line)).toBe(line);
    expect(redactSecrets("Fix the rename button so it stops returning 502")).toBe(
      "Fix the rename button so it stops returning 502",
    );
  });
});
