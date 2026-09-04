// The box-wide settings the local runtime owns and the Settings view edits.
//
// They live outside App so the resolver below can be read and tested on its
// own, and so one module owns both the shape and its defaults.
import { DEFAULT_SCHED_TZ } from "../cron";
import type { TranscriptView } from "./transcript-view";

export type GlobalSettings = {
  timeZone: string;
  // Cap on total LIVE agents, idle included (0 = unlimited).
  maxLiveAgents: number;
  // Per-bot cap on self-scheduled routines. Always >= 1 — unlike
  // maxLiveAgents, 0-as-unlimited is not offered here.
  maxBotSchedules: number;
  botAutoCompactionEnabled: boolean;
  botCompactionThresholdPercent: number;
  // Whether this box offers the Computer Use MCP to agents. Off by default;
  // see the MCP servers section in SettingsView.
  computerMcpEnabled: boolean;
  transcriptView: TranscriptView;
  // The update the "What's new" drawer's Skip button last dismissed. See
  // UpdateProvider in components/update-drawer.tsx.
  skippedUpdateVersion: string;
  // Standing instructions appended to the launch envelope of every new
  // session. "" means nothing extra is sent.
  customInstructions: string;
  // Default coding agent + model for a new session when this browser has no
  // saved choice. "" = host default / catalog default.
  defaultAgent: string;
  defaultModel: string;
  // Box-wide view switches. All true by default. See ViewPrefsContext.
  showSidebarAgentIcons: boolean;
  // Off hides the project favicon on each session row in the sidebar.
  showSidebarFavicons: boolean;
  showSessionAgentIcons: boolean;
  showComposerModels: boolean;
  // Off: no agent choice in the composer; every new session uses defaultAgent.
  showComposerAgents: boolean;
  showBots: boolean;
  showSchedules: boolean;
  // Off hides the floating worktree diff bar in a session's chat.
  showSessionDiffBar: boolean;
  // Off hides the Fast pill in the composer; new sessions launch without
  // fast mode.
  showComposerFastMode: boolean;
};

/**
 * The box-wide view preferences, read by the pieces of UI they switch: the
 * rail rows, session headers, the composer's model list, and the surface
 * toggle. One context so a deep, memoised row does not need seven props
 * threaded through it. A role system may later decide these per viewer; the
 * consumers only ever read the resolved booleans.
 */
export type ViewPrefs = Pick<
  GlobalSettings,
  | "defaultAgent"
  | "defaultModel"
  | "showSidebarAgentIcons"
  | "showSidebarFavicons"
  | "showSessionAgentIcons"
  | "showComposerModels"
  | "showComposerAgents"
  | "showBots"
  | "showSchedules"
  | "showSessionDiffBar"
  | "showComposerFastMode"
>;
export const DEFAULT_VIEW_PREFS: ViewPrefs = {
  defaultAgent: "",
  defaultModel: "",
  showSidebarAgentIcons: true,
  showSidebarFavicons: true,
  showSessionAgentIcons: true,
  showComposerModels: true,
  showComposerAgents: true,
  showBots: true,
  showSchedules: true,
  showSessionDiffBar: true,
  showComposerFastMode: true,
};

/**
 * Every GlobalSettings field with the value to use when the box does not send
 * one.
 *
 * A Computer can run an older omg.dev build than the UI that the dashboard
 * embeds, so its /api/bootstrap answer can omit a field this build renders.
 * Replacing the whole object with that answer used to leave newer fields
 * undefined, and `settings.customInstructions.trim()` crashed the Settings
 * page for those boxes. resolveGlobalSettings is the one owner of that merge,
 * so every consumer reads a complete object and none of them needs its own
 * fallback.
 */
export const DEFAULT_GLOBAL_SETTINGS: GlobalSettings = {
  timeZone: DEFAULT_SCHED_TZ,
  maxLiveAgents: 16,
  maxBotSchedules: 5,
  botAutoCompactionEnabled: true,
  botCompactionThresholdPercent: 78,
  computerMcpEnabled: false,
  transcriptView: "full",
  skippedUpdateVersion: "",
  customInstructions: "",
  ...DEFAULT_VIEW_PREFS,
};

/** Resolve a settings answer of any age into a complete GlobalSettings. */
export function resolveGlobalSettings(
  input: Partial<GlobalSettings> | null | undefined,
): GlobalSettings {
  const sent = Object.fromEntries(
    // A missing field arrives as an absent key from an older build and as
    // `null` from a box that stored one, and both mean "use the default".
    Object.entries(input ?? {}).filter(([, value]) => value !== undefined && value !== null),
  ) as Partial<GlobalSettings>;
  return { ...DEFAULT_GLOBAL_SETTINGS, ...sent };
}
