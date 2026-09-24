import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mount, type Mounted } from "./test-support/render";

const { ArtifactViewerPage } = await import("./App");

// omg.dev's Computer host wraps this app in `relative z-[46]`, a stacking
// context. The mobile session sheet is a <body> portal at z-[90]. A viewer
// rendered in place was trapped at 46 and opened BEHIND the sheet, so the
// viewer must be a <body> child too.
describe("ArtifactViewerPage", () => {
  let ui: Mounted;
  beforeEach(() => {
    ui = mount();
    ui.host.className = "relative z-[46]";
  });
  afterEach(() => ui.cleanup());

  test("renders at <body> level, outside the host's stacking context", () => {
    ui.render(
      <ArtifactViewerPage
        artifact={{ kind: "file", url: "/api/artifacts/a1", name: "report.zip", mimeType: "application/zip", size: 2048 }}
        onClose={() => {}}
      />,
    );
    // Nothing renders inside the host.
    expect(ui.host.childElementCount).toBe(0);
    const page = [...document.body.children].find((el) => el.textContent?.includes("report.zip"));
    expect(page).toBeDefined();
    expect(page!.parentElement).toBe(document.body);
    expect(page!.className).toContain("z-[100]");
  });

  test("Back closes it", () => {
    let closed = false;
    ui.render(
      <ArtifactViewerPage
        artifact={{ kind: "file", url: "/api/artifacts/a1", name: "report.zip" }}
        onClose={() => {
          closed = true;
        }}
      />,
    );
    const back = document.body.querySelector("button[aria-label='Back']") as HTMLButtonElement;
    ui.flush(() => back.click());
    expect(closed).toBe(true);
  });
});
