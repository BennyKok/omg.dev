// The shared to-do list: the Dashboard's To-do tab (/api/todos, omg_todo).
//
// One list for everyone on the box and its agents. Type and press Enter to
// add; tick to finish; the x removes. Polls so items an agent or a teammate
// adds show up without a reload.
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { api } from "@/lib/omg-client";
import { toast } from "@/lib/notify";
import { timeAgo } from "@/lib/session-ui";
import { cn } from "@/lib/utils";

export type Todo = {
  id: string;
  text: string;
  done: boolean;
  by?: string;
  createdAt: number;
  doneAt?: number;
  doneBy?: string;
};

type TodoPayload = { updatedAt: number; items: Todo[] };

const viewer = () => {
  try {
    return localStorage.getItem("lfg_user") ?? undefined;
  } catch {
    return undefined;
  }
};

/** "ana@example.com" → "ana"; "agent 1a2b3c4d" stays as it is. */
const shortName = (by?: string) => (by ? by.split("@")[0] : "");

export default function TodoPanel({ active = true }: { active?: boolean }) {
  const [items, setItems] = useState<Todo[] | null>(null);
  const [draft, setDraft] = useState("");
  const [showDone, setShowDone] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const next = await api<TodoPayload>("/api/todos", { cache: "no-store" });
      setItems(next.items);
    } catch {
      // Keep what is on screen if a background poll fails.
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    void load();
    const t = setInterval(() => void load(), 5_000);
    return () => clearInterval(t);
  }, [active, load]);

  const send = async (path: string, init: RequestInit) => {
    try {
      const res = await api<TodoPayload>(path, {
        ...init,
        headers: { "Content-Type": "application/json" },
      });
      setItems(res.items);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update the list");
      void load();
    }
  };

  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await send("/api/todos", { method: "POST", body: JSON.stringify({ text, by: viewer() }) });
    inputRef.current?.focus();
  };

  const toggle = (todo: Todo) => {
    // Move it at once; the server answer replaces this.
    setItems((cur) => cur?.map((t) => (t.id === todo.id ? { ...t, done: !t.done } : t)) ?? cur);
    void send(`/api/todos/${todo.id}`, {
      method: "PATCH",
      body: JSON.stringify({ done: !todo.done, by: viewer() }),
    });
  };

  const remove = (todo: Todo) => {
    setItems((cur) => cur?.filter((t) => t.id !== todo.id) ?? cur);
    void send(`/api/todos/${todo.id}`, { method: "DELETE" });
  };

  const open = items?.filter((t) => !t.done) ?? [];
  const done = items?.filter((t) => t.done) ?? [];

  return (
    <div className="space-y-3" data-testid="todo-panel">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
        className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2 focus-within:ring-2 focus-within:ring-primary/30"
      >
        <Plus className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          data-testid="todo-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={280}
          placeholder="Add a to-do"
          aria-label="Add a to-do"
          className="h-8 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
          {open.length}
        </span>
      </form>

      {items === null ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          {open.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">All clear</div>
          ) : (
            <ul className="divide-y">
              {open.map((todo) => (
                <TodoRow key={todo.id} todo={todo} onToggle={toggle} onRemove={remove} />
              ))}
            </ul>
          )}
          {done.length ? (
            <>
              <button
                type="button"
                data-testid="todo-show-done"
                onClick={() => setShowDone((v) => !v)}
                className="flex w-full items-center gap-2 border-t px-4 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <Check className="size-3.5 text-success" />
                Done · {done.length}
              </button>
              {showDone ? (
                <ul className="divide-y border-t">
                  {done.map((todo) => (
                    <TodoRow key={todo.id} todo={todo} onToggle={toggle} onRemove={remove} />
                  ))}
                </ul>
              ) : null}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

function TodoRow({
  todo,
  onToggle,
  onRemove,
}: {
  todo: Todo;
  onToggle: (todo: Todo) => void;
  onRemove: (todo: Todo) => void;
}) {
  const who = shortName(todo.done ? todo.doneBy ?? todo.by : todo.by);
  return (
    <li className="group flex items-center gap-3 px-4 py-2.5" data-testid={`todo-${todo.id}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={todo.done}
        aria-label={todo.done ? "Mark not done" : "Mark done"}
        onClick={() => onToggle(todo)}
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
          todo.done ? "border-success bg-success text-background" : "hover:border-primary",
        )}
      >
        {todo.done ? <Check className="size-3" /> : null}
      </button>
      <span
        className={cn(
          "min-w-0 flex-1 break-words text-sm",
          todo.done && "text-muted-foreground line-through",
        )}
      >
        {todo.text}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {who ? `${who} · ` : ""}
        {timeAgo(todo.done ? todo.doneAt ?? todo.createdAt : todo.createdAt)}
      </span>
      <button
        type="button"
        aria-label="Remove"
        onClick={() => onRemove(todo)}
        className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100 max-md:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </li>
  );
}
