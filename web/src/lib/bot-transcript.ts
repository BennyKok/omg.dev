// The client hides exactly what the server considers launch plumbing.
//
// This used to be a client-only module, and that was wrong in a way that only
// showed up once rotation started writing a new kind of block into the launch
// prompt: the server had no way to ask "would a human see this?", so the
// checkpoint builder happily copied the previous session's runtime contract —
// old persona and all — into the next session's prompt. Same failure shape as
// the one bot-session.ts records: two copies of one rule, drifting.
//
// So the rules live in src/bots/transcript.ts and both sides use them.
export {
  botVisibleUserText,
  isBotHiddenLogKind,
  isBotLaunchOnlyText,
  isBotRotationNoticeText,
  isSubagentUpdateText,
  stripBotLaunchEnvelope,
} from "../../../src/bots/transcript.ts";
