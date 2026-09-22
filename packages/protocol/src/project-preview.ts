export interface ProjectPreview {
  sessionId: string;
  title: string;
  url: string;
  port: number;
  kind: "sandbox-preview";
  visibility: "owner";
  temporary: true;
  createdAt: number;
}

export interface ProjectPreviewSnapshot {
  preview: ProjectPreview | null;
}
