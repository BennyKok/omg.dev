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
}
