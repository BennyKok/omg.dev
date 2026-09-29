import { createContext, useContext, useMemo, useRef, useState, useEffect, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import { Archive, ArrowUp, ChevronLeft, Folder, Info, MessageSquare, MoreVertical, Paperclip, Pencil, Plus, X } from "lucide-react";
import type { ConversationParticipant } from "../../../src/conversation-contract";
import { ConversationParticipantRow } from "./conversation-presence";
import { MessageResponse } from "./ai-elements/message";
import { CopyableMarkdownLink } from "./ai-elements/streamdown-response";
import { AuthenticatedArtifactImage, AuthenticatedArtifactVideo } from "./authenticated-artifact";
import {
  authorHue,
  authorView,
  cardMessageIds,
  mentionsOmg,
  replySummary,
  repliesTo,
  startsMessageGroup,
  TASK_STATE_LABEL,
  taskCardFor,
  threadPreview,
  linkMentions,
  mentionAgents,
  mentionFromHref,
  threadMentionOptions,
  type ThreadMentionOption,
  topLevelMessages,
  typingIn,
  typingLabel,
  typingPinger,
  type TaskCardState,
  type ThreadAuthor,
  type ThreadDetail,
  type ThreadMedia,
  type ThreadMessage,
  type ThreadSummary,
} from "../../../packages/protocol/src/threads";
import { createThread, sendThreadMessage, sendThreadTyping, updateThread, useThread, type ThreadAttachment } from "@/lib/threads";
import { useAsk, SessionQuestionPanel } from "./ask-center";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { cn } from "@/lib/utils";
import { agentIconSrc, CodingAgentsContext } from "@/lib/session-ui";

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

function ComposerSlot({ render, ...props }: ThreadComposerProps & { render?: (props: ThreadComposerProps) => ReactNode }) {
  return <>{render ? render(props) : <Composer {...props} />}</>;
}

const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

/** The thread's people, so every avatar and name is drawn as they are now. */
const ThreadPeopleContext = createContext<ThreadDetail["participants"] | undefined>(undefined);

function Avatar({ author, size = 36 }: { author: ThreadAuthor; size?: number }) {
  const people = useContext(ThreadPeopleContext);
  const [failed, setFailed] = useState<string | null>(null);
  // omg wears its own mark, the same one the omg agent shows everywhere.
  if (author.kind === "omg") {
    return (
      <img
        aria-hidden
        alt=""
        src={agentIconSrc("omg")}
        className="shrink-0 rounded-lg"
        style={{ width: size, height: size }}
      />
    );
  }
  const { name, avatar } = authorView(author, people);
  // A person's own photo, as elsewhere in the app; the letter only when there
  // is none or it will not load (an offline box cannot reach Gravatar).
  if (avatar && failed !== avatar) {
    return (
      <img
        aria-hidden
        alt=""
        src={avatar}
        onError={() => setFailed(avatar)}
        className="shrink-0 rounded-lg object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-lg font-bold text-white"
      style={{ width: size, height: size, fontSize: size < 30 ? 10 : 14, background: `hsl(${authorHue(author)} 45% 45%)` }}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function AuthorName({ author }: { author: ThreadAuthor }) {
  const people = useContext(ThreadPeopleContext);
  return <>{authorView(author, people).name}</>;
}

/** One message, Slack style: avatar and name only at the start of a group. */
/**
 * A message's pictures, videos and files, drawn the way the session chat draws
 * an agent's: the same authenticated image (click to zoom) and video player.
 */
function ThreadMediaList({ media }: { media?: ThreadMedia[] }) {
  if (!media?.length) return null;
  return (
    <div data-testid="thread-media" className="mt-1 flex flex-col items-start gap-2">
      {media.map((row) => (
        <div key={row.path} className="flex max-w-[min(34rem,100%)] flex-col items-start gap-1">
          {row.kind === "image" ? (
            <AuthenticatedArtifactImage
              path={row.path}
              alt={row.caption || row.name || "Image"}
              width={row.width ?? undefined}
              height={row.height ?? undefined}
              zoomable
              className="block max-h-[24rem] w-auto max-w-full self-start overflow-hidden rounded-xl bg-muted object-contain"
            />
          ) : row.kind === "video" ? (
            <AuthenticatedArtifactVideo
              path={row.path}
              label={row.name || row.caption || "Video"}
              width={row.width ?? undefined}
              height={row.height ?? undefined}
              className="block max-h-[24rem] w-auto max-w-full self-start overflow-hidden rounded-xl bg-black object-contain"
            />
          ) : (
            <a
              href={row.path}
              download={row.name || undefined}
              className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-[13px] hover:bg-accent"
            >
              <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{row.name || "File"}</span>
            </a>
          )}
          {row.caption && row.kind !== "file" ? <p className="text-xs text-muted-foreground">{row.caption}</p> : null}
        </div>
      ))}
    </div>
  );
}

/** What a clicked @mention does: the thread shows its members. */
const ThreadMentionContext = createContext<(() => void) | null>(null);

/** A link in a message: an @mention is a highlighted tag; anything else is the chat's own link. */
function ThreadLink(props: ComponentProps<typeof CopyableMarkdownLink>) {
  const open = useContext(ThreadMentionContext);
  const who = mentionFromHref(typeof props.href === "string" ? props.href : null);
  if (!who) return <CopyableMarkdownLink {...props} />;
  return (
    <button
      type="button"
      data-testid="thread-mention"
      data-mention={who}
      onClick={open ?? undefined}
      title="Show members"
      className="rounded px-0.5 font-semibold text-primary bg-primary/10 hover:bg-primary/20"
    >
      {props.children}
    </button>
  );
}

const THREAD_MARKDOWN = { a: ThreadLink } as ComponentProps<typeof MessageResponse>["components"];

function MessageRow({
  message,
  first,
  children,
}: {
  message: ThreadMessage;
  first: boolean;
  children?: ReactNode;
}) {
  const people = useContext(ThreadPeopleContext);
  const codingAgents = useContext(CodingAgentsContext);
  const handles = useMemo(() => mentionAgents(codingAgents).map((row) => row.handle), [codingAgents]);
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
              <AuthorName author={message.author} />
            </span>
            <span className="text-[12px] text-muted-foreground">{TIME.format(message.ts)}</span>
          </div>
        ) : null}
        {/* Formatted as the session chat formats a message: the same renderer. */}
        {message.text ? (
          <MessageResponse
            // The renderer is `size-full` for the session chat's bubbles. In a message row that
            // is the row's whole height, and the replies line under it spilled out of the row.
            className={cn("!h-auto break-words text-[15px] leading-[22px]", message.pending && "opacity-60")}
            components={THREAD_MARKDOWN}
          >
            {linkMentions(message.text, people, handles)}
          </MessageResponse>
        ) : null}
        <ThreadMediaList media={message.media} />
        {children}
      </div>
    </div>
  );
}

/** What a thread's chat bar needs. App.tsx renders the session bar with it. */
export type ThreadComposerProps = {
  testId: string;
  placeholder: string;
  /** The text, and the files already uploaded for it (POST /api/uploads). */
  onSend: (text: string, attachments: ThreadAttachment[]) => Promise<void>;
  autoFocus?: boolean;
  /** The field's text on every change, for the typing ping. */
  onTyping?: (text: string) => void;
  /** What `@` offers: omg, this machine's coding agents, the other people. */
  mentions?: readonly ThreadMentionOption[];
};

/** Call `onTyping` with the field's text as it changes, and with "" when the field goes away. */
export function useTypingReport(text: string, onTyping?: (text: string) => void) {
  const latest = useRef(onTyping);
  latest.current = onTyping;
  useEffect(() => latest.current?.(text), [text]);
  useEffect(() => () => latest.current?.(""), []);
}

/** "Alex is typing" with three pulsing dots, over the chat bar. Nothing when nobody is. */
export function TypingLine({ label, testId }: { label: string | null; testId: string }) {
  if (!label) return null;
  return (
    <div data-testid={testId} role="status" aria-live="polite" className="flex items-center gap-1.5 px-5 pt-1 text-[12px] text-muted-foreground">
      <span className="flex gap-0.5" aria-hidden>
        {[0, 150, 300].map((delay) => (
          <span key={delay} className="size-1 animate-pulse rounded-full bg-muted-foreground" style={{ animationDelay: `${delay}ms` }} />
        ))}
      </span>
      <span>{label}</span>
    </div>
  );
}

/** A plain field, used only where no chat bar is supplied (tests). */
function Composer({ placeholder, onSend, autoFocus, testId, onTyping }: ThreadComposerProps) {
  const [text, setText] = useState("");
  useTypingReport(text, onTyping);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setError(null);
    setText("");
    try {
      await onSend(body, []);
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
  initialReplies,
  renderComposer,
}: {
  /** The app's chat bar; see ThreadComposerProps. */
  renderComposer?: (props: ThreadComposerProps) => ReactNode;
  /** The profile picked in this browser, for a box that cannot tell who is writing. */
  viewer?: string | null;
  /** Open this message's replies on arrival (a push links here). */
  initialReplies?: string | null;
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
      initialReplies={initialReplies}
      renderComposer={renderComposer}
      detail={isNew ? null : detail}
      repos={repos}
      openAskSessionIds={questions.map((q) => q.sessionId)}
      questionPanel={(sessionIds) => (sessionIds.length ? <SessionQuestionPanel sessionIds={sessionIds} /> : null)}
      typing={isNew ? undefined : (on, replyTo) => sendThreadTyping(threadId, on, viewer, replyTo)}
      send={async (text, replyTo, attachments) => {
        if (isNew) {
          onCreated((await createThread(text, viewer, attachments)).id);
          return null;
        }
        const message = await sendThreadMessage(threadId, text, viewer, replyTo, attachments);
        await refresh();
        return message;
      }}
      setProject={async (cwd) => {
        await updateThread(threadId, { projectCwd: cwd });
        await refresh();
      }}
      onRename={async (title) => {
        await updateThread(threadId, { title });
        await refresh();
      }}
      onArchive={async () => {
        await updateThread(threadId, { archived: true });
        onBack?.();
      }}
      onOpenTask={onOpenTask}
      onBack={onBack}
    />
  );
}

/** The thread as drawn. Data in, actions out; ThreadChat above does the loading. */
export function ThreadChatView({
  threadId,
  initialReplies = null,
  renderComposer,
  detail,
  repos,
  openAskSessionIds,
  questionPanel,
  send,
  setProject: saveProject,
  onRename,
  onArchive,
  onOpenTask,
  onBack,
  typing,
}: {
  threadId: string;
  initialReplies?: string | null;
  /** Tell the others you are typing (or stopped), in the main list or a message's replies. */
  typing?: (on: boolean, replyTo: string | null) => void;
  renderComposer?: (props: ThreadComposerProps) => ReactNode;
  detail: ThreadDetail | null;
  repos: ReadonlyArray<{ name: string; cwd: string }>;
  /** Tasks with a question waiting on a person. */
  openAskSessionIds: ReadonlyArray<string | null | undefined>;
  /** The open questions from these tasks, drawn in their replies. */
  questionPanel?: (sessionIds: string[]) => ReactNode;
  /** Post a message, top-level or in a message's replies. */
  send: (text: string, replyTo: string | null, attachments: ThreadAttachment[]) => Promise<ThreadMessage | null>;
  setProject: (cwd: string | null) => Promise<void>;
  onRename?: (title: string) => Promise<void>;
  onArchive?: () => Promise<void>;
  onOpenTask: (sessionId: string) => void;
  onBack?: () => void;
}) {
  const isNew = threadId === NEW_THREAD_ID;
  const [pending, setPending] = useState<ThreadMessage[]>([]);
  const [openRoot, setOpenRoot] = useState<string | null>(initialReplies);
  // The message just posted, until the next load lists it: its replies can
  // open at once.
  const [rootHint, setRootHint] = useState<ThreadMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPending([]);
    setOpenRoot(initialReplies);
    setError(null);
  }, [threadId, initialReplies]);

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
  const codingAgents = useContext(CodingAgentsContext);
  const mentionOptions = useMemo(
    () => threadMentionOptions(codingAgents, detail?.participants, detail?.me, detail?.people),
    [codingAgents, detail?.participants, detail?.me, detail?.people],
  );
  // One pinger per field, so each says where you write.
  const typingRef = useRef(typing);
  typingRef.current = typing;
  const mainTyping = useMemo(() => typingPinger((on) => typingRef.current?.(on, null)), [threadId]);
  const replyTyping = useMemo(() => typingPinger((on) => typingRef.current?.(on, openRoot)), [threadId, openRoot]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [top.length]);

  // The replies open on the newest reply, and follow new ones unless you scrolled up to read.
  const repliesRef = useRef<HTMLDivElement>(null);
  const repliesPinned = useRef(true);
  useEffect(() => {
    repliesPinned.current = true;
  }, [openRoot]);
  useEffect(() => {
    const el = repliesRef.current;
    if (el && repliesPinned.current) el.scrollTop = el.scrollHeight;
  }, [openRoot, replies.length, !!root]);

  const post = async (text: string, replyTo: string | null, attachments: ThreadAttachment[] = []) => {
    const localId = `local-${Date.now()}`;
    if (!isNew) {
      setPending((rows) => [
        ...rows,
        {
          id: localId,
          threadId,
          ts: Date.now(),
          author: { kind: "human", participantId: detail?.me ?? "", name: "You" },
          // Media shows once stored: until then it is only on this device.
          text: text || `Sending ${attachments.length === 1 ? "a file" : `${attachments.length} files`}…`,
          pending: true,
          replyTo,
        },
      ]);
    }
    try {
      const message = await send(text, replyTo, attachments);
      // `send` has reloaded the thread, so the stored copy is there.
      setPending((rows) => rows.filter((row) => row.id !== localId));
      // Asking omg at the top level opens the replies it will answer in.
      if (message && !replyTo && mentionsOmg(text)) {
        setRootHint(message);
        setOpenRoot(message.id);
      }
    } catch (e) {
      setPending((rows) => rows.filter((row) => row.id !== localId));
      throw e;
    }
  };

  const setProject = (cwd: string | null) => {
    if (isNew) return;
    void saveProject(cwd).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };
  const [detailsOpen, setDetailsOpen] = useState(false);
  const humans = (detail?.participants ?? []).filter((row) => row.kind === "human");
  const rename = () => {
    const next = window.prompt("Rename thread", detail?.thread.title ?? "");
    if (next?.trim()) void onRename?.(next.trim()).catch((e) => setError(String(e)));
  };
  const archive = () => {
    if (!window.confirm("Archive this thread? It leaves your list. Its tasks keep running.")) return;
    setDetailsOpen(false);
    void onArchive?.().catch((e) => setError(String(e)));
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
      {/* The session chat's bar, as a session column draws it: a 28px mark, the
          title on one line, the people as faces on the right, and one menu.
          The project lives in that menu and in the details, not in the bar. */}
      <header className="flex min-h-11 min-w-0 items-center gap-2 border-b border-border px-3 py-1.5">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
          >
            <ChevronLeft className="size-4" />
          </button>
        ) : null}
        {isNew ? null : <GroupAvatar people={humans} size={28} />}
        <button
          type="button"
          data-testid="thread-title"
          disabled={isNew}
          onClick={() => setDetailsOpen(true)}
          title={people.length ? people.join(", ") : undefined}
          className="flex min-w-0 flex-1 items-center rounded-md text-left outline-none hover:bg-muted/50"
        >
          <span className="truncate text-[15px] font-semibold leading-tight">{isNew ? "New thread" : detail?.thread.title ?? "Thread"}</span>
        </button>
        {isNew ? null : (
          <ConversationParticipantRow
            participants={(detail?.participants ?? []) as ConversationParticipant[]}
            typingIds={(detail?.typing ?? []).flatMap((row) => (row.author.kind === "human" ? [row.author.participantId] : []))}
          />
        )}
        {isNew ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  data-testid="thread-menu"
                  aria-label="Thread actions"
                  className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
                >
                  <MoreVertical className="size-4" />
                </button>
              }
            />
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuItem onClick={() => setDetailsOpen(true)}>
                <Info className="size-4" /> Thread details
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Folder className="size-4" /> Project: {project?.name ?? "None"}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuLabel>Tasks run in</DropdownMenuLabel>
                  {repos.map((repo) => (
                    <DropdownMenuItem key={repo.cwd} onClick={() => setProject(repo.cwd)}>
                      {repo.name}
                      {project?.cwd === repo.cwd ? " ✓" : ""}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem onClick={() => setProject(null)}>No project{project ? "" : " ✓"}</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem onClick={rename}>
                <Pencil className="size-4" /> Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={archive}>
                <Archive className="size-4" /> Archive thread
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </header>
      {detail ? (
        <ThreadDetailsDialog
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
          detail={detail}
          repos={repos}
          onProject={setProject}
          onRename={rename}
          onArchive={archive}
          onOpenTask={(sid) => {
            setDetailsOpen(false);
            onOpenTask(sid);
          }}
        />
      ) : null}

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
      <TypingLine testId="thread-typing" label={typingLabel(typingIn(detail?.typing, null), detail?.participants)} />
      <ComposerSlot
        render={renderComposer}
        onTyping={mainTyping}
        mentions={mentionOptions}
        testId="thread-input"
        placeholder={isNew ? "Message" : `Message ${detail?.thread.title ?? "the thread"}`}
        onSend={(text, attachments) => post(text, null, attachments)}
        autoFocus={isNew}
      />
    </div>
  );

  const openMembers = () => setDetailsOpen(true);
  if (!root) {
    return (
      <ThreadMentionContext.Provider value={openMembers}>
        <ThreadPeopleContext.Provider value={detail?.participants}>{main}</ThreadPeopleContext.Provider>
      </ThreadMentionContext.Provider>
    );
  }
  const replyTasks = replies.flatMap((reply) => (reply.task ? [reply.task.sessionId] : []));
  return (
    <ThreadMentionContext.Provider value={openMembers}>
    <ThreadPeopleContext.Provider value={detail?.participants}>
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
        <div
          ref={repliesRef}
          data-testid="thread-replies-scroll"
          onScroll={(event) => {
            const el = event.currentTarget;
            repliesPinned.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
          }}
          // A picture that loads after opening grows the list: stay on the newest reply.
          onLoadCapture={(event) => {
            if (repliesPinned.current) event.currentTarget.scrollTop = event.currentTarget.scrollHeight;
          }}
          className="min-h-0 flex-1 overflow-y-auto px-2 py-2"
        >
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
        <TypingLine testId="thread-reply-typing" label={typingLabel(typingIn(detail?.typing, root.id), detail?.participants)} />
        <ComposerSlot render={renderComposer} onTyping={replyTyping} mentions={mentionOptions} testId="thread-reply-input" placeholder="Reply…" onSend={(text, attachments) => post(text, root.id, attachments)} autoFocus />
      </aside>
    </div>
    </ThreadPeopleContext.Provider>
    </ThreadMentionContext.Provider>
  );
}

type Participant = ThreadDetail["participants"][number];
const personName = (row: Participant) => row.display.name?.trim() || row.display.fallback;
const personAuthor = (row: Participant): ThreadAuthor => ({ kind: "human", participantId: row.id, name: personName(row) });

/** A thread's face where a session shows its agent: the first two people, overlapped. */
function GroupAvatar({ people, size = 32 }: { people: Participant[]; size?: number }) {
  const shown = people.slice(0, 2);
  if (shown.length < 2) return shown[0] ? <Avatar author={personAuthor(shown[0])} size={size} /> : null;
  const small = Math.round(size * 0.64);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      <div className="absolute left-0 top-0">
        <Avatar author={personAuthor(shown[0])} size={small} />
      </div>
      <div className="absolute bottom-0 right-0 rounded-lg ring-2 ring-background">
        <Avatar author={personAuthor(shown[1])} size={small} />
      </div>
    </div>
  );
}

