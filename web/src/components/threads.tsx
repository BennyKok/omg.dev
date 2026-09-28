import { useMemo, useRef, useState, useEffect, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, ChevronLeft, Plus } from "lucide-react";
import {
  cardMessageIds,
  mentionsOmg,
  TASK_STATE_LABEL,
  taskCardFor,
  threadPreview,
  type TaskCardState,
  type ThreadDetail,
  type ThreadMessage,
  type ThreadSummary,
} from "../../../packages/protocol/src/threads";
import { createThread, sendThreadMessage, updateThread, useThread } from "@/lib/threads";
import { useAsk, SessionQuestionPanel } from "./ask-center";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { cn } from "@/lib/utils";

/**
 * THREADS ON THE WEB. A thread is a chat between people with no agent behind
 * it (src/threads.ts). omg speaks only when someone writes `@omg`: a quick
 * answer, or a task drawn as a card with its live state. This is deliberately
 * not the session chat: no agent face, no model line, no tool rows.
 */

/** The id `/threads/new` carries: an empty thread that exists once it has a first message. */
export const NEW_THREAD_ID = "new";

export function ThreadRailSection({
  threads,
  activeId,
  onOpen,
  onNew,
}: {
  threads: ThreadSummary[];
  activeId: string | null;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <section aria-label="Threads" data-testid="thread-rail" className="mb-2">
      <div className="flex items-center px-2 pb-1 pt-1 text-[11px] font-semibold text-muted-foreground/70">
        <span className="min-w-0 flex-1 truncate">Threads · {threads.length}</span>
        <button
          type="button"
          onClick={onNew}
          aria-label="New thread"
          title="New thread"
          className="flex size-5 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <Plus className="size-3.5" />
        </button>
      </div>
      {threads.map((thread) => (
        <button
          key={thread.id}
          type="button"
          onClick={() => onOpen(thread.id)}
          aria-current={activeId === thread.id ? "page" : undefined}
          className={cn(
            "flex w-full min-w-0 flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left hover:bg-accent/60",
            activeId === thread.id && "bg-accent",
          )}
        >
          <span className="truncate text-[13px] font-medium text-foreground">{thread.title}</span>
          <span className="truncate text-[12px] text-muted-foreground">{threadPreview(thread)}</span>
        </button>
      ))}
    </section>
  );
}

const STATE_TINT: Record<TaskCardState, string> = {
  working: "text-sky-500",
  "needs-you": "text-amber-500",
  done: "text-emerald-500",
  failed: "text-red-500",
  ended: "text-muted-foreground",
};

export function ThreadTaskCard({
  sessionId,
  title,
  project,
  state,
  onOpen,
}: {
  sessionId: string;
  title: string;
  project: string | null;
  state: TaskCardState;
  onOpen?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={`thread-task-${sessionId.slice(0, 8)}`}
      className="flex w-full max-w-md flex-col gap-1.5 rounded-2xl border border-border bg-card px-4 py-3 text-left hover:bg-accent/40"
    >
      <span className="flex items-center gap-2 text-[12px] font-semibold">
        <span className={cn("size-2 rounded-full bg-current", STATE_TINT[state])} />
        <span className={STATE_TINT[state]}>{TASK_STATE_LABEL[state]}</span>
        <span className="flex-1" />
        <span className="font-mono text-[11px] font-normal text-muted-foreground">{sessionId.slice(0, 8)}</span>
      </span>
      <span className="text-[15px] font-semibold text-foreground">{title}</span>
      {project ? <span className="text-[13px] text-muted-foreground">{project}</span> : null}
    </button>
  );
}

