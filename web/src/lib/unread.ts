/**
 * The one unread dot.
 *
 * A bot conversation and a coding session ask the reader the same question —
 * "this said something and you have not looked" — so they must not answer it
 * with two different marks. `bot-unread.ts` re-exports this under its old name
 * for the bot roster's callers.
 */
export const UNREAD_DOT_CLASS = "inline-block size-2 shrink-0 rounded-full bg-primary";
