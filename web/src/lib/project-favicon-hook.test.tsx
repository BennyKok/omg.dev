import { afterEach, beforeEach, expect, test } from "bun:test";
import { mount, window, type Mounted } from "../test-support/render";
// The harness installs DOM globals but not storage; the hook reads globalThis.
Object.assign(globalThis, { localStorage: window.localStorage });
const { useProjectFavicon, resetProjectFaviconRecords } = await import("./session-ui");

function Row({ project }: { project: string }) {
  const favicon = useProjectFavicon(project);
  return favicon.src ? (
    <span data-slot="">
      <img src={favicon.src} alt="" onLoad={favicon.onLoad} onError={favicon.onError} />
    </span>
  ) : (
    <span>no icon</span>
  );
}

let ui: Mounted;
beforeEach(() => {
  resetProjectFaviconRecords();
  ui = mount();
});
afterEach(() => ui.cleanup());

test("a missing icon drops the slot for every row and stays dropped on remount", () => {
  ui.render(
    <>
      <Row project="vibes" />
      <Row project="vibes" />
    </>,
  );
  expect(ui.queryAll("[data-slot]").length).toBe(2);
  ui.flush(() => {
    ui.query("img")!.dispatchEvent(new Event("error"));
  });
  // One failure answers for both rows: no empty slot, no second request.
  expect(ui.queryAll("[data-slot]").length).toBe(0);
  ui.remount();
  ui.render(<Row project="vibes" />);
  expect(ui.query("img")).toBeNull();
});

test("a miss is remembered across a reload through storage", async () => {
  ui.render(<Row project="erase-mac" />);
  ui.flush(() => {
    ui.query("img")!.dispatchEvent(new Event("error"));
  });
  const stored = JSON.parse(localStorage.getItem("omg.projectFavicons.v2") ?? "{}");
  const entry = Object.entries(stored).find(([src]) => src.includes("erase-mac"));
  expect((entry?.[1] as { ok: boolean }).ok).toBe(false);
});

test("a project with an icon keeps its image", () => {
  ui.render(<Row project="lfg" />);
  ui.flush(() => {
    ui.query("img")!.dispatchEvent(new Event("load"));
  });
  expect(ui.query("img")).not.toBeNull();
});
