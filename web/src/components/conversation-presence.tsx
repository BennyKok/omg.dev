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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

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
}: {
  participant: ConversationParticipant;
  className?: string;
  typing?: boolean;
}) {
  const name = displayName(participant);
  // The face itself must stay `overflow-hidden` so a photo is clipped to the
  // circle, which means a typing mark cannot live inside it. The outer span
  // exists only to hang the badge outside that clip.
  const face = (
    <span
      className={cn(
        "relative grid size-4 shrink-0 place-items-center overflow-hidden rounded-full bg-primary/12 text-[9px] font-semibold text-primary",
        // Faces overlap, so each needs a halo to stay separable. It is the
        // CARD colour, never an accent: at 16px a 2px accent ring is a quarter
        // of the circle and reads as a blue background rather than a highlight.
        // Who owns the session is said in words in the menu below instead.
        "ring-2 ring-card",
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
 * The header roster: the humans in this conversation, as one overlapping pile
 * you can tap to see who they are.
 *
 * PEOPLE ONLY. Every header that mounts this already names the bot somewhere
 * else in the same bar — as the header identity and title when the session is
 * the bot's own chat, and as the "driven by <bot>" badge otherwise. Listing the
 * bot here too put its name in one header three times: title, pill, badge.
 *
 * This is also the only avatar display on that header. It used to share it with
 * a standalone SessionAssigneeAvatar, which drew the assignee a second time.
 *
 * WHO OWNS THE SESSION IS SAID IN WORDS, in the menu, not with a coloured ring
 * on the face. A 2px accent ring on a 16px circle is a quarter of the circle,
 * so it read as a blue background rather than as a highlight, and the member
 * ring (card-coloured, by design) was invisible next to it. The menu says
 * "Owner" and can be read.
 *
 * It sits in the header slot the standalone assignee avatar used to occupy,
 * which is why it is a real <button>: it is no longer nested inside the card's
 * rename button, so it needs neither the role/tabIndex shim nor Base UI's
 * nativeButton escape hatch. The click still stops propagating, so dropping it
 * back inside a clickable row cannot silently start a rename.
 *
 * Hidden below two people, so a session you work on alone is unchanged. A bot
 * is not company: one human plus a bot draws nothing, because the bot is named
 * elsewhere and a lone face says nothing the header did not already say.
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
  const names = people.map(displayName).join(", ");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Conversation participants: ${names}`}
            title={names}
            className="flex w-fit shrink-0 max-w-full cursor-pointer items-center overflow-hidden rounded-full outline-none"
            // stopPropagation ONLY. preventDefault here also cancels Base UI's
            // own trigger action, so the menu never opened.
            onClick={(event) => event.stopPropagation()}
          >
            {people.slice(0, MAX_FACES).map((participant) => (
              <HumanFace
                key={participant.id}
                participant={participant}
                typing={typing.has(participant.id)}
                className="-ml-1 first:ml-0"
              />
            ))}
            {people.length > MAX_FACES ? (
              <span className="ml-1.5 shrink-0 text-[10px] text-muted-foreground">
                +{people.length - MAX_FACES}
              </span>
            ) : null}
          </button>
        }
      />
      <DropdownMenuContent align="start" className="min-w-52">
        {/* Menu.GroupLabel throws without a Menu.Group around it, and the throw
            takes down the whole session column through the render boundary. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>In this session</DropdownMenuLabel>
          {people.map((participant) => (
            <DropdownMenuItem key={participant.id} className="gap-2" closeOnClick={false}>
              <HumanFace participant={participant} />
              <span className="min-w-0 flex-1 truncate">{displayName(participant)}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {typing.has(participant.id)
                  ? "typing"
                  : participant.role === "owner"
                    ? "Owner"
                    : participant.role === "observer"
                      ? "Observer"
                      : "Member"}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
