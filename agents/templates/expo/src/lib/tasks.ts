import { Platform } from "react-native";

export type Task = {
  id: string;
  title: string;
  done: boolean;
  created_at?: string;
  updated_at?: string;
};

function apiOrigin(): string {
  const configured = process.env.EXPO_PUBLIC_OMG_API_URL?.replace(/\/$/, "");
  if (configured) return configured;
  if (Platform.OS === "web" && typeof window !== "undefined") return window.location.origin;
  throw new Error("Set EXPO_PUBLIC_OMG_API_URL to your omg.dev app URL.");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiOrigin()}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) throw new Error(`Database request failed (${response.status}).`);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const tasksApi = {
  list: () => request<Task[]>("/api/tasks"),
  create: (title: string) => request<Task>("/api/tasks", {
    method: "POST",
    body: JSON.stringify({ title, done: false }),
  }),
  update: (id: string, patch: Partial<Pick<Task, "title" | "done">>) => request<Task>(`/api/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  }),
  remove: (id: string) => request<void>(`/api/tasks/${id}`, { method: "DELETE" }),
};
