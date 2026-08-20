// Contract coverage for the Settings > Computer version rows.
//
// The feature exists to answer one question during a bad deploy: "is the UI I
// am looking at the same build as the runtime I am talking to?" That answer is
// only worth anything if the two numbers come from two INDEPENDENT sources. The
// tempting simplifications — stamp web/package.json instead of the root, or let
// a missing server marker fall back to the frontend's number — each turn this
// screen into a mirror that always agrees, which is strictly worse than not
// having it, because it looks like evidence.
//
// App.tsx and the vite configs are side-effect-bearing modules (App.tsx mounts
// the app on import), so these assert against source text, following the
// pattern already used by app-version-pin.test.ts and bootstrap-payload.test.ts.
// The behavioural half lives in web/src/lib/version-diagnostics.test.ts.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..");
const APP = readFileSync(join(REPO, "web/src/App.tsx"), "utf8");
const SERVE = readFileSync(join(REPO, "src/commands/serve.ts"), "utf8");
const VITE_APP = readFileSync(join(REPO, "web/vite.config.ts"), "utf8");
const VITE_LIB = readFileSync(join(REPO, "web/vite.lib.config.ts"), "utf8");
const DIAGNOSTICS = readFileSync(join(REPO, "web/src/lib/version-diagnostics.ts"), "utf8");
const OMG_CLIENT = readFileSync(join(REPO, "web/src/lib/omg-client.ts"), "utf8");

const ROOT_VERSION = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8")).version as string;
const WEB_VERSION = JSON.parse(readFileSync(join(REPO, "web/package.json"), "utf8")).version as string;

/** The Settings > Computer section, where both rows live. */
function computerSection(): string {
  const start = APP.indexOf("function SettingsView(");
  expect(start, "SettingsView not found").toBeGreaterThan(-1);
  const section = APP.slice(start);
  const end = section.indexOf("function MoreView(");
  return end > -1 ? section.slice(0, end) : section;
}

