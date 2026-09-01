/**
 * Who else is in this conversation, and who is typing in it right now.
 *
 * Extracted from App.tsx rather than written there because App.tsx mounts the
 * whole app on import, so nothing inside it can be rendered in a test (see
 * AGENTS.md). These take plain data instead of a Session so they stay pure:
 * the caller resolves the roster and the bot directory.
 */
import type { ConversationParticipant } from "../../../src/conversation-contract";
import { BotAvatar, type BotColorway, type BotShape } from "./BotAvatar";
import { conversationParticipantDisplayName } from "../lib/conversation-ui";
import { cn } from "../lib/utils";

/** Just enough of a bot to draw its mascot. */
export type ParticipantBotLook = { shape?: BotShape; colorway?: BotColorway };

const MAX_FACES = 5;

function displayName(participant: ConversationParticipant): string {
  return conversationParticipantDisplayName(participant);
}

function botIdOf(participant: ConversationParticipant): string {
  return participant.id.startsWith("bot:") ? participant.id.slice(4) : participant.id;
}

/**
 * One human's face: an initial underneath, the photo over it when there is
 * one. A photo that fails to load removes itself rather than leaving a broken
 * image icon, so the initial shows through.
 */
export function HumanFace({
  participant,
  className,
  typing = false,
  owner = false,
}: {
  participant: ConversationParticipant;
  className?: string;
  typing?: boolean;
  /** Draw the "this session is theirs" tint. See ConversationParticipantRow. */
  owner?: boolean;
}) {
  const name = displayName(participant);
  // The face itself must stay `overflow-hidden` so a photo is clipped to the
  // circle, which means a typing mark cannot live inside it. The outer span
  // exists only to hang the badge outside that clip.
  const face = (
    <span
      className={cn(
        "relative grid size-4 shrink-0 place-items-center overflow-hidden rounded-full bg-primary/12 text-[9px] font-semibold text-primary",
        // Faces overlap, so each needs a halo to stay separable. The owner's
        // is tinted: same geometry, no layout shift, and it replaces the second
        // avatar this header used to carry.
        owner ? "ring-2 ring-primary" : "ring-2 ring-card",
        !typing && className,
      )}
    >
      {name.slice(0, 1).toUpperCase() || "M"}
      {participant.display.avatar ? (
        <img
          src={participant.display.avatar}
          alt=""
          className="absolute inset-0 size-full object-cover"
          onError={(event) => event.currentTarget.remove()}
        />
      ) : null}
    </span>
  );
  if (!typing) {
    return (
      <span
        className="contents"
        title={`${name} · ${participant.role}`}
        aria-label={`${name}, ${participant.role}`}
      >
        {face}
      </span>
    );
  }
  // A corner badge rather than a ring. At 16px a ring reads as a pair of
  // brackets, and over a circular photo it is ambiguous with the photo's own
  // edge; a dot in the corner is unmistakable and is the pattern people
  // already know from every chat app.
  return (
    <span
      className={cn("relative shrink-0", className)}
      title={`${name} is typing`}
      aria-label={`${name}, typing`}
    >
      {face}
      <span className="absolute -bottom-px -right-px size-[7px] rounded-full border border-background bg-primary" />
    </span>
  );
}

/**
 * The header roster, as one overlapping pile.
 *
 * This is the only avatar display on the session header. It used to share that
 * header with a standalone SessionAssigneeAvatar, which drew the assignee a
 * second time. The assignee is a participant like any other, so the owner is
 * marked with a tinted ring here instead of getting its own avatar.
 *
 * Owner comes from `participant.role`, which the server already seeds from the
 * assigned user. Matching on the assignee email would need a hash that lives in
 * a server module the browser bundle must not import.
 *
 * Hidden below two participants, so a session you work on alone is unchanged.
 */
export function ConversationParticipantRow({
  participants,
  botLook,
  compact = false,
  typingIds,
}: {
  participants: ConversationParticipant[];
  botLook?: (botId: string) => ParticipantBotLook | undefined;
  compact?: boolean;
  /** Participant ids currently typing. Others render exactly as before. */
  typingIds?: readonly string[];
}) {
  if (participants.length < 2) return null;
  const typing = new Set(typingIds ?? []);
  return (
    <div
      className="mt-0.5 flex min-w-0 max-w-full items-center overflow-hidden"
      aria-label={`Conversation participants: ${participants.map(displayName).join(", ")}`}
    >
      {participants.slice(0, MAX_FACES).map((participant) => {
        const name = displayName(participant);
        if (participant.kind === "bot") {
          const botId = botIdOf(participant);
          const bot = botLook?.(botId);
          return (
            <span
              key={participant.id}
              className={cn(
                "flex min-w-0 shrink items-center rounded-full bg-muted text-[10px] leading-none text-muted-foreground",
                // A bot pill can carry a name, so it sits beside the pile
                // rather than overlapping into it.
                "ml-1 first:ml-0",
                compact ? "size-4 justify-center" : "gap-1 px-1.5 py-0.5",
              )}
              title={`${name} · bot`}
              aria-label={`${name}, bot`}
            >
              <BotAvatar
                shape={bot?.shape}
                colorway={bot?.colorway}
                size={14}
                state="idle"
                seed={botId.length}
              />
              {!compact ? <span className="max-w-20 truncate">{name}</span> : null}
            </span>
          );
        }
        return (
          <HumanFace
            key={participant.id}
            participant={participant}
            typing={typing.has(participant.id)}
            owner={participant.role === "owner"}
            className="-ml-1 first:ml-0"
          />
        );
      })}
      {participants.length > MAX_FACES ? (
        <span className="ml-1.5 shrink-0 text-[10px] text-muted-foreground">
          +{participants.length - MAX_FACES}
        </span>
      ) : null}
    </div>
  );
}

/** "Ana is typing", "Ana and Ben are typing", "3 people are typing". */
export function typingSentence(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} is typing`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing`;
  return `${names.length} people are typing`;
}

/**
 * The transcript-bottom indicator for OTHER people typing.
 *
 * Deliberately separate from the agent's own TypingIndicator: that one means
 * "the model is producing an answer", this one means "a person is composing
 * one". Showing them in the same slot with the same dots would make a
 * teammate's half-written question look like the agent working.
 *
 * The viewer's own typing must be filtered out by the caller — the server
 * broadcasts the full set to everyone including the sender, because a person
 * with two tabs open is still one typist.
 */
export function HumanTypingIndicator({
  participants,
  className,
}: {
  participants: ConversationParticipant[];
  className?: string;
}) {
  if (!participants.length) return null;
  const sentence = typingSentence(participants.map(displayName));
  return (
    <div
      className={cn("flex items-center gap-1.5 px-1 py-1 text-[11px] text-muted-foreground", className)}
      // Polite, not assertive: a teammate starting to type must never
      // interrupt a screen reader mid-sentence.
      aria-live="polite"
      aria-label={sentence}
    >
      <span className="flex items-center -space-x-1">
        {participants.slice(0, 3).map((participant) => (
          <HumanFace
            key={participant.id}
            participant={participant}
            className="ring-1 ring-background"
          />
        ))}
      </span>
      <span className="truncate">{sentence}</span>
      <span className="typing-indicator" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}
