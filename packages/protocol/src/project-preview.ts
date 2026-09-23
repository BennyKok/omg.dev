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
}

export interface ProjectPreviewSnapshot {
  preview: ProjectPreview | null;
  /** False when nothing listens on the preview port, for example after the Computer slept. Absent from older Computers. */
  live?: boolean;
}

/** Message a preview card sends to ask the session agent to start the preview again. */
export const PROJECT_PREVIEW_RESTART_MESSAGE =
  "The preview stopped. Restart it: start the development server again and expose it with omg_expose_port. For an Expo app, request a new Expo Go link.";
