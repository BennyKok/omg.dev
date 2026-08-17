import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

describe("shared composer growth and dictation follow-scroll", () => {
  test("home, session chat and bot chat use the same capped textarea primitive", async () => {
    const app = await readFile("web/src/App.tsx", "utf8");
    expect(app).toContain("function ComposerTextarea");
    // Home, focused session chat, and the bot chat composer. The point of the
    // count is that a new composer reuses this primitive rather than
    // hand-rolling its own growth cap — bump it when one is genuinely added.
    expect(app.match(/<ComposerTextarea/g)?.length).toBe(3);
    expect(app).toContain(
      '"max-h-40 min-w-0 flex-1 resize-none overflow-y-auto [field-sizing:fixed] md:max-h-36"',
    );
    expect(app).toContain('promptMultiline ? "items-end" : "items-center"');
    expect(app).toContain('messageMultiline ? "items-end" : "items-center"');
    expect(app).toContain(
      'onMultilineChange={variant === "inline" ? setPromptMultiline : undefined}',
    );
    expect(app).toContain("onMultilineChange={setMessageMultiline}");
  });

  test("voice updates explicitly follow the newest line without hijacking manual edits", async () => {
    const app = await readFile("web/src/App.tsx", "utf8");
    expect(app).toContain("followedScrollNonceRef.current !== scrollToEndNonce");
    expect(app).toContain("field.scrollTop = field.scrollHeight");
    expect(app.match(/scrollToEndNonce=\{dictationScrollNonce\}/g)?.length).toBe(2);
    expect(app.match(/setDictationScrollNonce\(\(nonce\) => nonce \+ 1\)/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
