// The role this browser views as, plus the owner's preview control. Owned by
// App (which fetches /api/me) and read by Settings > View (to grey out the
// switches a role overrides) and by Roles & tool access (the preview picker).
import { createContext } from "react";
import { OWNER_VIEWER, type Viewer } from "./viewer-role";

export type RoleViewerState = {
  viewer: Viewer;
  roles: { id: string; name: string }[];
  preview: (roleId: string) => void;
};

export const RoleViewerContext = createContext<RoleViewerState>({
  viewer: OWNER_VIEWER,
  roles: [],
  preview: () => {},
});
