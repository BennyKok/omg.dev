// A compaction is one event in the transcript: "Conversation compacted".
//
// Claude writes it as three rows. The host's warning that it is about to
// happen (an assistant notice), the summary itself (a user turn, drawn as one
// line by classifySystemMessage), and the CLI's `/compact` echo,
// `<local-command-stdout>Compacted </local-command-stdout>`. Only the summary
// is the event. The echo says nothing a person can use, and the warning has
// been answered once the summary below it exists.

type Row = { role?: string; kind?: string; text?: string };

const COMPACT_ECHO = /^\s*<local-command-stdout>\s*Compacted\b[\s\S]*<\/local-command-stdout>\s*$/i;
const IDLE_NOTICE = /^\s*This conversation's prompt cache is expected to expire soon\./i;
const SUMMARY = /^\s*This session is being continued from a previous conversation that ran out of context\./i;

/** How far below the warning its compaction can land and still answer it. */
const NOTICE_REACH = 3;

const isText = (row: Row, role: string) => row.role === role && (row.kind ?? "text") === "text";

/** `rows` without the parts of a compaction that are not the event. Returns `rows` when nothing is dropped. */
export function withoutCompactionNoise<T extends Row>(rows: T[]): T[] {
  let dropped = false;
  const kept = rows.filter((row, index) => {
    const drop =
      (isText(row, "user") && COMPACT_ECHO.test(row.text ?? "")) ||
      (isText(row, "assistant") &&
        IDLE_NOTICE.test(row.text ?? "") &&
        rows.slice(index + 1, index + 1 + NOTICE_REACH).some((next) => isText(next, "user") && SUMMARY.test(next.text ?? "")));
    if (drop) dropped = true;
    return !drop;
  });
  return dropped ? kept : rows;
}
