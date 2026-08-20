import { describe, expect, test } from "bun:test";
import { embedSearchFlag, isEmbedded, isFramed } from "../web/src/lib/embed.ts";
import {
  readLocationSessionId,
  shouldNavigateToTab,
  shouldPrioritizeSession,
  validateAppSearch,
} from "../web/src/lib/app-search.ts";

describe("embed detection", () => {
  test("accepts embed=1 / true / boolean from search", () => {
    expect(embedSearchFlag({ embed: true })).toBe(true);
    expect(embedSearchFlag({ embed: 1 })).toBe(true);
    expect(embedSearchFlag({ embed: "1" })).toBe(true);
    expect(embedSearchFlag({ embed: "true" })).toBe(true);
    expect(embedSearchFlag({ embed: false })).toBe(false);
    expect(embedSearchFlag({ embed: "0" })).toBe(false);
    expect(embedSearchFlag({})).toBe(false);
    expect(embedSearchFlag(null)).toBe(false);
  });

  test("isEmbedded honors the search flag without needing a frame", () => {
    expect(isEmbedded({ embed: true })).toBe(true);
    expect(isEmbedded({ embed: "1" })).toBe(true);
  });

  test("isFramed is false at the top level (node / jsdom top window)", () => {
    // In unit tests we are not inside an iframe.
    expect(isFramed()).toBe(false);
  });
});

describe("host viewer contract", () => {
  test("keeps hosted viewer identity presentation-only", () => {
    const embedded = require("node:fs").readFileSync("web/src/embedded.tsx", "utf8") as string;
    const options = require("node:fs").readFileSync(
      "web/src/lib/embedded-host-options.tsx",
      "utf8",
    ) as string;
    const declarations = require("node:fs").readFileSync(
      "web/src/embedded.d.ts",
      "utf8",
    ) as string;

    expect(embedded).toContain("viewer?: EmbeddedViewer;");
    // Asserted as a set rather than one exact literal: pinning the whole
    // provider value made adding any sibling option a test failure, which is
    // noise, not a contract. What matters is that viewer is still passed down.
    expect(embedded).toMatch(/value=\{\{[^}]*\bviewer\b[^}]*\}\}/);
    expect(embedded).toMatch(/value=\{\{[^}]*\bconnectionOnboarding\b[^}]*\}\}/);
    expect(options).toContain("viewer?: EmbeddedViewer;");
    expect(declarations).toContain("export interface EmbeddedViewer");
    expect(declarations).toContain("viewer?: EmbeddedViewer;");
    expect(options).toContain("never assign sessions or change authorization");
    expect(embedded).not.toMatch(/body:\s*JSON\.stringify\([^)]*viewer/);
  });

  // web/src/embedded.d.ts is hand-maintained, so a prop added to the .tsx can
  // ship with runtime support and no type for it. That happened with
  // hostedTranscription: the published bundle had the code, the declaration did
  // not, and the only symptom was TS2322 in a consumer AFTER the release was
  // cut. Every surface prop must appear in both files.
  test("every OmgAppSurface prop is declared in the shipped types", () => {
    const read = (p: string) => require("node:fs").readFileSync(p, "utf8") as string;
    const propsOf = (src: string) => {
      const body = src.match(/export interface OmgAppSurfaceProps \{([\s\S]*?)\n\}/)?.[1] ?? "";
      return new Set(
        [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]),
      );
    };
    const fromSource = propsOf(read("web/src/embedded.tsx"));
    const fromTypes = propsOf(read("web/src/embedded.d.ts"));

    expect(fromSource.size).toBeGreaterThan(0);
    const undeclared = [...fromSource].filter((p) => !fromTypes.has(p));
    expect(undeclared).toEqual([]);
  });
});

describe("session prioritization + search validation", () => {
  test("validateAppSearch keeps session and embed contracts", () => {
    expect(validateAppSearch({ session: "abc", embed: "1" })).toEqual({
      session: "abc",
      embed: true,
    });
    expect(validateAppSearch({ session: "", embed: "0" })).toEqual({});
    expect(validateAppSearch({ foo: 1 })).toEqual({});
  });

  test("shouldPrioritizeSession is true only with a real session id", () => {
    expect(shouldPrioritizeSession({ session: "s1" })).toBe(true);
    expect(shouldPrioritizeSession({ session: "s1", embed: true })).toBe(true);
    expect(shouldPrioritizeSession({ embed: true })).toBe(false);
    expect(shouldPrioritizeSession({})).toBe(false);
    expect(shouldPrioritizeSession(null)).toBe(false);
  });

  test("same-tab state updates do not navigate and discard deep-link search", () => {
    expect(shouldNavigateToTab("live", "live")).toBe(false);
    expect(shouldNavigateToTab("settings", "settings")).toBe(false);
    expect(shouldNavigateToTab("settings", "live")).toBe(true);
  });

  test("session deep links are available before router search hydration", () => {
    expect(readLocationSessionId("?session=abc&embed=1")).toBe("abc");
    expect(readLocationSessionId("?embed=1")).toBeNull();
    expect(readLocationSessionId("?session=")).toBeNull();
  });
});

