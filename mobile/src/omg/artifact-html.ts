import { secureArtifactDocument, type ArtifactTheme } from "../../../packages/protocol/src/artifact-document";

/** Keep authored scripts in an opaque origin, without app credentials or a native bridge. */
export function artifactHtmlDocument(html: string, theme: ArtifactTheme): string {
  const source = secureArtifactDocument(html, theme)
    .replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}iframe{display:block}</style></head><body><iframe title="Artifact content" sandbox="allow-scripts" srcdoc="${source}"></iframe></body></html>`;
}

export function artifactPath(url?: string, id?: string): string | null {
  const path = url || (id ? `/api/artifacts/${encodeURIComponent(id)}` : "");
  return /^\/api\/artifacts\/[a-z0-9-]+(?:\?[^#]*)?$/.test(path) ? path : null;
}
