// Everything a person or a search engine reads about this game, in one place.
// Fill it in for your game. Every claim must match what the game really does.
//
// The build (vite.config.ts) writes the page title, description, Open Graph
// tags and the VideoGame and FAQPage structured data from this file. The
// "How to play" screen (src/app/help.tsx) shows the same text, so the page and
// the game never disagree.
//
// No React, no DOM and no asset imports in this file: vite.config.ts reads it.
import type { ControlKind } from "../game/input";

export type Faq = { q: string; a: string };

export const GAME = {
  name: "Coin Dash",
  /** The browser tab and search result title: what people search for. */
  title: "Coin Dash: Free Coin Grab Game in Your Browser, No Download",
  /** About 150 characters. Shown under the title in search results and link previews. */
  description:
    "Grab gold coins, dodge the bouncing blobs and beat the clock. A quick, free arcade game for your phone or computer. No download, no sign-in.",
  /** Short text on the menu, under the logo. */
  tagline: "Grab the coins. Dodge the blobs.",
  /** The published address, such as "https://coin-dash.omg.dev". Set it after the first publish for absolute share links. */
  siteUrl: "",
  /** Link preview image, 1200 x 630, in public/. */
  shareImage: "/og.png",
  genre: ["Arcade", "Casual"],
  /** Daily challenge number 1 is this day (YYYY-MM-DD). */
  launchDay: "2026-10-22",
  /** "portrait": phones in landscape see "Rotate your phone". "any": both work. */
  orientation: "portrait" as "portrait" | "any",
  /** Big heading when a round ends. */
  resultTitle: "Time's up!",
  /**
   * The touch control, and the words for it. play.tsx passes `kind` to
   * <TouchControls>. The menu shows `touchHint` on a phone and `keysHint` on
   * a computer. Both, and howToPlay, must describe this same control: say
   * "drag" for "drag", "stick" for "stick", "buttons" or "tap" for the rest.
   * check:ui fails a menu hint that names another control. `axes` limits a
   * "drag" to "x" (left and right, such as a paddle) or "y".
   */
  controls: {
    kind: "stick" as ControlKind,
    axes: "xy" as "x" | "y" | "xy",
    touchHint: "Drag the stick to move. Tap Dash to dash.",
    keysHint: "Arrows or WASD to move. Space to dash.",
  },
  howToPlay: [
    "Tap Play.",
    "Drag the stick, or use the arrow keys or WASD, to move your runner.",
    "Run into gold coins to score 10 points each.",
    "Tap Dash, or press Space, for a short burst of speed.",
    "Avoid the purple blobs. Each hit costs a heart. You have three.",
  ],
  tips: [
    "Dash through a gap between two blobs instead of waiting.",
    "Hearts left at the end add 5 points each.",
  ],
  faq: [
    { q: "Is Coin Dash free?", a: "Yes. It is free to play in your browser, with no ads, no download and no sign-in." },
    { q: "Does it work on my phone?", a: "Yes. It is made for phones held upright and also works on a computer with the keyboard." },
    { q: "What is the daily challenge?", a: "Every day has one level that is the same for everyone. Finish it each day to grow your streak." },
    { q: "How do I challenge a friend?", a: "After a round, tap Challenge. Your friend gets a link to the same level and sees whether they beat your score." },
    { q: "Is my progress saved?", a: "Your best score, unlocks and settings are saved in this browser on this device." },
  ] as Faq[],
};