const CREATED = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

/** Thread details: who is in it, where its tasks run, what it started. */
export function ThreadDetailsDialog({
  open,
  onOpenChange,
  detail,
  repos,
  onProject,
  onRename,
  onArchive,
  onOpenTask,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: ThreadDetail;
  repos: ReadonlyArray<{ name: string; cwd: string }>;
  onProject: (cwd: string | null) => void;
  onRename: () => void;
  onArchive: () => void;
  onOpenTask: (sessionId: string) => void;
}) {
  const people = detail.participants.filter((row) => row.kind === "human");
  const project = detail.thread.project;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="thread-details" className="max-w-md">
        <div className="flex flex-col items-center gap-2 pt-2">
          <GroupAvatar people={people} size={56} />
          <DialogTitle className="text-center text-xl font-bold">{detail.thread.title}</DialogTitle>
          <button type="button" onClick={onRename} className="text-sm text-primary hover:underline">Rename</button>
        </div>
        <section className="mt-3">
          <div className="mb-1 text-xs text-muted-foreground">Members · {people.length + 1}</div>
          <div className="divide-y divide-border rounded-xl border border-border">
            {people.map((row) => (
              <div key={row.id} className="flex items-center gap-3 px-3 py-2">
                <Avatar author={personAuthor(row)} size={28} />
                <div className="min-w-0">
                  <div className="truncate text-sm">{personName(row)}{row.id === detail.me ? " (you)" : ""}</div>
                  <div className="text-xs text-muted-foreground">{row.role === "owner" ? "Owner" : "Member"}</div>
                </div>
              </div>
            ))}
            <div className="flex items-center gap-3 px-3 py-2">
              <Avatar author={{ kind: "omg" }} size={28} />
              <div className="min-w-0">
                <div className="text-sm">omg</div>
                <div className="truncate text-xs text-muted-foreground">Answers, or starts a task, when someone writes @omg</div>
              </div>
            </div>
          </div>
        </section>
        <section className="mt-3">
          <div className="mb-1 text-xs text-muted-foreground">Project · where tasks from this thread run</div>
          <select
            data-testid="thread-details-project"
            value={project?.cwd ?? ""}
            onChange={(event) => onProject(event.target.value || null)}
            className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm"
          >
            <option value="">No project</option>
            {/* The current project stays pickable even before the list has loaded it. */}
            {(project && !repos.some((repo) => repo.cwd === project.cwd) ? [project, ...repos] : repos).map((repo) => (
              <option key={repo.cwd} value={repo.cwd}>{repo.name}</option>
            ))}
          </select>
        </section>
        {detail.tasks.length ? (
          <section className="mt-3">
            <div className="mb-1 text-xs text-muted-foreground">Tasks · {detail.tasks.length}</div>
            <div className="divide-y divide-border rounded-xl border border-border">
              {detail.tasks.map((task) => (
                <button
                  key={task.sessionId}
                  type="button"
                  onClick={() => onOpenTask(task.sessionId)}
                  className="flex w-full flex-col px-3 py-2 text-left hover:bg-accent/40"
                >
                  <span className="truncate text-sm">{task.title || "Task"}</span>
                  <span className="text-xs text-muted-foreground">
                    {[task.project, task.busy ? "Working" : task.ended ? "Ended" : "Waiting"].filter(Boolean).join(" · ")}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
        <p className="mt-3 text-center text-xs text-muted-foreground">Started {CREATED.format(detail.thread.createdAt)}</p>
        <button type="button" onClick={onArchive} className="mt-2 w-full rounded-xl border border-border py-2 text-sm text-destructive hover:bg-destructive/10">
          Archive thread
        </button>
      </DialogContent>
    </Dialog>
  );
}
