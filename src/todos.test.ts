import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TODO_LIMITS, TodoInputError, addTodo, deleteTodo, listTodos, setTodoFileForTests, updateTodo } from "./todos.ts";

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "todos-"));
  setTodoFileForTests(join(dir, "todos.json"));
});
afterEach(() => {
  setTodoFileForTests(null);
  rmSync(dir, { recursive: true, force: true });
});

test("add, tick, untick and remove, with who did it", () => {
  const a = addTodo("  ship   the board ", "ana@example.com");
  expect(a.text).toBe("ship the board");
  expect(a.by).toBe("ana@example.com");
  expect(statSync(join(dir, "todos.json")).mode & 0o777).toBe(0o600);

  const b = addTodo("try tinyfix");
  expect(listTodos().items.map((t) => t.id)).toEqual([b.id, a.id]);

  const done = updateTodo(a.id, { done: true }, "agent 1a2b3c4d");
  expect(done.done).toBe(true);
  expect(done.doneBy).toBe("agent 1a2b3c4d");
  expect(listTodos().items.at(-1)?.id).toBe(a.id); // done items sink

  const undone = updateTodo(a.id, { done: false });
  expect(undone.doneAt).toBeUndefined();
  expect(undone.doneBy).toBeUndefined();

  expect(updateTodo(b.id, { text: "try tinyfix offline" }).text).toBe("try tinyfix offline");
  expect(deleteTodo(b.id)).toBe(true);
  expect(deleteTodo(b.id)).toBe(false);
  expect(listTodos().items).toHaveLength(1);
});

test("rejects empty text and unknown ids, caps length", () => {
  expect(() => addTodo("   ")).toThrow(TodoInputError);
  expect(() => updateTodo("nope", { done: true })).toThrow(TodoInputError);
  expect(addTodo("x".repeat(1000)).text).toHaveLength(TODO_LIMITS.text);
});

test("a full list drops the oldest finished item, never an open one", () => {
  const first = addTodo("first");
  updateTodo(first.id, { done: true });
  for (let i = 1; i < TODO_LIMITS.items; i++) addTodo(`item ${i}`);
  addTodo("one more");
  const items = listTodos().items;
  expect(items).toHaveLength(TODO_LIMITS.items);
  expect(items.some((t) => t.id === first.id)).toBe(false);
  expect(() => addTodo("over")).toThrow(TodoInputError);
});
