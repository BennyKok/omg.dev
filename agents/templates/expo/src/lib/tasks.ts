// The app's data, stored on the phone (AsyncStorage; localStorage on the web).
//
// This is the default for an omg.dev Expo app: it works in Expo Go and in the
// web preview at once, with no backend, no deploy and no sign-in. Keep this
// file and extend it, or copy its shape for each new kind of item.
//
// Shared or synced data needs a signed-in user: use @omg-dev/sdk with sign-in
// and a `.scoped("user")` collection in schema.ts. Never call `/api/...` with
// a raw fetch; a hosted collection answers an anonymous phone with 401.
import AsyncStorage from "@react-native-async-storage/async-storage";

export type Task = {
  id: string;
  title: string;
  done: boolean;
  created_at: string;
  updated_at: string;
};

const KEY = "__OMG_PROJECT_SLUG__:tasks";

async function read(): Promise<Task[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as Task[]) : [];
  } catch {
    return [];
  }
}

async function write(tasks: Task[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(tasks));
}

function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export const tasksApi = {
  /** Newest first. */
  list: async (): Promise<Task[]> =>
    (await read()).sort((a, b) => b.created_at.localeCompare(a.created_at)),
  create: async (title: string): Promise<Task> => {
    const now = new Date().toISOString();
    const task: Task = { id: newId(), title, done: false, created_at: now, updated_at: now };
    await write([task, ...(await read())]);
    return task;
  },
  update: async (id: string, patch: Partial<Pick<Task, "title" | "done">>): Promise<Task> => {
    const tasks = await read();
    const index = tasks.findIndex((task) => task.id === id);
    if (index < 0) throw new Error("That item no longer exists.");
    const next = { ...tasks[index]!, ...patch, updated_at: new Date().toISOString() };
    tasks[index] = next;
    await write(tasks);
    return next;
  },
  remove: async (id: string): Promise<void> => {
    await write((await read()).filter((task) => task.id !== id));
  },
};
