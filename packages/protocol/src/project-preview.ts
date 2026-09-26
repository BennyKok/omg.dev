export interface ProjectPreview {
  sessionId: string;
  title: string;
  url: string;
  port: number;
  kind: "sandbox-preview";
  visibility: "owner";
  temporary: true;
  createdAt: number;
  /** `exps://` link that opens the same live Metro server in Expo Go. */
  expoGoUrl?: string;
  /** When the Expo Go link stops working, in epoch milliseconds. */
  expoGoExpiresAt?: number;
  /**
   * True while the preview has never answered on its port. An Expo Go link is
   * created before Metro is running, so a new preview is not "stopped", it has
   * not started yet. Cleared the first time the port answers. Absent on rows
   * from older Computers, which then behave as before.
   */
  notStartedYet?: true;
}

export interface ProjectPreviewSnapshot {
  preview: ProjectPreview | null;
  /** False when nothing listens on the preview port, for example after the Computer slept. Absent from older Computers. */
  live?: boolean;
  /** True when the Expo Go link has expired. `live` is then false as well. */
  expired?: boolean;
  /** True when the preview has not answered on its port even once. Clients hide the card until then. */
  starting?: boolean;
}

/** Message a preview card sends to ask the session agent to start the preview again. */
export const PROJECT_PREVIEW_RESTART_MESSAGE =
  "The preview stopped. Restart it: start the development server again and expose it with omg_expose_port. For an Expo app, request a new Expo Go link.";
