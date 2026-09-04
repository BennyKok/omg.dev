import { describe, expect, test } from "bun:test";
import { OWNER_VIEWER, applyRoleViews, type Viewer } from "./viewer-role";

const settings = {
  showSidebarAgentIcons: true,
  showSidebarFavicons: true,
  showSessionAgentIcons: true,
  showComposerModels: true,
  showComposerAgents: true,
  showBots: true,
  showSchedules: false,
  showSessionDiffBar: true,
  showComposerFastMode: true,
};

describe("applyRoleViews", () => {
  test("owner leaves the box settings untouched", () => {
    expect(applyRoleViews(settings, OWNER_VIEWER)).toBe(settings);
  });

  test("a role can only turn a switch off, never on", () => {
    const viewer: Viewer = {
      ...OWNER_VIEWER,
      role: { id: "viewer", name: "Viewer" },
      hide: ["showBots", "showComposerFastMode"],
    };
    const merged = applyRoleViews(settings, viewer);
    expect(merged.showBots).toBe(false);
    expect(merged.showSchedules).toBe(false);
    expect(merged.showComposerModels).toBe(true);
    expect(merged.showComposerFastMode).toBe(false);
  });
});
