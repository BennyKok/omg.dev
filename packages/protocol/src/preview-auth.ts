import type { ProjectPreview } from "./project-preview";

export type PreviewAppIdentity = { appId: string; projectId: string };
export type PreviewAuthContext = PreviewAppIdentity & { previewUrl: string };
export type PreviewAppCredential = { token: string; previewUrl: string };
export const PREVIEW_AUTH_REQUEST = "omg:preview-auth:request";
export const PREVIEW_AUTH_RESPONSE = "omg:preview-auth:response";

/** Only the scoped app JWT travels to the frame. URL fragments are not sent
 * to Metro, HTTP access logs, or referrers. Keep the metadata for reloads. */
export function authenticatedPreviewUrl(url: string, appId: string, token: string, parentOrigin = "https://app.omg.dev"): string {
  const target = new URL(url);
  const match = /^([a-z0-9]+)-(\d+)(?:-[a-z0-9]+(?:-[a-f0-9]+)?)?\.preview\.(?:omg\.dev|omgs\.app)$/.exec(target.hostname);
  if (target.protocol !== "https:" || target.username || target.password || target.port || !match || Number(match[2]) < 8081 || Number(match[2]) > 8099) {
    throw new Error("App authentication requires a hosted Expo preview");
  }
  const hash = new URLSearchParams(target.hash.slice(1));
  hash.set("__omg_preview_auth", JSON.stringify({ appId, token, parentOrigin }));
  target.hash = hash.toString();
  return target.toString();
}

export function previewAuthRequest(value: unknown, appId: string): { requestId: string; appId: string } | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (data.type !== PREVIEW_AUTH_REQUEST || data.appId !== appId || typeof data.requestId !== "string" || !data.requestId || data.requestId.length > 100) return null;
  return { requestId: data.requestId, appId };
}

/** The platform's project permissions run before its session mints a token.
 * The runtime checks the same owner/app boundary before accepting that JWT. */
export async function mintPreviewAppToken(
  identity: PreviewAuthContext,
  options: {
    getAccessToken(): Promise<string | null>;
    fetch?: typeof fetch;
    authOrigin?: string;
    controlPlaneOrigin?: string;
    requestOrigin?: string;
  },
): Promise<PreviewAppCredential | null> {
  const fetcher = options.fetch ?? fetch;
  const accessToken = await options.getAccessToken();
  if (!accessToken) return null;
  const permission = await fetcher(`${options.controlPlaneOrigin ?? "https://backend.omg.dev"}/api/projects/previewAuthContext`, {
    method: "POST",
    credentials: "omit",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(identity),
  });
  if (!permission.ok) return null;
  const context = await permission.json() as { appId?: string; previewUrl?: string };
  if (context.appId !== identity.appId || typeof context.previewUrl !== "string") return null;
  // Check the server-selected destination before the scoped credential exists.
  authenticatedPreviewUrl(context.previewUrl, identity.appId, "");
  const source = new URL(identity.previewUrl).hostname.split("-").slice(0, 2).join("-");
  if (new URL(context.previewUrl).hostname.split("-").slice(0, 2).join("-") !== source) return null;
  const response = await fetcher(`${options.authOrigin ?? "https://auth.omg.dev"}/token`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.requestOrigin ? { Origin: options.requestOrigin } : {}) },
    body: JSON.stringify({ appId: identity.appId }),
  });
  if (!response.ok) return null;
  const data = await response.json() as { token?: unknown };
  return typeof data.token === "string" ? { token: data.token, previewUrl: context.previewUrl } : null;
}

export function previewAppIdentity(preview: Pick<ProjectPreview, "appId" | "projectId">): PreviewAppIdentity | null {
  return preview.appId && preview.projectId ? { appId: preview.appId, projectId: preview.projectId } : null;
}

/** Mint only for the current authenticated frame. A permission check may outlive
 * logout, navigation or a project switch. Recheck authority after it finishes. */
export async function renewPreviewAuth(
  request: { requestId: string; appId: string },
  mint: () => Promise<PreviewAppCredential | null>,
  isCurrent: () => boolean,
): Promise<{ type: typeof PREVIEW_AUTH_RESPONSE; requestId: string; appId: string; token: string | null } | null> {
  if (!isCurrent()) return null;
  const credential = await mint().catch(() => null);
  if (!isCurrent()) return null;
  return { type: PREVIEW_AUTH_RESPONSE, ...request, token: credential?.token ?? null };
}
