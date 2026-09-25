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

/** One tap-to-pick answer. `phrase` is what it adds to the prompt. */
export type Answer = { label: string; phrase: string };

/** One question after a task card, with four or five answers. */
export type Question = { title: string; answers: Answer[] };

export type FirstTask = FirstCard & {
  key: InterestKey;
  /**
   * The prompt with no answers picked: what an old handoff or a test gets.
   * The flow itself always sends `compose(task, answers)`.
   */
  prompt: string;
  /** The word in "Continue your {word}!" once the task is running. */
  word: string;
  /**
   * Three questions, asked after the card (Benny, 2026-09-25): who it is
   * for, what it is about, what it should do, so the first run is theirs
   * and not a sample business. Answers are tapped, never typed.
   */
  questions: [Question, Question, Question];
  /** Builds the prompt from the three picked phrases, in question order. */
  template: (who: string, about: string, does: string) => string;
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
    questions: [
      { title: "Who is it for?", answers: [
        { label: "Just me", phrase: "for me" },
        { label: "Friends", phrase: "for my friends" },
        { label: "Family", phrase: "for my family" },
        { label: "My team", phrase: "for my team" },
        { label: "My customers", phrase: "for my customers" },
      ] },
      { title: "What is it about?", answers: [
        { label: "Health and fitness", phrase: "about health and fitness" },
        { label: "Food and recipes", phrase: "about food and recipes" },
        { label: "Money", phrase: "about money" },
        { label: "Learning", phrase: "about learning" },
      ] },
      { title: "What should it do?", answers: [
        { label: "Track progress", phrase: "helps track progress" },
        { label: "Plan and remind", phrase: "plans things and sends reminders" },
        { label: "Share with others", phrase: "lets people share with each other" },
        { label: "Book and order", phrase: "lets people book and order" },
      ] },
    ],
    template: (who, about, does) =>
      `Build a mobile app ${who} ${about} that ${does}. Give me a preview I can open on my phone.`,
    prompt:
      "Build a mobile app prototype for Lumen Yoga Studio with a class list, class details and a booking button. Give me a preview I can open on my phone.",
  },
  {
    key: "game",
    title: "Build a game",
    body: "A game for your friends and family.",
    action: "Build my game",
    word: "game",
    questions: [
      { title: "Who is it for?", answers: [
        { label: "Just me", phrase: "for me to play" },
        { label: "Friends", phrase: "for friends" },
        { label: "Family", phrase: "for family" },
        { label: "Kids", phrase: "for kids" },
        { label: "A party", phrase: "for a party" },
      ] },
      { title: "What kind of game?", answers: [
        { label: "Quiz and trivia", phrase: "quiz and trivia" },
        { label: "Words", phrase: "word" },
        { label: "Puzzles", phrase: "puzzle" },
        { label: "Arcade", phrase: "arcade" },
      ] },
      { title: "What makes it fun?", answers: [
        { label: "Play together", phrase: "players can play together" },
        { label: "High scores", phrase: "there is a high-score board" },
        { label: "Quick rounds", phrase: "rounds are quick" },
        { label: "Daily challenge", phrase: "there is a new challenge every day" },
      ] },
    ],
    template: (who, about, does) =>
      `Build a ${about} game ${who} where ${does}. Publish it and send me the link so it can be played on a phone.`,
    prompt:
      "Build a fun party quiz game for friends and family that we can play together on our phones. Publish it and send me the link.",
  },
  {
    key: "website",
    title: "Build a website",
    body: "A website for your business, live with its own link.",
    action: "Build my website",
    word: "website",
    questions: [
      { title: "Who is it for?", answers: [
        { label: "Me", phrase: "for me" },
        { label: "My business", phrase: "for my business" },
        { label: "An event", phrase: "for an event" },
        { label: "A project", phrase: "for a project" },
      ] },
      { title: "What kind of site?", answers: [
        { label: "Portfolio", phrase: "a portfolio" },
        { label: "Shop or services", phrase: "a shop or services" },
        { label: "Wedding or party", phrase: "a wedding or party" },
        { label: "Launch page", phrase: "a launch" },
      ] },
      { title: "What should it have?", answers: [
        { label: "Contact form", phrase: "a contact form" },
        { label: "Booking", phrase: "a booking form" },
        { label: "Photo gallery", phrase: "a photo gallery" },
        { label: "Sign-up list", phrase: "a sign-up list" },
      ] },
    ],
    template: (who, about, does) =>
      `Build ${about} website ${who} with ${does}. Publish it and send me the link.`,
    prompt:
      "Build a one-page website for Lumen Yoga Studio with a hero, class schedule, prices and a contact form. Publish it and send me the link.",
  },
  {
    key: "slides",
    title: "Build slides",
    body: "A slide deck for your next pitch or class.",
    action: "Build my slides",
    word: "slides",
    questions: [
      { title: "Who will see it?", answers: [
        { label: "Investors", phrase: "for investors" },
        { label: "A class", phrase: "for a class" },
        { label: "My team", phrase: "for my team" },
        { label: "Friends", phrase: "for friends" },
      ] },
      { title: "What is it about?", answers: [
        { label: "A pitch", phrase: "that pitches an idea" },
        { label: "A lesson", phrase: "that teaches a lesson" },
        { label: "An update", phrase: "that shares an update" },
        { label: "A trip or story", phrase: "that tells the story of a trip" },
      ] },
      { title: "What should it include?", answers: [
        { label: "5 slides", phrase: "a 5-slide deck" },
        { label: "10 slides", phrase: "a 10-slide deck" },
        { label: "Charts", phrase: "a deck with charts" },
        { label: "Speaker notes", phrase: "a deck with speaker notes" },
      ] },
    ],
    template: (who, about, does) =>
      `Make ${does} ${about} ${who}. Publish it as a web page I can open and present from my phone.`,
    prompt:
      "Make a 6-slide pitch deck for Lumen Yoga Studio: problem, offer, classes, pricing, testimonials and a call to action. Publish it as a web page I can open and present from my phone.",
  },
  {
    key: "news",
    title: "Daily Hacker News",
    body: "The top stories of the day, every morning.",
    action: "Start my digest",
    word: "digest",
    questions: [
      { title: "Who reads it?", answers: [
        { label: "Just me", phrase: "for me" },
        { label: "My team", phrase: "for my team" },
        { label: "A founder", phrase: "for a startup founder" },
        { label: "An engineer", phrase: "for a software engineer" },
      ] },
      { title: "Which stories?", answers: [
        { label: "Everything", phrase: "" },
        { label: "AI", phrase: "about AI" },
        { label: "Dev tools", phrase: "about developer tools" },
        { label: "Startups", phrase: "about startups and funding" },
      ] },
      { title: "When should it come?", answers: [
        { label: "Mornings, top 5", phrase: "5|morning" },
        { label: "Mornings, top 10", phrase: "10|morning" },
        { label: "Evenings, top 5", phrase: "5|evening" },
        { label: "Evenings, top 10", phrase: "10|evening" },
      ] },
    ],
    template: (who, about, does) => {
      const [count, when] = does.split("|");
      const topic = about ? ` ${about}` : "";
      return `Make a digest of today's top ${count} Hacker News stories${topic}, one line each on why it matters, written ${who}. Then set it up to run every ${when} and notify me.`;
    },
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

/** The prompt from three picked answers, one index per question. */
export function compose(task: FirstTask, picks: [number, number, number]): string {
  const phrase = (q: number) => task.questions[q].answers[picks[q]]?.phrase ?? task.questions[q].answers[0].phrase;
  return task.template(phrase(0), phrase(1), phrase(2)).replace(/\s+/g, " ").trim();
}

/** The prompt a task card starts. Null for the agents card and unknown keys. */
export function promptFor(key: string | null | undefined): string | null {
  return taskFor(key)?.prompt ?? null;
}

/** The word in "Continue your {word}!" on screen 05. */
export function headlineWord(key: string | null | undefined): string {
  return taskFor(key)?.word ?? FALLBACK_WORD;
}
