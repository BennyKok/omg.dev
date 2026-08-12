/**
 * Fail if the native palette has drifted from the web stylesheet.
 *
 * src/omg/theme.ts is a hand-maintained copy of the tokens in
 * web/src/index.css, because RN cannot consume CSS custom properties. A copy
 * with no guard is a copy that silently rots: someone re-skins the Computer on
 * the web, ships it, and the phone keeps last quarter's colours with nothing
 * anywhere reporting a problem.
 *
 * This parses the real stylesheet and compares the tokens the two surfaces are
 * supposed to share. It is deliberately not clever — it does not try to
 * reconcile every token, only the ones theme.ts claims to mirror.
 *
 * Run: bun run scripts/check-theme-drift.ts
 */

import { lightColors, darkColors } from "../src/omg/palette";

const CSS_PATH = new URL("../../web/src/index.css", import.meta.url).pathname;

const css = await Bun.file(CSS_PATH)
  .text()
  .catch(() => {
    console.error(`Could not read ${CSS_PATH} — is the web workspace present?`);
    process.exit(2);
  });

/** Pull a `--name: value;` map out of one CSS block. */
function block(selector: string): Record<string, string> {
  // Match the first `<selector> { ... }`; the palettes are the first blocks and
  // neither contains a nested brace.
  const pattern = new RegExp(`${selector}\\s*\\{([^}]*)\\}`, "m");
  const found = css.match(pattern);
  if (!found) {
    console.error(`Could not find the \`${selector}\` block in index.css`);
    process.exit(2);
  }
  const out: Record<string, string> = {};
  for (const line of found[1].split("\n")) {
    const m = line.match(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/i);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const norm = (v: string) => v.toLowerCase().replace(/\s+/g, " ").trim();

/** theme.ts key -> CSS custom property. Only genuinely shared tokens. */
const MAP: Array<[keyof typeof darkColors, string]> = [
  ["background", "--background"],
  ["foreground", "--foreground"],
  ["card", "--card"],
  ["popover", "--popover"],
  ["secondary", "--secondary"],
  ["muted", "--muted"],
  ["mutedForeground", "--muted-foreground"],
  ["accent", "--accent"],
  ["primary", "--primary"],
  ["primaryForeground", "--primary-foreground"],
  ["destructive", "--destructive"],
  ["success", "--success"],
  ["warning", "--warning"],
  ["info", "--info"],
  ["border", "--border"],
  ["borderStrong", "--border-strong"],
  ["text2", "--text-2"],
  ["codeBg", "--code-bg"],
];

const problems: string[] = [];

for (const [label, selector, palette] of [
  ["light", ":root", lightColors],
  ["dark", "\\.dark", darkColors],
] as const) {
  const tokens = block(selector);
  for (const [key, cssVar] of MAP) {
    const web = tokens[cssVar];
    if (web === undefined) {
      problems.push(`${label}: ${cssVar} no longer exists in index.css (theme.ts still maps ${key})`);
      continue;
    }
    const native = palette[key];
    if (norm(web) !== norm(native)) {
      problems.push(`${label}: ${cssVar} is "${web}" on web but theme.ts ${key} is "${native}"`);
    }
  }
}

if (problems.length) {
  console.error(`\nTheme drift — ${problems.length} token(s) no longer match web/src/index.css:\n`);
  for (const p of problems) console.error(`  • ${p}`);
  console.error(
    "\nUpdate src/omg/theme.ts to match, or drop the token from MAP here if the\n" +
      "two surfaces have deliberately diverged.\n",
  );
  process.exit(1);
}

console.log(`Theme in sync — ${MAP.length * 2} tokens match web/src/index.css.`);