describe("host bottom inset contract", () => {
  test("CSS defines a tight embed host inset for the compact omg pill", () => {
    const css = require("node:fs").readFileSync("web/src/index.css", "utf8") as string;
    expect(css).toContain('html[data-lfg-embed="true"]');
    expect(css).toMatch(/--lfg-host-bottom-inset:\s*2\.75rem/);
  });

  test("global --lfg-safe-bottom is device-only standalone, host-only in embed", () => {
    const css = require("node:fs").readFileSync("web/src/index.css", "utf8") as string;
    // Standalone default: original device home-indicator.
    expect(css).toMatch(/--lfg-device-safe-bottom:\s*env\(safe-area-inset-bottom,\s*0px\)/);
    expect(css).toMatch(/--lfg-safe-bottom:\s*var\(--lfg-device-safe-bottom\)/);
    // Embed: cancel device pad + host pill only (host already owns the
    // home-indicator zone; stacking it double-pads iOS PWAs).
    const embedBlock = css.slice(css.indexOf('html[data-lfg-embed="true"]'));
    expect(embedBlock).toMatch(/--lfg-device-safe-bottom:\s*0px/);
    expect(embedBlock).toMatch(/--lfg-safe-bottom:\s*var\(--lfg-host-bottom-inset\)/);
    // Clearance tokens derive from the global safe bottom.
    expect(css).toMatch(/--lfg-composer-clear:\s*calc\(10\.5rem\s*\+\s*var\(--lfg-safe-bottom\)\)/);
    expect(css).toMatch(/--lfg-orb-bottom:\s*calc\(1\.5rem\s*\+\s*var\(--lfg-safe-bottom\)\)/);
  });

  test("session chat composer pads with global safe bottom (portal is full-bleed)", () => {
    const app = require("node:fs").readFileSync("web/src/App.tsx", "utf8") as string;
    // The session sheet portals to document.body, so shell host-pad cannot
    // protect the composer — the form itself must use --lfg-safe-bottom.
    expect(app).toContain("pb-[calc(0.5rem+var(--lfg-safe-bottom))]");
    // No residual session-body pad that only knew about the device safe-area.
    expect(app).not.toMatch(
      /paddingBottom:\s*["']env\(safe-area-inset-bottom(?:,\s*0px)?\)["']/,
    );
  });

  test("inline home uses device pad (standalone) and cancels under embed", () => {
    const app = require("node:fs").readFileSync("web/src/App.tsx", "utf8") as string;
    // Standalone: original home-indicator via --lfg-device-safe-bottom.
    // Embed: that token is cancelled to 0; shell host-inset clears the pill.
    expect(app).toContain("pb-[max(var(--lfg-device-safe-bottom),0.5rem)]");
    // Not on a bare page — it has no composer for the pill to cover, so the
    // inset was only a dead band under the host's last card.
    expect(app).toContain('embedded && !bare && "pb-[var(--lfg-host-bottom-inset)]"');
  });

  test("host can reserve top-right space in the embedded mobile header", () => {
    const css = require("node:fs").readFileSync("web/src/index.css", "utf8") as string;
    const app = require("node:fs").readFileSync("web/src/App.tsx", "utf8") as string;
    // Default 0 so standalone LFG — and any host that floats nothing in that
    // corner — reserves nothing. The value is host-driven (omg sets it on its
    // surface wrapper), unlike the hardcoded bottom inset.
    expect(css).toMatch(/--lfg-host-top-inset:\s*0px/);
    // The embedded mobile header's right island slides left by the inset, so a
    // host island in that corner never lands on the project picker.
    expect(app).toContain("pr-[calc(0.75rem+var(--lfg-host-top-inset))]");
    // Left stays a plain gutter — px-3 would re-symmetrise and undo the above.
    expect(app).not.toMatch(
      /<header className="z-40 flex shrink-0 items-center justify-between gap-2 px-3/,
    );
  });

  test("hosted desktop rail exposes a footer slot the host can portal into", () => {
    const app = require("node:fs").readFileSync("web/src/App.tsx", "utf8") as string;
    const css = require("node:fs").readFileSync("web/src/index.css", "utf8") as string;
    // A host that owns the whole desktop surface has nowhere for its own
    // top-level nav: this layout suppresses the app header and the rail's top
    // row is full. A real node inside the rail beats having it float chrome
    // over us and track our width, collapse animation and position.
    expect(app).toContain('data-lfg-host-slot="rail-footer"');
    // Hosted only — standalone LFG grows no empty node.
    expect(app).toMatch(
      /\{hosted \? \(\s*<div\s*\n\s*data-lfg-host-slot="rail-footer"/,
    );
    // The host needs to know it has 56px, not 280px, to lay out in.
    expect(app).toContain(
      'data-lfg-rail-collapsed={railCollapsed ? "true" : undefined}',
    );
    // Unfilled slots must cost nothing: the host portals in AFTER we render,
    // so :empty is the only continuous answer.
    expect(css).toMatch(/\[data-lfg-host-slot\]:empty\s*\{\s*display:\s*none/);
  });

  test("hosted mobile headers expose a header-actions slot instead of ceding the corner", () => {
    const app = require("node:fs").readFileSync("web/src/App.tsx", "utf8") as string;
    const css = require("node:fs").readFileSync("web/src/index.css", "utf8") as string;
    // Two islands in one corner were held apart by --lfg-host-top-inset, whose
    // value is a width constant in the HOST's stylesheet that has to equal the
    // real box of a component in the HOST's tree. Two independently versioned
    // repos, one hand-maintained number: it drifted ~1rem and the islands
    // overlapped on a phone. One island cannot overlap itself.
    expect(app).toContain('data-lfg-host-slot="header-actions"');
    // Both embedded mobile headers carry it. The tablet header carries the
    // third slot added in v0.2.14, so host controls stay docked at every width.
    expect(app.match(/data-lfg-host-slot="header-actions"/g)?.length).toBe(3);
    // Backward compatibility is the whole design: an older host that still
    // floats its own island must see no change. The slot is inert until the
    // host portals into it, and :empty is what makes that continuous.
    expect(css).toMatch(/\[data-lfg-host-slot\]:empty\s*\{\s*display:\s*none/);
    // The reservation stays. LFG must not guess that the host has adopted the
    // slot: an old host floating over a zeroed inset is the same overlap
    // again, from the other side. Zeroing belongs to whoever fills the slot.
    expect(app).toContain('pr-[calc(0.75rem+var(--lfg-host-top-inset))]');
    // Right corner, not appended to the back button. Docking is a layout fix
    // and must not relocate the host's controls: the first cut of this put
    // Computer and Settings beside "Live" on the LEFT, which moved a button
    // across the screen as a side effect. justify-between + a slot that is a
    // SIBLING of the back island, never a child of it, is what keeps the
    // corner the corner.
    expect(app).toMatch(
      /<header className="z-40 flex shrink-0 items-center justify-between gap-2 pb-3 pl-3 pr-\[calc\(0\.75rem\+var\(--lfg-host-top-inset\)\)\][\s\S]*?<\/NavIsland>\s*\{\/\*[\s\S]*?\*\/\}\s*<span\s*\n\s*data-lfg-host-slot="header-actions"/,
    );
  });

  test("embedded Pages menu carries the host's Settings so the island needn't", () => {
    const app = require("node:fs").readFileSync("web/src/App.tsx", "utf8") as string;
    // Embedded has no Settings tab of its own — the host mounts those pages —
    // so the host kept a second control beside our menu just for it: three
    // chips in one island for two destinations. The menu can carry it, since
    // the host already hands us onOpenSettingsPage.
    expect(app).toContain("onOpenHostSettings");
    // A plain item, never a radio item: choosing it leaves LFG, so marking it
    // current in a group describing which LFG page you are on would be false
    // as soon as you came back.
    expect(app).toMatch(
      /onOpenHostSettings\(\);[\s\S]{0,120}<Settings className="size-5 shrink-0 text-muted-foreground" \/>/,
    );
    // Only when a host actually supplied the callback. Standalone must not
    // grow a dead row, and `embedded` alone does not prove the host mounts
    // settings pages.
    // The host's settings ROOT, never onOpenSettingsPage — that one addresses
    // the MACHINE's pages (omg routes it to /settings/computer), so wiring
    // this entry to it swapped a general Settings control for a per-computer
    // page behind a machine selector.
    expect(app).toContain("const { onOpenHostSettings } = useEmbeddedHostOptions();");
    expect(app).toContain("const hostSettingsInMenu = embedded && !!onOpenHostSettings;");
    // Advertised on the slot so the host drops its gear on capability, not on
    // an assumed version: docking into an older build that has no such item
    // must leave the host's own control in place, or the surface has no route
    // to settings at all.
    expect(app).toContain('data-lfg-host-settings={hostSettingsInMenu ? "menu" : undefined}');
    // Switcher first, overflow last: the host's Computer control is what people
    // reach for, and a "⋮" sitting ahead of it reads as the main event.
    expect(app).toMatch(
      /data-lfg-host-slot="header-actions"[\s\S]*?<PagesMenu\s*\n\s*tab=\{tab\}/,
    );
  });

  test("OmgAppSurface plumbs onOpenHostSettings through to the host options", () => {
    // The gap this closes: every assertion above passes against a build where
    // the entry can never appear. App.tsx reads onOpenHostSettings off the
    // context, and the context type declares it — but OmgAppSurface, the only
    // public way in, neither accepted the prop nor forwarded it. So
    // `hostSettingsInMenu` was false for every host that ever existed: no
    // Settings item in the Pages menu, and no data-lfg-host-settings flag, so
    // omg's island kept its own gear and sat at three chips for two
    // destinations — the exact crowding the menu entry was built to end.
    //
    // Assert the whole chain here rather than trusting the props type: a prop
    // that is declared and destructured but dropped before the provider is the
    // same dead feature with a green typecheck.
    const embedded = require("node:fs").readFileSync(
      "web/src/embedded.tsx",
      "utf8",
    ) as string;
    expect(embedded).toContain("onOpenHostSettings?: () => void;");
    expect(embedded).toMatch(
      /export function OmgAppSurface\(\{[\s\S]*?onOpenHostSettings,[\s\S]*?\}: OmgAppSurfaceProps\)/,
    );
    expect(embedded).toMatch(
      /<EmbeddedHostOptionsProvider\s*\n\s*value=\{\{[\s\S]*?onOpenHostSettings,[\s\S]*?\}\}/,
    );
    // Shipped types are hand-written here, so a host on the published package
    // would get a type error for a prop the runtime honours.
    const dts = require("node:fs").readFileSync(
      "web/src/embedded.d.ts",
      "utf8",
    ) as string;
    expect(dts).toContain("onOpenHostSettings?: () => void;");
  });

  test("desktop embed zeroes host-bottom-inset (omg nav is top-middle)", () => {
    const css = require("node:fs").readFileSync("web/src/index.css", "utf8") as string;
    // Match omg useIsDesktop (lg = 1024). Mobile keeps the 2.75rem bottom pill.
    expect(css).toMatch(
      /@media\s*\(min-width:\s*1024px\)\s*\{[\s\S]*?html\[data-lfg-embed="true"\]\s*\{[\s\S]*?--lfg-host-bottom-inset:\s*0px/,
    );
  });
});

describe("mobile overlay scroll contract", () => {
  test("hosted surfaces keep LFG page navigation", () => {
    const app = require("node:fs").readFileSync("web/src/App.tsx", "utf8") as string;

    expect(app).toContain("embedded && isMobile");
    expect(app).toContain('tab === "notifications"');
    expect(app).toContain('value="artifacts"');
    expect(app).toContain("projects={projectOptions}");
    expect(app).toContain("onChange={changeProjectFilter}");
    expect(app).toContain("onOpenShipped={openShipped}");
    expect(app).toContain("onOpenRecentShipped={openShippedSession}");
    expect(app).not.toContain(
      "onOpenShipped={embedded ? undefined : openShipped}",
    );
  });

  test("every mobile page scrolls behind the shared top chrome", () => {
    const app = require("node:fs").readFileSync("web/src/App.tsx", "utf8") as string;
    const css = require("node:fs").readFileSync("web/src/index.css", "utf8") as string;

    expect(app).toContain(
      '"absolute inset-x-0 bottom-[var(--lfg-host-bottom-inset)] top-0 px-2 pt-[var(--lfg-mobile-header-height)]',
    );
    expect(app).toContain('isMobile && "mobile-scroll-header-fade"');
    expect(css).toMatch(
      /--lfg-mobile-header-height:\s*calc\(3\.5rem\s*\+\s*env\(safe-area-inset-top,\s*0px\)\)/,
    );
    expect(css).toMatch(/--lfg-mobile-header-fade-height:\s*1\.25rem/);
    expect(css).toMatch(/opacity:\s*var\(--lfg-mobile-header-fade-opacity,\s*0\)/);
    expect(css).toMatch(
      /\.mobile-scroll-header-fade\s*\{[^}]*isolation:\s*isolate[^}]*\}/,
    );
    expect(css).not.toMatch(
      /\.mobile-scroll-header-fade\s*\{[^}]*backdrop-filter/,
    );
    expect(css).toMatch(
      /\.mobile-scroll-header-fade::before\s*\{[^}]*backdrop-filter:\s*blur\(10px\)/,
    );
    expect(app).toContain("Math.max(0, main.scrollTop) / 24");
  });

  // Regression: the LFG mark went soft on iOS from Jun 22 (nav islands) until
  // this fix. The artwork never changed — icon.svg is byte-identical across the
  // whole window. The header island itself carried backdrop-blur-xl, and iOS
  // flattens an SVG child into its backdrop-filtered ancestor's layer and
  // rasterizes it there before scaling. 1a0132e fixed the outer header wrapper
  // the same way but left the islands, so the mark stayed blurry.
  test("header islands blur behind the brand mark, never above it", () => {
    const app = require("node:fs").readFileSync("web/src/App.tsx", "utf8") as string;
    const css = require("node:fs").readFileSync("web/src/index.css", "utf8") as string;

    // The frosted surface is a z-index:-1 ::before, so the mark is never a
    // descendant of a backdrop-filtered element.
    expect(css).toMatch(/\.glass-island\s*\{[^}]*isolation:\s*isolate[^}]*\}/);
    expect(css).not.toMatch(/\.glass-island\s*\{[^}]*backdrop-filter/);
    expect(css).toMatch(
      /\.glass-island::before\s*\{[^}]*backdrop-filter:\s*blur\(24px\)/,
    );
    // Must inherit the pill radius or the frost squares off the rounded island.
    expect(css).toMatch(/\.glass-island::before\s*\{[^}]*border-radius:\s*inherit/);

    // No header island may reintroduce the filter on the element that wraps the
    // brand: every <ProductBrand> ancestor island uses the class instead.
    for (const island of app.matchAll(
      /className="([^"]*\brounded-full\b[^"]*\bh-11\b[^"]*|[^"]*\bsize-11\b[^"]*\brounded-full\b[^"]*)"/g,
    )) {
      expect(island[1]).not.toContain("backdrop-blur");
    }
    expect(app).toContain("glass-island flex h-11 items-center rounded-full px-1.5");
    expect(app).toContain(
      'aria-label="Back to Live"',
    );
  });

  test("composer pages reserve chrome while the fade overlays content", () => {
    const app = require("node:fs").readFileSync("web/src/App.tsx", "utf8") as string;
    const css = require("node:fs").readFileSync("web/src/index.css", "utf8") as string;

    // Bots is a composer page too, so it reserves the same chrome as Live.
    expect(app).toContain(
      'tab === "live" || tab === "bots" || tab === "notifications" || tab === "artifacts"',
    );
    // <main>'s bottom padding must clear the inline composer, but the exact
    // expression has grown legitimate additive terms since this test was
    // written (e.g. the bot-nav dock height). What must stay true is the
    // regression this test exists for: that reserved space never also adds
    // the fade's height, which would double-count space the fade only
    // overlays instead of reserving. Match every pb-[...] that clears the
    // composer and assert none of them fold in the fade height.
    const composerClearances = [
      ...app.matchAll(/pb-\[[^\]]*--lfg-inline-composer-height[^\]]*\]/g),
    ].map((m) => m[0]);
    expect(composerClearances.length, "no pb-[...] clears the inline composer height").toBeGreaterThan(0);
    for (const clearance of composerClearances) {
      expect(clearance).not.toContain("--lfg-mobile-composer-fade-height");
    }
    expect(app).toContain(
      "mobile-scroll-composer-fade pointer-events-auto relative z-[55] mt-auto",
    );
    expect(app).not.toContain(
      "overflow-x-clip bg-background/95 pt-4 shadow-[0_-8px_24px_rgba(0,0,0,0.12)]",
    );
    expect(css).toMatch(
      /--lfg-mobile-composer-fade-height:\s*var\(--lfg-mobile-header-fade-height\)/,
    );
    expect(css).toMatch(
      /opacity:\s*var\(--lfg-mobile-composer-fade-opacity,\s*0\)/,
    );
    expect(app).toContain(
      "main.scrollHeight - main.clientHeight - main.scrollTop",
    );
    expect(app).toContain("Math.min(1, remaining / 24)");
  });
});
