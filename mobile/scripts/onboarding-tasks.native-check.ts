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
