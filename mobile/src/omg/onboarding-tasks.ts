/**
 * THE ONBOARDING FLOW'S CONTENT, in one place: the first-task cards.
 *
 * Benny, 2026-09-25: onboarding asks one thing, "what should your agent do
 * first?", as a carousel of outcomes. Picking a task card STARTS it. There is
 * no prompt screen to read or edit; the words below are sent as they are, so
 * each one names a result the person can open from the phone.
 *
 * The "agents" card is not a task. It is for people who already use Claude
 * Code or Codex and know what they want to do; it goes to connecting them.
 *
 * It is DATA, not components, because the copy is the part that will be
 * rewritten most and should never require touching a screen to do it.
 */

/** A task card. The key is stable and is stored in the sign-in handoff. */
export type InterestKey = "app" | "game" | "website" | "slides" | "news";

/** Every card, including the one that is not a task. */
export type CardKey = InterestKey | "agents";

export type FirstCard = {
  key: CardKey;
  /** The card's headline. */
  title: string;
  /**
   * One line under it that names the result, not a pitch (Benny,
   * 2026-09-25): "A game for your friends and family", so the reader thinks
   * "I could build that".
   */
  body: string;
  /** The button under the carousel while this card is in view. */
  action: string;
};

export type FirstTask = FirstCard & {
  key: InterestKey;
  /** Sent as the first message, unedited. */
  prompt: string;
  /** The word in "Continue your {word}!" once the task is running. */
  word: string;
};

/** "Continue your chat!" when the task is unknown (an old handoff). */
export const FALLBACK_WORD = "chat";

export const FIRST_TASKS: FirstTask[] = [
  {
    key: "app",
    title: "Build an app",
    body: "A native mobile app that works great on iPhone and Android.",
    action: "Build my app",
    word: "app",
    prompt:
      "Build a mobile app prototype for Lumen Yoga Studio with a class list, class details and a booking button. Give me a preview I can open on my phone.",
  },
  {
    key: "game",
    title: "Build a game",
    body: "A game for your friends and family.",
    action: "Build my game",
    word: "game",
    prompt:
      "Build a fun party quiz game for friends and family that we can play together on our phones. Publish it and send me the link.",
  },
  {
    key: "website",
    title: "Build a website",
    body: "A website for your business, live with its own link.",
    action: "Build my website",
    word: "website",
    prompt:
      "Build a one-page website for Lumen Yoga Studio with a hero, class schedule, prices and a contact form. Publish it and send me the link.",
  },
  {
    key: "slides",
    title: "Build slides",
    body: "A slide deck for your next pitch or class.",
    action: "Build my slides",
    word: "slides",
    prompt:
      "Make a 6-slide pitch deck for Lumen Yoga Studio: problem, offer, classes, pricing, testimonials and a call to action. Publish it as a web page I can open and present from my phone.",
  },
  {
    key: "news",
    title: "Daily Hacker News",
    body: "The top stories of the day, every morning.",
    action: "Start my digest",
    word: "digest",
    prompt:
      "Make a digest of today's top 10 Hacker News stories, one line each on why it matters. Then set it up to run every morning and notify me.",
  },
];

export const AGENTS_CARD: FirstCard = {
  key: "agents",
  title: "Control Claude Code and Codex",
  body: "Your own coding agents, running from your phone.",
  action: "Connect my agent",
};

/** The carousel, in order: the tasks, then the agents card. */
export const FIRST_CARDS: FirstCard[] = [...FIRST_TASKS, AGENTS_CARD];

export function taskFor(key: string | null | undefined): FirstTask | null {
  return FIRST_TASKS.find((task) => task.key === key) ?? null;
}

/** The prompt a task card starts. Null for the agents card and unknown keys. */
export function promptFor(key: string | null | undefined): string | null {
  return taskFor(key)?.prompt ?? null;
}

/** The word in "Continue your {word}!" on screen 05. */
export function headlineWord(key: string | null | undefined): string {
  return taskFor(key)?.word ?? FALLBACK_WORD;
}
