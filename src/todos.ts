// The shared to-do list (/dashboard "To-do" tab, /api/todos, omg_todo).
//
// One list per box, seen by every person on the box and by its agents, so the
// team keeps its next steps in one place. Single owner for the state:
// `<data>/todos.json` (mode 600, written atomically).
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { PATHS } from "./config.ts";

export type Todo = {
  id: string;
  text: string;
  done: boolean;
  /** Who added it: a person's login, or "agent" with a session prefix. */
  by?: string;
  createdAt: number;
  doneAt?: number;
  doneBy?: string;
};

type TodoStore = { version: 1; updatedAt: number; items: Todo[] };

export const TODO_LIMITS = { text: 280, by: 80, items: 500 } as const;

export class TodoInputError extends Error {}

let fileOverride: string | null = null;
/** Tests point the store at a scratch file. */
export function setTodoFileForTests(path: string | null): void {
  fileOverride = path;
}
const todoFile = () => fileOverride ?? join(PATHS.data, "todos.json");

const clean = (value: unknown, max: number): string => {
  const s = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return s.length > max ? s.slice(0, max) : s;
};

function read(): TodoStore {
  try {
    const raw = JSON.parse(readFileSync(todoFile(), "utf8")) as Partial<TodoStore>;
    const items = Array.isArray(raw.items)
      ? raw.items.filter(
          (t): t is Todo =>
            !!t && typeof t === "object" && typeof t.id === "string" && typeof t.text === "string",
        )
      : [];
    return { version: 1, updatedAt: Number(raw.updatedAt) || 0, items };
  } catch {
    return { version: 1, updatedAt: 0, items: [] };
  }
}

function write(store: TodoStore): void {
  const path = todoFile();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
}

/** Open items first (newest on top), then done items (most recently done first). */
export function listTodos(): { updatedAt: number; items: Todo[] } {
  const store = read();
  // Reversed first, so items added in the same millisecond keep newest-on-top.
  store.items.reverse();
  const open = store.items.filter((t) => !t.done).sort((a, b) => b.createdAt - a.createdAt);
  const done = store.items
    .filter((t) => t.done)
    .sort((a, b) => (b.doneAt ?? b.createdAt) - (a.doneAt ?? a.createdAt));
  return { updatedAt: store.updatedAt, items: [...open, ...done] };
}

export function addTodo(text: unknown, by?: string): Todo {
  const body = clean(text, TODO_LIMITS.text);
  if (!body) throw new TodoInputError("text is required");
  const store = read();
  if (store.items.length >= TODO_LIMITS.items) {
    // Make room by dropping the oldest finished item; refuse only when all are open.
    const doneIdx = store.items
      .map((t, i) => [t, i] as const)
      .filter(([t]) => t.done)
      .sort(([a], [b]) => (a.doneAt ?? a.createdAt) - (b.doneAt ?? b.createdAt))[0]?.[1];
    if (doneIdx === undefined) throw new TodoInputError(`at most ${TODO_LIMITS.items} open items`);
    store.items.splice(doneIdx, 1);
  }
  const todo: Todo = { id: randomUUID().slice(0, 8), text: body, done: false, createdAt: Date.now() };
  const who = clean(by, TODO_LIMITS.by);
  if (who) todo.by = who;
  store.items.push(todo);
  store.updatedAt = Date.now();
  write(store);
  return todo;
}

export function updateTodo(id: string, patch: { done?: unknown; text?: unknown }, by?: string): Todo {
  const store = read();
  const todo = store.items.find((t) => t.id === id);
  if (!todo) throw new TodoInputError("no such item");
  if (patch.text !== undefined) {
    const body = clean(patch.text, TODO_LIMITS.text);
    if (!body) throw new TodoInputError("text is required");
    todo.text = body;
  }
  if (typeof patch.done === "boolean" && patch.done !== todo.done) {
    todo.done = patch.done;
    if (patch.done) {
      todo.doneAt = Date.now();
      const who = clean(by, TODO_LIMITS.by);
      if (who) todo.doneBy = who;
      else delete todo.doneBy;
    } else {
      delete todo.doneAt;
      delete todo.doneBy;
    }
  }
  store.updatedAt = Date.now();
  write(store);
  return todo;
}

export function deleteTodo(id: string): boolean {
  const store = read();
  const before = store.items.length;
  store.items = store.items.filter((t) => t.id !== id);
  if (store.items.length === before) return false;
  store.updatedAt = Date.now();
  write(store);
  return true;
}
