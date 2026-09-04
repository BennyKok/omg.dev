// The role this browser views as, from GET /api/me (src/policy/roles.ts).
//
// The user is the browser's own pick (lfg_user); there is no auth, so the
// answer decides layout, not access. The owner may preview any role; the
// preview is remembered per browser under `lfg_role_preview`.

export const VIEW_TOGGLE_KEYS = [
  "showSidebarAgentIcons",
  "showSessionAgentIcons",
  "showComposerModels",
  "showComposerAgents",
  "showBots",
  "showSchedules",
  "showSessionDiffBar",
  "showComposerFastMode",
] as const;
export type ViewToggleKey = (typeof VIEW_TOGGLE_KEYS)[number];

export type Viewer = {
  role: { id: string; name: string };
  /** True when the user's own role is owner, so a preview is allowed. */
  canSwitchRole: boolean;
  /** View toggles the role turns off. AND these against the box settings. */
  hide: ViewToggleKey[];
  hiddenPages: string[];
};

export const OWNER_VIEWER: Viewer = { role: { id: "owner", name: "Owner" }, canSwitchRole: true, hide: [], hiddenPages: [] };

const PREVIEW_KEY = "lfg_role_preview";

export function readRolePreview(): string {
  try {
    return localStorage.getItem(PREVIEW_KEY) || "";
  } catch {
    return "";
  }
}

export function writeRolePreview(roleId: string): void {
  try {
    if (roleId && roleId !== "owner") localStorage.setItem(PREVIEW_KEY, roleId);
    else localStorage.removeItem(PREVIEW_KEY);
  } catch {
    // Private mode: the preview lasts for this page only.
  }
}

export async function fetchViewer(
  user: string | null,
  previewRole: string,
  signal?: AbortSignal,
): Promise<Viewer | null> {
  const params = new URLSearchParams();
  if (user) params.set("user", user);
  if (previewRole) params.set("role", previewRole);
  const query = params.toString();
  const res = await fetch(`/api/me${query ? `?${query}` : ""}`, { credentials: "same-origin", signal });
  if (!res.ok) return null;
  const payload = (await res.json()) as Partial<Viewer>;
  return {
    role: payload.role ?? OWNER_VIEWER.role,
    canSwitchRole: payload.canSwitchRole !== false,
    hide: Array.isArray(payload.hide) ? payload.hide : [],
    hiddenPages: Array.isArray(payload.hiddenPages) ? payload.hiddenPages : [],
  };
}

/** Box settings with the role's hidden toggles turned off. */
export function applyRoleViews<T extends Record<ViewToggleKey, boolean>>(settings: T, viewer: Viewer): T {
  if (viewer.hide.length === 0) return settings;
  const next = { ...settings };
  for (const key of viewer.hide) next[key] = false as T[ViewToggleKey];
  return next;
}
