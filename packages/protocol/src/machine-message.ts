/**
 * Messages that software sends into a session as a user turn, each starting
 * with a bracketed marker. The person did not type them. The web client draws
 * them as system rows (web/src/lib/system-message.ts holds the full parsers);
 * the server uses this list where it must not treat one as the person's own
 * message, for example the Auto build switch (src/auto-build-model.ts).
 */
const MACHINE_MARKER =
  /^\s*\[(?:omg builder\]|Background task |subagent (?:progress|complete|blocked|failed)\]|Peer message from |Message from [^\]]+ to bot |ask-user answer |Browser login |This conversation continues |Scheduled routine: )/i;

export function isMachineMessage(text: string): boolean {
  return MACHINE_MARKER.test(text);
}
