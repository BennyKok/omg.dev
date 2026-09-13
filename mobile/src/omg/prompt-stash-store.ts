/** Local prompt recovery. One serialized writer per account and Computer. */
export type StashEntry = {
  id: string;
  context: string;
  text: string;
  title: string;
  sessionId?: string;
  botId?: string;
  cwd?: string;
  status: "draft" | "sending" | "sent" | "failed";
  updatedAt: number;
};
export type DraftContext = Pick<
  StashEntry,
  "context" | "title" | "sessionId" | "botId" | "cwd"
>;
type Storage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
};
export function stashScope(
  user: string | null | undefined,
  computer: string | null | undefined,
) {
  return JSON.stringify([user ?? "signed-out", computer ?? "no-computer"]);
}
export function createPromptStash(storage: Storage, scope: string) {
  const key = `omg.prompt-stash.v1:${scope}`;
  let entries: StashEntry[] = [];
  let loaded = false;
  let serial = 0;
  const edited = new Set<string>();
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((fn) => fn());
  const sort = () => {
    entries = entries.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 80);
  };
  const ready = storage
    .getItem(key)
    .then((raw) => {
      let saved: StashEntry[] = [];
      try {
        const parsed: unknown = JSON.parse(raw ?? "[]");
        if (Array.isArray(parsed))
          saved = parsed.filter(
            (v): v is StashEntry =>
              v &&
              typeof v.id === "string" &&
              typeof v.context === "string" &&
              typeof v.text === "string" &&
              typeof v.title === "string" &&
              typeof v.updatedAt === "number" &&
              ["draft", "sending", "sent", "failed"].includes(v.status),
          );
      } catch {
        /* A corrupt cache must not block typing. */
      }
      entries = [
        ...entries,
        ...saved
          .filter((e) => !edited.has(e.context))
          .map((e) =>
            e.status === "sending" ? { ...e, status: "failed" as const } : e,
          ),
      ];
      sort();
    })
    .catch(() => {})
    .finally(() => {
      loaded = true;
      emit();
    });
  let writes = ready;
  const changed = (context: string) => {
    if (!loaded) edited.add(context);
    sort();
    emit();
    writes = writes
      .then(() => storage.setItem(key, JSON.stringify(entries)))
      .then(() => {})
      .catch(() => {});
  };
  const draft = (context: string) =>
    entries.find((e) => e.context === context && e.status === "draft") ??
    entries.find((e) => e.context === context && e.status === "failed");
  const save = (
    context: DraftContext,
    text: string,
    status: StashEntry["status"],
  ) => {
    const candidate = draft(context.context);
    const old =
      status === "sending" && candidate?.text !== text ? undefined : candidate;
    entries = entries.filter(
      (e) =>
        e.context !== context.context ||
        (e.status !== "draft" && e.status !== "failed") ||
        (status === "sending" && e.id !== old?.id),
    );
    const entry: StashEntry = {
      ...context,
      id:
        old?.id ??
        `${Date.now()}-${++serial}-${Math.random().toString(36).slice(2)}`,
      text,
      status,
      updatedAt: Date.now(),
    };
    if (text.trim()) entries = [entry, ...entries];
    changed(context.context);
    return entry.id;
  };
  return {
    ready,
    flush: () => writes,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    snapshot: () => entries,
    text: (context: string) => draft(context)?.text ?? "",
    set: (context: DraftContext, text: string) => save(context, text, "draft"),
    stage: (context: DraftContext, text: string) =>
      save(context, text, "sending"),
    finish(id: string, status: "sent" | "failed") {
      const entry = entries.find((e) => e.id === id);
      if (!entry) return;
      entries = entries.map((e) =>
        e.id === id ? { ...e, status, updatedAt: Date.now() } : e,
      );
      changed(entry.context);
    },
    remove(id: string) {
      const entry = entries.find((e) => e.id === id);
      if (!entry) return;
      entries = entries.filter((e) => e.id !== id);
      changed(entry.context);
    },
  };
}
