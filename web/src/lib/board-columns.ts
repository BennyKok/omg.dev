// The Board: every task on this box, grouped into kanban columns.
//
// A "task" is a session. The Live page lists them as a rail; the Board reads
// the same rows and sorts each one into the column that says what it needs
// from you right now. Nothing here writes: the columns are derived from state
// the server already reports (`busy`, `status`, pending questions, ship
// posts), so the Board cannot disagree with the Live page about a session.
//
// Pure functions only. App.tsx hands the page the filtered live list; the
// page joins it with the ask queue and the shipped head and calls groupBoard.
import type { Session, ShipPost } from "../App";
import type { Question } from "../components/ask-center";

export type BoardColumnId = "needs-you" | "working" | "idle" | "shipped";

export type BoardCard = {
  key: string;
  sessionId: string | null;
  title: string;
  agent?: string;
  agentLabel?: string | null;
  claudeAccountId?: string | null;
  project?: string;
  /** Sort key and the "x ago" stamp on the card. */
  at: number;
  /** One line under the title: the question, the blocker, or the last words. */
  note?: string;
  /** The ship post behind a Shipped card, for opening it in review. */
  post?: ShipPost;
};

export type BoardColumn = {
  id: BoardColumnId;
  label: string;
  cards: BoardCard[];
};

export const BOARD_COLUMN_LABELS: Record<BoardColumnId, string> = {
  "needs-you": "Needs you",
  working: "Working",
  idle: "Idle",
  shipped: "Shipped",
};

function sessionTitle(session: Session): string {
  return (
    session.title ||
    session.lastUserText ||
    session.tmuxName ||
    session.project ||
    session.sessionId?.slice(0, 8) ||
    "session"
  );
}

function blockedNote(session: Session): string {
  if (session.statusDetail) return session.statusDetail;
  switch (session.statusReason) {
    case "out_of_credits":
      return "Out of credits";
    case "provider_auth":
      return "Provider needs sign-in";
    case "model_unavailable":
      return "Model unavailable";
    case "provider_error":
      return "Provider error";
    case "restart_recovered":
      return "Recovered after restart";
    default:
      return "Blocked";
  }
}

function questionNote(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 140 ? `${flat.slice(0, 139)}…` : flat;
}

function byNewest(a: BoardCard, b: BoardCard): number {
  return b.at - a.at || a.key.localeCompare(b.key);
}

/**
 * Sort live sessions, open questions and ship posts into the four columns.
 *
 * Precedence per session: a pending question or a blocked status wins over
 * `busy` (a blocked session can still report busy while its harness waits),
 * and `busy` wins over idle. Shipped is a separate feed: a session that
 * shipped and is still running appears in both a live column and Shipped,
 * which is the truth — it has landed work AND it is still going.
 */
export function groupBoard(input: {
  sessions: Session[];
  questions: Question[];
  posts: ShipPost[];
}): BoardColumn[] {
  const questionBySession = new Map<string, Question>();
  for (const q of input.questions) {
    if (!q.sessionId) continue;
    const prev = questionBySession.get(q.sessionId);
    // Oldest question first: it has waited longest.
    if (!prev || q.createdAt < prev.createdAt) questionBySession.set(q.sessionId, q);
  }

  const needsYou: BoardCard[] = [];
  const working: BoardCard[] = [];
  const idle: BoardCard[] = [];

  for (const session of input.sessions) {
    const sid = session.sessionId;
    if (!sid) continue;
    // A bot's session is the bot's conversation, not a task you started. It
    // lives on the Bots page; on the Board it would read as a task that is
    // always idle or always working. The server stamps `botId` on the record.
    if (session.botId) continue;
    const question = questionBySession.get(sid);
    const card: BoardCard = {
      key: `session:${sid}`,
      sessionId: sid,
      title: sessionTitle(session),
      agent: session.agent,
      agentLabel: session.agentLabel,
      claudeAccountId: session.claudeAccountId,
      project: session.project,
      at: session.lastActivityAt ?? session.startedAt ?? 0,
    };
    if (question) {
      card.note = questionNote(question.question);
      needsYou.push(card);
    } else if (session.status === "blocked") {
      card.note = blockedNote(session);
      needsYou.push(card);
    } else if (session.busy) {
      if (session.last?.text) card.note = questionNote(session.last.text);
      working.push(card);
    } else {
      if (session.last?.text) card.note = questionNote(session.last.text);
      idle.push(card);
    }
  }

  const shipped: BoardCard[] = input.posts.map((post) => ({
    key: `post:${post.id}`,
    sessionId: post.sessionId ?? null,
    title: post.title || post.sessionTitle || "Shipped",
    agent: post.agent,
    project: post.project,
    at: post.ts,
    note: post.summary ? questionNote(post.summary) : undefined,
    post,
  }));

  return [
    { id: "needs-you", label: BOARD_COLUMN_LABELS["needs-you"], cards: needsYou.sort(byNewest) },
    { id: "working", label: BOARD_COLUMN_LABELS.working, cards: working.sort(byNewest) },
    { id: "idle", label: BOARD_COLUMN_LABELS.idle, cards: idle.sort(byNewest) },
    { id: "shipped", label: BOARD_COLUMN_LABELS.shipped, cards: shipped.sort(byNewest) },
  ];
}