describe("the frontend version is stamped from the ROOT package.json", () => {
  // Both shipped bundles must stamp, and both must stamp the same number the
  // release actually publishes.
  for (const [name, source] of [
    ["web/vite.config.ts (standalone bundle)", VITE_APP],
    ["web/vite.lib.config.ts (@omg-dev/app, the hosted app.omg.dev pin)", VITE_LIB],
  ] as const) {
    test(`${name} defines __OMG_FRONTEND_VERSION__`, () => {
      expect(source).toContain("__OMG_FRONTEND_VERSION__");
      expect(source).toMatch(/define:\s*\{/);
    });

    test(`${name} reads the root manifest, not web/package.json`, () => {
      // scripts/pack-packages.sh rewrites every published manifest to the ROOT
      // version at pack time, so the root number is what a released tarball
      // ships as. web/package.json is never published and has already drifted.
      expect(source).toMatch(/readFileSync\(\s*path\.resolve\([^)]*"\.\.\/package\.json"\)/);
      expect(source).not.toMatch(/readFileSync\(\s*path\.resolve\([^)]*"\.\/package\.json"\)/);
    });
  }

  test("the drift that makes web/package.json the wrong source is real, not hypothetical", () => {
    // If these ever converge the rule still holds, but this test is the record
    // of WHY the rule exists. Root is 0.2.x; web/package.json is 0.1.x.
    expect(WEB_VERSION).not.toBe(ROOT_VERSION);
  });

  test("an unstamped bundle degrades to null instead of throwing or guessing", () => {
    // A downstream host bundler that skips the define must not crash Settings.
    expect(DIAGNOSTICS).toMatch(/typeof __OMG_FRONTEND_VERSION__ === "string"/);
  });
});

describe("the Computer version comes only from the Computer", () => {
  test("/api/bootstrap still carries the version marker Settings reads", () => {
    const start = SERVE.indexOf('if (path === "/api/bootstrap"');
    expect(start, "bootstrap handler not found").toBeGreaterThan(-1);
    const block = SERVE.slice(start, SERVE.indexOf('Cache-Control": "no-cache"', start));
    expect(block).toContain("version: appVersion()");
  });

  test("the app stores the raw marker instead of collapsing it to a string", () => {
    // The old `payload.version || "unknown"` made "an older runtime that sends
    // no version" indistinguishable from "we have not asked yet", and rendered
    // the word "unknown" as if it were a version.
    expect(APP).not.toContain('payload.version || "unknown"');
    expect(APP).toMatch(/version: typeof payload\.version === "string" \? payload\.version : null/);
  });

  test("a version is tagged with the transport it was reported over", () => {
    // A host switches Computers by swapping the transport in place, without
    // remounting the tree, so an untagged value keeps describing the machine
    // you just left. Only a genuine swap bumps the counter.
    expect(OMG_CLIENT).toContain("export function omgTransportGeneration()");
    expect(OMG_CLIENT).toMatch(/if \(transport !== omgTransport\) omgTransportGenerationCounter \+= 1;/);
    expect(APP).toMatch(/generation: omgTransportGeneration\(\)/);
    expect(computerSection()).toMatch(/stale:\s*\n?\s*computerVersionReport != null &&/);
  });

  test("a restart under an open tab does not leave a stale version on screen", () => {
    // Observed live during verification: the box was restarted onto a new
    // version and Settings went on showing the pre-restart number until a
    // manual reload. bootId is the only marker that distinguishes processes
    // (two builds can share a version), so the reconnect edge checks it and
    // re-bootstraps only when it actually moved.
    expect(APP).toMatch(/bootId: typeof payload\.bootId === "string" \? payload\.bootId : null/);
    expect(APP).toContain('"/api/install?ready=1"');
    // Fires on the connection EDGE (not-live -> live), not on every render,
    // and re-fetches nothing when the process is the same one as before.
    expect(APP).toMatch(/if \(liveStatus !== "live" \|\| wasLive\) return;/);
    expect(APP).toMatch(/if \(!seen \|\| !now \|\| seen === now\) return;/);
  });

  test("neither value is ever derived from the other", () => {
    const section = computerSection();
    const frontendRow = section.slice(section.indexOf('label="Frontend"'));
    const computerRow = section.slice(section.indexOf('label="Computer"'));

    // The Frontend row reads the build stamp and nothing else.
    expect(frontendRow.slice(0, frontendRow.indexOf("/>"))).toContain("FRONTEND_VERSION");
    // The Computer row reads the resolved server state and MUST NOT mention
    // the build stamp — that would be the mirror bug.
    const computerRowProps = computerRow.slice(0, computerRow.indexOf("/>"));
    expect(computerRowProps).toContain("computerVersion");
    expect(computerRowProps).not.toContain("FRONTEND_VERSION");

    // And the resolver itself has no frontend fallback anywhere in it.
    expect(DIAGNOSTICS.slice(
      DIAGNOSTICS.indexOf("export function resolveComputerVersion"),
      DIAGNOSTICS.indexOf("export function compareVersions"),
    )).not.toContain("FRONTEND_VERSION");
  });
});

describe("the rendered rows", () => {
  test("both rows are present in Settings > Computer", () => {
    const section = computerSection();
    expect(section).toContain('label="Frontend"');
    expect(section).toContain('label="Computer"');
    // Rendered inside the Computer card, after the existing navigation rows.
    expect(section.indexOf("Storage &amp; performance")).toBeLessThan(section.indexOf('label="Frontend"'));
  });

  test("a mismatch note is quiet and conditional, never always-on", () => {
    const section = computerSection();
    expect(section).toMatch(/\{versionNote \?/);
    expect(section).toContain("isVersionMismatch(versionSkew)");
  });

  test("rows cannot overflow a narrow screen", () => {
    // Desktop and mobile share this row. The label column must be allowed to
    // shrink and truncate while the version itself never does.
    const row = APP.slice(APP.indexOf("function VersionRow("), APP.indexOf("function SettingsView("));
    expect(row).toContain("min-w-0");
    expect(row).toContain("truncate");
    expect(row).toContain("shrink-0");
  });

  test("copy is offered for real versions and withheld for states", () => {
    const row = APP.slice(APP.indexOf("function VersionRow("), APP.indexOf("function SettingsView("));
    // No copyValue => a plain div, no button, no clipboard write.
    expect(row).toMatch(/if \(!copyValue\) \{/);
    expect(row).toContain("copyMessageText(copyValue)");
    expect(row).toMatch(/aria-label=\{`Copy \$\{label\} version/);
  });

  test("no row can leak a path, command line, or host identifier", () => {
    const section = computerSection();
    const rows = section.slice(section.indexOf('label="Frontend"'), section.indexOf("</section>", section.indexOf('label="Computer"')));
    for (const banned of ["installInfo", "updateCommand", "cwd", "hostname", "bootId", "process.env"]) {
      expect(rows, `the version rows must not surface ${banned}`).not.toContain(banned);
    }
  });
});
