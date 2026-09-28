import { useMemo, useRef, useState, useEffect, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, ChevronLeft, MessageSquare, Plus, X } from "lucide-react";
import {
  authorHue,
  authorName,
  cardMessageIds,
  mentionsOmg,
  replySummary,
  repliesTo,
  startsMessageGroup,
  TASK_STATE_LABEL,
  taskCardFor,
  threadPreview,
  topLevelMessages,
  type TaskCardState,
  type ThreadAuthor,
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
 * THREADS ON THE WEB, laid out like Slack. A thread is a chat between people
 * with no agent behind it (src/threads.ts). Every message sits on the left
 * under its author's avatar, name and time. omg speaks only when someone
 * writes `@omg`, and always in the REPLIES of that message, so the main
 * conversation stays the people's. A task omg starts, and every update it
 * posts, live in those replies too; the main list shows "N replies" with the
 * task's state. This is deliberately not the session chat: no agent face, no
 * model line, no tool rows.
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

const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function Avatar({ author, size = 36 }: { author: ThreadAuthor; size?: number }) {
  const omg = author.kind === "omg";
  return (
    <div
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-lg text-[13px] font-bold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size < 30 ? 10 : 14,
        background: omg ? "#FF5530" : `hsl(${authorHue(author)} 45% 45%)`,
      }}
    >
      {/* "omg" does not fit a reply-line avatar; its first letter does. */}
      {omg ? (size < 28 ? "o" : "omg") : authorName(author).slice(0, 1).toUpperCase()}
    </div>
  );
}

/** One message, Slack style: avatar and name only at the start of a group. */
function MessageRow({
  message,
  first,
  children,
}: {
  message: ThreadMessage;
  first: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      data-testid="thread-message"
      className={cn("group flex gap-2.5 rounded-md px-2 py-0.5 hover:bg-muted/40", first && "mt-2 pt-1.5")}
    >
      <div className="w-9 shrink-0">{first ? <Avatar author={message.author} /> : null}</div>
      <div className="min-w-0 flex-1">
        {first ? (
          <div className="flex items-baseline gap-2">
            <span className={cn("text-[15px] font-bold", message.author.kind === "omg" && "text-[#FF5530]")}>
              {authorName(message.author)}
            </span>
            <span className="text-[12px] text-muted-foreground">{TIME.format(message.ts)}</span>
          </div>
        ) : null}
        <div className={cn("whitespace-pre-wrap break-words text-[15px] leading-[22px]", message.pending && "opacity-60")}>
          {message.text}
        </div>
        {children}
      </div>
    </div>
  );
}