function Bubble({ message, mine, showName }: { message: ThreadMessage; mine: boolean; showName: boolean }) {
  const name = message.author.kind === "human" ? message.author.name : "omg";
  if (mine) {
    return (
      <div className="flex justify-end">
        <div className={cn("max-w-[75%] whitespace-pre-wrap rounded-2xl bg-card px-4 py-2 text-[15px]", message.pending && "opacity-60")}>
          {message.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex max-w-[80%] items-end gap-2">
      <div className="w-7 shrink-0">
        {showName ? (
          <div className="flex size-7 items-center justify-center rounded-full bg-muted text-[12px] font-semibold">
            {name.slice(0, 1).toUpperCase()}
          </div>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5">
        {showName ? <span className="pl-3 text-[12px] text-muted-foreground">{name}</span> : null}
        <div className="whitespace-pre-wrap rounded-2xl bg-muted px-4 py-2 text-[15px]">{message.text}</div>
      </div>
    </div>
  );
}

export function ThreadChat({
  threadId,
  repos,
  onCreated,
  onOpenTask,
  onBack,
  viewer,
}: {
  /** The profile picked in this browser, for a box that cannot tell who is writing. */
  viewer?: string | null;
  /** A thread id, or NEW_THREAD_ID for an empty one. */
  threadId: string;
  repos: ReadonlyArray<{ name: string; cwd: string }>;
  /** A new thread got its first message and now exists. */
  onCreated: (id: string) => void;
  onOpenTask: (sessionId: string) => void;
  onBack?: () => void;
}) {
  const isNew = threadId === NEW_THREAD_ID;
  const { detail, refresh } = useThread(isNew ? null : threadId, viewer);
  const { questions } = useAsk();
  const taskIds = useMemo(() => (detail?.tasks ?? []).map((task) => task.sessionId), [detail?.tasks]);
  return (
    <ThreadChatView
      threadId={threadId}
      detail={isNew ? null : detail}
      repos={repos}
      openAskSessionIds={questions.map((q) => q.sessionId)}
      questionPanel={taskIds.length ? <SessionQuestionPanel sessionIds={taskIds} /> : null}
      send={async (text) => {
        if (isNew) {
          onCreated((await createThread(text, viewer)).id);
          return;
        }
        await sendThreadMessage(threadId, text, viewer);
        await refresh();
      }}
      setProject={async (cwd) => {
        await updateThread(threadId, { projectCwd: cwd });
        await refresh();
      }}
      onOpenTask={onOpenTask}
      onBack={onBack}
    />
  );
}

/** The thread as drawn. Data in, actions out; ThreadChat above does the loading. */
export function ThreadChatView({
  threadId,
  detail,
  repos,
  openAskSessionIds,
  questionPanel,
  send: deliver,
  setProject: saveProject,
  onOpenTask,
  onBack,
}: {
  threadId: string;
  detail: ThreadDetail | null;
  repos: ReadonlyArray<{ name: string; cwd: string }>;
  /** Tasks with a question waiting on a person. */
  openAskSessionIds: ReadonlyArray<string | null | undefined>;
  /** The open questions from this thread's tasks, drawn above the composer. */
  questionPanel?: ReactNode;
  send: (text: string) => Promise<void>;
  setProject: (cwd: string | null) => Promise<void>;
  onOpenTask: (sessionId: string) => void;
  onBack?: () => void;
}) {
  const isNew = threadId === NEW_THREAD_ID;
  const [text, setText] = useState("");
  const [pending, setPending] = useState<ThreadMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPending([]);
    setText("");
    setError(null);
  }, [threadId]);

  const messages = useMemo(() => {
    const stored = detail?.messages ?? [];
    return [...stored, ...pending.filter((row) => !stored.some((m) => m.author.kind === "human" && m.text === row.text))];
  }, [detail?.messages, pending]);
  const cards = useMemo(() => cardMessageIds(messages), [messages]);
  const openAskIds = openAskSessionIds;
  const people = (detail?.participants ?? [])
    .filter((row) => row.kind === "human")
    .map((row) => row.display.name?.trim() || row.display.fallback);
  const project = detail?.thread.project ?? null;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    setText("");
    if (!isNew) {
      setPending((rows) => [
        ...rows,
        { id: `local-${Date.now()}`, threadId, ts: Date.now(), author: { kind: "human", participantId: detail?.me ?? "", name: "You" }, text: body, pending: true },
      ]);
    }
    try {
      await deliver(body);
    } catch (e) {
      setText(body);
      setPending((rows) => rows.filter((row) => row.text !== body));
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };

  const setProject = (cwd: string | null) => {
    if (isNew) return;
    void saveProject(cwd).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  return (
    <div data-testid="thread-chat" className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-background">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        {onBack ? (
          <button type="button" onClick={onBack} aria-label="Back" className="flex size-8 items-center justify-center rounded-lg hover:bg-accent">
            <ChevronLeft className="size-4" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{isNew ? "New thread" : detail?.thread.title ?? "Thread"}</div>
          <div className="truncate text-[12px] text-muted-foreground">
            {isNew ? "Chat · @omg for help or a task" : people.length ? people.join(", ") : "Just you"}
          </div>
        </div>
        {isNew ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label={`Project: ${project?.name ?? "No project"}. Change`}
                  className="max-w-40 truncate rounded-full bg-muted px-3 py-1 text-[12px] hover:bg-accent"
                >
                  {project?.name ?? "No project"}
                </button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Tasks run in</DropdownMenuLabel>
              {repos.map((repo) => (
                <DropdownMenuItem key={repo.cwd} onClick={() => setProject(repo.cwd)}>
                  {repo.name}
                  {project?.cwd === repo.cwd ? " ✓" : ""}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onClick={() => setProject(null)}>No project{project ? "" : " ✓"}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto flex max-w-3xl flex-col gap-1.5">
          {isNew || (detail && !messages.length) ? (
            <div className="py-10">
              <div className="text-[22px] font-bold">What is on your mind?</div>
              <p className="mt-2 text-[15px] text-muted-foreground">
                Talk it through here. Write @omg when you want omg to answer or start a task.
              </p>
            </div>
          ) : null}
          {messages.map((message, index) => {
            const previous = messages[index - 1];
            const sameAuthor =
              !!previous &&
              previous.author.kind === message.author.kind &&
              (message.author.kind === "omg" ||
                (previous.author.kind === "human" && previous.author.participantId === message.author.participantId));
            if (message.author.kind === "omg") {
              const card = cards.has(message.id) && detail ? taskCardFor(message, detail, messages, openAskIds) : null;
              return (
                <div key={message.id} className={cn("flex flex-col gap-2", !sameAuthor && "pt-2")}>
                  {sameAuthor ? null : <span className="text-[12px] font-semibold text-[#FF5530]">omg</span>}
                  <div className="whitespace-pre-wrap text-[15px]">{message.text}</div>
                  {card ? <ThreadTaskCard {...card} onOpen={() => onOpenTask(card.sessionId)} /> : null}
                </div>
              );
            }
            const mine = message.author.participantId === detail?.me || !!message.pending;
            return (
              <div key={message.id} className={cn(!sameAuthor && "pt-2")}>
                <Bubble message={message} mine={mine} showName={!sameAuthor} />
              </div>
            );
          })}
          <div ref={endRef} />
        </div>
      </div>

      {questionPanel}

      <div className="border-t border-border px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-3xl border border-border bg-card px-4 py-2">
          <textarea
            data-testid="thread-input"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Message, or @omg to ask omg"
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[15px] outline-none placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={!text.trim() || sending}
            aria-label="Send"
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background disabled:bg-muted disabled:text-muted-foreground"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
        {text && mentionsOmg(text) ? (
          <p className="mx-auto mt-1 max-w-3xl text-[12px] text-muted-foreground">omg will answer, or start a task if this needs real work.</p>
        ) : null}
        {error ? <p className="mx-auto mt-1 max-w-3xl text-[12px] text-destructive">{error}</p> : null}
      </div>
    </div>
  );
}
