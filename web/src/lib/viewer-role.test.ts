import { createSameOriginTransport, type OmgTransport } from "@omg-dev/client";
import { describe, expect, test } from "bun:test";
import { configureOmgTransport } from "./omg-client";
import { OWNER_VIEWER, applyRoleViews, fetchViewer, type Viewer } from "./viewer-role";

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

describe("fetchViewer", () => {
  // Hosted on app.omg.dev, a relative fetch("/api/me") reached the dashboard
  // page and got its HTML, so the role never applied. It must ask the box
  // through the configured transport.
  test("asks the computer through the omg transport", async () => {
    const paths: string[] = [];
    const transport = {
      ...createSameOriginTransport(),
      fetch: async (path: string) => {
        paths.push(path);
        return Response.json({ role: { id: "viewer", name: "Viewer" }, canSwitchRole: false, hide: ["showBots"], hiddenPages: ["bots"] });
      },
    } as unknown as OmgTransport;
    configureOmgTransport(transport);
    try {
      const viewer = await fetchViewer("person@example.com", "");
      expect(paths).toEqual(["/api/me?user=person%40example.com"]);
      expect(viewer).toEqual({ role: { id: "viewer", name: "Viewer" }, canSwitchRole: false, hide: ["showBots"], hiddenPages: ["bots"] });
    } finally {
      configureOmgTransport(createSameOriginTransport());
    }
  });
});
