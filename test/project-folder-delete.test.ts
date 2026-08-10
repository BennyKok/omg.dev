import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

// Deleting a project folder is an unrecoverable rm -rf reachable from a tap in
// the picker. The safety of the whole feature rests on one ordering invariant:
// the panel asks the server what is inside BEFORE it can offer to destroy it,
// and the inspect call must not itself be able to delete.
async function component(name: string) {
  const app = await readFile("web/src/App.tsx", "utf8");
  const start = app.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const end = app.indexOf("\nfunction ", start + 1);
  return app.slice(start, end === -1 ? undefined : end);
}

describe("delete folder panel", () => {
  test("inspects with a dry run that cannot delete", async () => {
    const panel = await component("DeleteFolderPanel");

    // The effect that runs on open posts the path and nothing else — no
    // confirm flag, so the server answers with a plan instead of deleting.
    const effect = panel.slice(panel.indexOf("useEffect("), panel.indexOf("async function confirmDelete"));
    expect(effect).toContain('JSON.stringify({ path: targetPath })');
    expect(effect).not.toContain("confirm");
  });

  test("only the explicit confirmation sends confirm: true", async () => {
    const panel = await component("DeleteFolderPanel");
    const confirm = panel.slice(panel.indexOf("async function confirmDelete"));
    expect(confirm).toContain("confirm: true");
    // ...and it is reachable only from the button, which stays disabled until
    // the plan has come back and been rendered.
    expect(panel).toMatch(/disabled=\{!plan \|\| deleting\}/);
  });

  // A folder with real files must never get the one-tap treatment: `safe`
  // gates the wording, and it is only true when the server said so.
  test("the light confirmation is gated on the server's judgement", async () => {
    const panel = await component("DeleteFolderPanel");
    expect(panel).toContain("const safe = plan?.looksUnused === true;");
    expect(panel).toMatch(/plan && !safe \?/);
    expect(panel).toContain("This folder has files in it");
  });
});

describe("folder browser rows", () => {
  test("the delete control is a sibling of the navigate button, not nested in it", async () => {
    const browser = await component("ProjectFolderBrowser");
    const row = browser.slice(browser.indexOf("{directories.map("), browser.indexOf("{!loading && browser"));

    // Nested <button> is invalid HTML: the browser reparents it, and the row's
    // navigate click starts firing for taps meant for the trash icon.
    const navigate = row.indexOf("void browse(directory.path)");
    const del = row.indexOf("setDeleteTarget(");
    expect(navigate).toBeGreaterThan(-1);
    expect(del).toBeGreaterThan(navigate);
    const between = row.slice(navigate, del);
    expect(between).toContain("</button>");

    // Screen readers get a distinct name per row, since the icon has no text.
    expect(row).toMatch(/aria-label=\{`Delete \$\{directory\.name\}`\}/);
  });
});
