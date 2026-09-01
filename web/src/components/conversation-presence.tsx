/**
 * Who else is in this conversation, and who is typing in it right now.
 *
 * Extracted from App.tsx rather than written there because App.tsx mounts the
 * whole app on import, so nothing inside it can be rendered in a test (see
 * AGENTS.md). These take plain data instead of a Session so they stay pure:
 * the caller resolves the roster.
 */
import type { ConversationParticipant } from "../../../src/conversation-contract";
import { conversationParticipantDisplayName } from "../lib/conversation-ui";
import { cn } from "../lib/utils";

const MAX_FACES = 5;

function displayName(participant: ConversationParticipant): string {
  return conversationParticipantDisplayName(participant);
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
 * The header roster: the humans in this conversation, as one overlapping pile.
 *
 * PEOPLE ONLY. Every header that mounts this already names the bot somewhere
 * else in the same bar — as the header identity and title when the session is
 * the bot's own chat, and as the "driven by <bot>" badge otherwise. Listing the
 * bot here too put its name in one header three times: title, pill, badge.
 *
 * This is also the only avatar display on that header. It used to share it with
 * a standalone SessionAssigneeAvatar, which drew the assignee a second time.
 * The assignee is a participant like any other, so the owner is marked with a
 * tinted ring here instead of getting its own avatar.
 *
 * Owner comes from `participant.role`, which the server already seeds from the
 * assigned user. Matching on the assignee email would need a hash that lives in
 * a server module the browser bundle must not import.
 *
 * Hidden below two people, so a session you work on alone is unchanged. A bot
 * is not company: one human plus a bot draws nothing now, because the bot is
 * named elsewhere and a lone face says nothing the header did not already say.
 */
export function ConversationParticipantRow({
  participants,
  typingIds,
}: {
  participants: ConversationParticipant[];
  /** Participant ids currently typing. Others render exactly as before. */
  typingIds?: readonly string[];
}) {
  const people = participants.filter((participant) => participant.kind === "human");
  if (people.length < 2) return null;
  const typing = new Set(typingIds ?? []);
  return (
    <div
      className="mt-0.5 flex min-w-0 max-w-full items-center overflow-hidden"
      aria-label={`Conversation participants: ${people.map(displayName).join(", ")}`}
    >
      {people.slice(0, MAX_FACES).map((participant) => (
        <HumanFace
          key={participant.id}
          participant={participant}
          typing={typing.has(participant.id)}
          owner={participant.role === "owner"}
          className="-ml-1 first:ml-0"
        />
      ))}
      {people.length > MAX_FACES ? (
        <span className="ml-1.5 shrink-0 text-[10px] text-muted-foreground">
          +{people.length - MAX_FACES}
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
