/**
 * The first-task cards. Picking a task card STARTS it, unedited, so the rules
 * here are about what gets sent without anyone reading it first.
 */
import { expect, test } from "bun:test";
import {
  AGENTS_CARD,
  FALLBACK_WORD,
  FIRST_CARDS,
  FIRST_TASKS,
  headlineWord,
  promptFor,
  compose,
} from "../src/omg/onboarding-tasks";

test("the cards are the five tasks, then the agents card, and no email", () => {
  expect(FIRST_CARDS.map((c) => c.key)).toEqual(["app", "game", "website", "slides", "news", "agents"]);
  for (const card of FIRST_CARDS) expect(`${card.title} ${card.body}`.toLowerCase()).not.toContain("email");
});

test("every task starts a prompt that ends with something to open", () => {
  for (const task of FIRST_TASKS) {
    expect(promptFor(task.key)).toBe(task.prompt);
    expect(task.prompt.trim().endsWith(".")).toBe(true);
    expect(/link|preview|web page|notify/.test(task.prompt)).toBe(true);
  }
});

test("the agents card is not a task: it starts nothing", () => {
  expect(promptFor(AGENTS_CARD.key)).toBeNull();
});

test("keys are unique, because a pick is remembered by one", () => {
  const keys = FIRST_CARDS.map((c) => c.key);
  expect(new Set(keys).size).toBe(keys.length);
});

test("the continue screen's word comes from the task, with a fallback", () => {
  expect(headlineWord("website")).toBe("website");
  expect(headlineWord("design")).toBe(FALLBACK_WORD);
  expect(headlineWord(null)).toBe(FALLBACK_WORD);
});

test("no prompt promises anything free", () => {
  for (const task of FIRST_TASKS) {
    expect(task.prompt.toLowerCase()).not.toContain("free");
    expect(task.prompt.toLowerCase()).not.toContain("on us");
  }
});

test("every task asks three questions, each with four or five short answers", () => {
  for (const task of FIRST_TASKS) {
    expect(task.questions).toHaveLength(3);
    for (const q of task.questions) {
      expect(q.answers.length).toBeGreaterThanOrEqual(4);
      expect(q.answers.length).toBeLessThanOrEqual(5);
      // Two lines inside a square at 22 pt: longer labels got cut off.
      for (const a of q.answers) expect(a.label.length).toBeLessThanOrEqual(18);
    }
  }
});

test("the answers are built into the prompt", () => {
  const app = FIRST_TASKS.find((t) => t.key === "app")!;
  expect(compose(app, [1, 1, 2])).toBe(
    "Build a mobile app for my friends about food and recipes that lets people share with each other. Make it an Expo app and send me an Expo Go link as soon as the first screen works.",
  );
  const news = FIRST_TASKS.find((t) => t.key === "news")!;
  expect(compose(news, [0, 1, 1])).toContain("top 10 Hacker News stories about AI");
  expect(compose(news, [0, 1, 1])).toContain("every morning");
  for (const task of FIRST_TASKS) expect(compose(task, [0, 0, 0])).not.toMatch(/\s{2}|undefined/);
});
