import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import {
  browseFolderWithRecovery,
  folderRecoveryNotice,
} from "../web/src/lib/folder-browser-recovery.ts";

describe("project folder browser recovery", () => {
  test("recovers to the parent when a listed folder is deleted before navigation", async () => {
    const requested = "/home/user/repos/Test/Test";
    const attempts: (string | undefined)[] = [];
    const existing = new Set(["/home/user/repos/Test"]);

    const result = await browseFolderWithRecovery(requested, async (path) => {
      attempts.push(path);
      if (!path || !existing.has(path)) throw new Error("folder does not exist");
      return { current: path };
    });

    expect(attempts).toEqual([requested, "/home/user/repos/Test"]);
    expect(result).toEqual({
      payload: { current: "/home/user/repos/Test" },
      unavailablePath: requested,
      recoveryLocation: "parent",
    });
  });

  test("falls back from a missing parent to projects root, then home", async () => {
    const requested = "/home/user/repos/Test/Test";
    const attempts: (string | undefined)[] = [];

    const result = await browseFolderWithRecovery(requested, async (path) => {
      attempts.push(path);
      if (path !== "~") throw new Error("not found");
      return { current: "/home/user" };
    });

    expect(attempts).toEqual([
      requested,
      "/home/user/repos/Test",
      undefined,
      "~",
    ]);
    expect(result.recoveryLocation).toBe("home");
    expect(result.payload.current).toBe("/home/user");
  });

  test("names the missing path and tells the user what to do", () => {
    expect(folderRecoveryNotice("/home/user/repos/Test/Test", "projects")).toBe(
      "Folder “/home/user/repos/Test/Test” is no longer available. Choose another folder. Showing your projects folder instead.",
    );
  });

  test("clears the stale payload and disables folder actions on an unrecovered error", async () => {
    const app = await readFile("web/src/App.tsx", "utf8");
    const start = app.indexOf("function ProjectFolderBrowser(");
    const end = app.indexOf("\nfunction ", start + 1);
    const component = app.slice(start, end);

    expect(component.indexOf("setBrowser(null)")).toBeLessThan(
      component.indexOf("browseFolderWithRecovery(path"),
    );
    expect(component).toContain("disabled={loading || !!error || !folderName.trim() || !browser}");
    expect(component).toContain("disabled={!browser || loading || !!error}");
  });
});
