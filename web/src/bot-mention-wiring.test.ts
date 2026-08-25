import { describe, expect, test } from "bun:test";

const APP = await Bun.file(new URL("./App.tsx", import.meta.url)).text();

const SKILL_TEXTAREA = (() => {
  const start = APP.indexOf("function SkillTextarea(");
  expect(start).toBeGreaterThan(-1);
  const end = APP.indexOf("function ComposerTextarea(", start);
  expect(end).toBeGreaterThan(start);
  return APP.slice(start, end);
})();

describe("the @ bot picker is wired into the shared composer field", () => {
  // SkillTextarea is the one field behind both the chat and home composers.
  // Mounting the picker anywhere else would reach only one of them.
  test("it lives in SkillTextarea, so both composers get it", () => {
    expect(SKILL_TEXTAREA).toContain("<BotMentionSuggest");
    expect(SKILL_TEXTAREA).toContain("botMentionAt(target.value, target.selectionStart)");
  });

  test("the roster comes from the directory the app already loaded", () => {
    expect(SKILL_TEXTAREA).toContain("useContext(BotDirectoryContext)");
  });

  // The regression this guards: the composer submits on Enter. If the caller's
  // onKeyDown ran first, Enter would send the message instead of picking the
  // highlighted bot.
  test("Enter picks a bot before the composer can submit", () => {
    const handled = SKILL_TEXTAREA.indexOf("pickBot(mentionMatches[");
    const caller = SKILL_TEXTAREA.indexOf("onKeyDown?.(event)");
    expect(handled).toBeGreaterThan(-1);
    expect(caller).toBeGreaterThan(handled);
  });

  // Enter used to click the first row no matter which one was highlighted, so
  // hovering or arrowing down and pressing Enter inserted the wrong bot.
  test("Enter inserts the highlighted bot, not the first one", () => {
    expect(SKILL_TEXTAREA).toContain("pickBot(mentionMatches[Math.min(mentionIndex, count - 1)])");
  });

  test("the arrows walk the menu and wrap at both ends", () => {
    expect(SKILL_TEXTAREA).toContain("(current + 1) % count");
    expect(SKILL_TEXTAREA).toContain("(current - 1 + count) % count");
  });

  // Without preventDefault the arrows would also move the caret in the
  // textarea, scrolling the draft while the menu is open.
  test("the arrows do not also move the caret", () => {
    const block = SKILL_TEXTAREA.slice(SKILL_TEXTAREA.indexOf('event.key === "ArrowDown"'));
    expect(block.slice(0, 200)).toContain("event.preventDefault()");
  });

  test("a new query returns the highlight to the top", () => {
    expect(SKILL_TEXTAREA).toContain("useEffect(() => setMentionIndex(0), [botMention?.query])");
  });

  test("Escape closes the picker without reaching the caller", () => {
    const escape = SKILL_TEXTAREA.indexOf("setBotMention(null)");
    expect(escape).toBeGreaterThan(-1);
    expect(SKILL_TEXTAREA.indexOf("onKeyDown?.(event)")).toBeGreaterThan(escape);
  });

  test("blur dismisses the picker so it cannot outlive focus", () => {
    expect(SKILL_TEXTAREA).toMatch(/onBlur=\{\(\)\s*=>[\s\S]*setBotMention\(null\)/);
  });
});

describe("the skill picker keeps its own keyboard owner", () => {
  test("the slash picker still routes through handleSuggestKey", () => {
    expect(APP).toContain('handleSuggestKey(event, skillSuggest, wrapRef.current, "[data-skill-suggest-option]")');
    expect(APP).not.toContain("function handleSkillSuggestKey(");
  });
});

describe("the picker cannot outlive its trigger text", () => {
  // sendMessage clears the draft programmatically, and since b0a8f0bc the
  // composer may keep focus afterwards, so blur is no longer a reliable
  // dismiss. The picker must close by rechecking the value.
  test("it revalidates against the value, not just on blur", () => {
    expect(SKILL_TEXTAREA).toMatch(
      /useLayoutEffect\(\(\)\s*=>\s*\{[\s\S]*?if \(!botMention\) return;[\s\S]*?botMentionAt\(value, caret\)[\s\S]*?setBotMention\(null\)/,
    );
  });
});