function Composer({
  placeholder,
  onSend,
  autoFocus,
  testId,
}: {
  placeholder: string;
  onSend: (text: string) => Promise<void>;
  autoFocus?: boolean;
  testId: string;
}) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    setText("");
    try {
      await onSend(body);
    } catch (e) {
      setText(body);
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
  return (
    <div className="border-t border-border px-4 py-3">
      <div className="flex items-end gap-2 rounded-xl border border-border bg-card px-3 py-2">
        <textarea
          data-testid={testId}
          value={text}
          autoFocus={autoFocus}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={placeholder}
          className="max-h-40 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-[15px] outline-none placeholder:text-muted-foreground"
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={!text.trim() || sending}
          aria-label="Send"
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-foreground text-background disabled:bg-muted disabled:text-muted-foreground"
        >
          <ArrowUp className="size-4" />
        </button>
      </div>
      {text && mentionsOmg(text) ? (
        <p className="mt-1 text-[12px] text-muted-foreground">omg will answer in the replies, or start a task there.</p>
      ) : null}
      {error ? <p className="mt-1 text-[12px] text-destructive">{error}</p> : null}
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
  return (
    <ThreadChatView
      threadId={threadId}
      detail={isNew ? null : detail}
      repos={repos}
      openAskSessionIds={questions.map((q) => q.sessionId)}
      questionPanel={(sessionIds) => (sessionIds.length ? <SessionQuestionPanel sessionIds={sessionIds} /> : null)}
      send={async (text, replyTo) => {
        if (isNew) {
          onCreated((await createThread(text, viewer)).id);
          return null;
        }
        const message = await sendThreadMessage(threadId, text, viewer, replyTo);
        await refresh();
        return message;
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
  send,
  setProject: saveProject,
  onOpenTask,
  onBack,
}: {
  threadId: string;
  detail: ThreadDetail | null;
  repos: ReadonlyArray<{ name: string; cwd: string }>;
  /** Tasks with a question waiting on a person. */
  openAskSessionIds: ReadonlyArray<string | null | undefined>;
  /** The open questions from these tasks, drawn in their replies. */
  questionPanel?: (sessionIds: string[]) => ReactNode;
  /** Post a message, top-level or in a message's replies. */
  send: (text: string, replyTo: string | null) => Promise<ThreadMessage | null>;
  setProject: (cwd: string | null) => Promise<void>;
  onOpenTask: (sessionId: string) => void;
  onBack?: () => void;
}) {
  const isNew = threadId === NEW_THREAD_ID;
  const [pending, setPending] = useState<ThreadMessage[]>([]);
  const [openRoot, setOpenRoot] = useState<string | null>(null);
  // The message just posted, until the next load lists it: its replies can
  // open at once.
  const [rootHint, setRootHint] = useState<ThreadMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPending([]);
    setOpenRoot(null);
    setError(null);
  }, [threadId]);

  const messages = useMemo(() => {
    const stored = detail?.messages ?? [];
    return [...stored, ...pending.filter((row) => !stored.some((m) => m.author.kind === "human" && m.text === row.text))];
  }, [detail?.messages, pending]);
  const top = useMemo(() => topLevelMessages(messages), [messages]);
  const cards = useMemo(() => cardMessageIds(messages), [messages]);
  const people = (detail?.participants ?? [])
    .filter((row) => row.kind === "human")
    .map((row) => row.display.name?.trim() || row.display.fallback);
  const project = detail?.thread.project ?? null;
  const root = openRoot
    ? messages.find((m) => m.id === openRoot) ?? (rootHint?.id === openRoot ? rootHint : null)
    : null;
  const replies = useMemo(() => (openRoot ? repliesTo(messages, openRoot) : []), [messages, openRoot]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [top.length]);

  const post = async (text: string, replyTo: string | null) => {
    if (!isNew) {
      setPending((rows) => [
        ...rows,
        {
          id: `local-${Date.now()}`,
          threadId,
          ts: Date.now(),
          author: { kind: "human", participantId: detail?.me ?? "", name: "You" },
          text,
          pending: true,
          replyTo,
        },
      ]);
    }
    try {
      const message = await send(text, replyTo);
      // Asking omg at the top level opens the replies it will answer in.
      if (message && !replyTo && mentionsOmg(text)) {
        setRootHint(message);
        setOpenRoot(message.id);
      }
    } catch (e) {
      setPending((rows) => rows.filter((row) => row.text !== text));
      throw e;
    }
  };

  const setProject = (cwd: string | null) => {
    if (isNew) return;
    void saveProject(cwd).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  const card = (message: ThreadMessage) => {
    const c = cards.has(message.id) && detail ? taskCardFor(message, detail, messages, openAskSessionIds) : null;
    return c ? (
      <div className="mt-2">
        <ThreadTaskCard {...c} onOpen={() => onOpenTask(c.sessionId)} />
      </div>
    ) : null;
  };

  const repliesLine = (message: ThreadMessage) => {
    const summary = replySummary(messages, message.id);
    if (!summary) return null;
    const taskCard = summary.taskSessionId && detail
      ? taskCardFor(
          messages.find((m) => m.task?.sessionId === summary.taskSessionId && cards.has(m.id)) ?? message,
          detail,
          messages,
          openAskSessionIds,
        )
      : null;
    return (
      <button
        type="button"
        onClick={() => setOpenRoot(message.id)}
        data-testid="thread-replies-link"
        className="mt-1 flex items-center gap-2 rounded-md px-1 py-0.5 text-[13px] hover:bg-muted"
      >
        <span className="flex -space-x-1">
          {summary.authors.slice(0, 3).map((author, index) => (
            <Avatar key={index} author={author} size={20} />
          ))}
        </span>
        <span className="font-semibold text-sky-600 dark:text-sky-400">
          {summary.count} {summary.count === 1 ? "reply" : "replies"}
        </span>
        {taskCard ? (
          <span className={cn("text-[12px] font-semibold", STATE_TINT[taskCard.state])}>· {TASK_STATE_LABEL[taskCard.state]}</span>
        ) : null}
        <span className="text-[12px] text-muted-foreground">Last reply {TIME.format(summary.lastTs)}</span>
      </button>
    );
  };

  const main = (
    <div data-testid="thread-chat" className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-background">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        {onBack ? (
          <button type="button" onClick={onBack} aria-label="Back" className="flex size-8 items-center justify-center rounded-lg hover:bg-accent">
            <ChevronLeft className="size-4" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">{isNew ? "New thread" : detail?.thread.title ?? "Thread"}</div>
          {isNew ? null : (
            <div className="truncate text-[12px] text-muted-foreground">
              {people.length ? people.join(", ") : "Just you"}
            </div>
          )}
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

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {isNew || (detail && !top.length) ? (
          <div className="px-2 py-10">
            <div className="text-[22px] font-bold">What is on your mind?</div>
          </div>
        ) : null}
        {top.map((message, index) => (
          <MessageRow key={message.id} message={message} first={startsMessageGroup(top[index - 1], message)}>
            {card(message)}
            {repliesLine(message)}
          </MessageRow>
        ))}
        <div ref={endRef} />
      </div>
      {error ? <p className="px-4 text-[12px] text-destructive">{error}</p> : null}
      <Composer
        testId="thread-input"
        placeholder={isNew ? "Message" : `Message ${detail?.thread.title ?? "the thread"}`}
        onSend={(text) => post(text, null)}
        autoFocus={isNew}
      />
    </div>
  );

  if (!root) return main;
  const replyTasks = replies.flatMap((reply) => (reply.task ? [reply.task.sessionId] : []));
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1">
      <div className="hidden min-w-0 flex-1 md:flex">{main}</div>
      <aside
        data-testid="thread-replies"
        aria-label="Replies"
        className="flex h-full min-h-0 w-full min-w-0 flex-col border-l border-border bg-background md:w-[400px] md:shrink-0"
      >
        <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <MessageSquare className="size-4 text-muted-foreground" />
          <span className="flex-1 text-[15px] font-semibold">Replies</span>
          <button
            type="button"
            onClick={() => setOpenRoot(null)}
            aria-label="Close replies"
            className="flex size-8 items-center justify-center rounded-lg hover:bg-accent"
          >
            <X className="size-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          <MessageRow message={root} first>
            {card(root)}
          </MessageRow>
          <div className="mx-2 my-2 flex items-center gap-2 text-[12px] text-muted-foreground">
            <span>{replies.length} {replies.length === 1 ? "reply" : "replies"}</span>
            <span className="h-px flex-1 bg-border" />
          </div>
          {replies.map((reply, index) => (
            <MessageRow key={reply.id} message={reply} first={startsMessageGroup(replies[index - 1], reply)}>
              {card(reply)}
            </MessageRow>
          ))}
        </div>
        {questionPanel ? questionPanel([...new Set(replyTasks)]) : null}
        <Composer testId="thread-reply-input" placeholder="Reply…" onSend={(text) => post(text, root.id)} autoFocus />
      </aside>
    </div>
  );
}
