import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findProjectFavicon, projectFaviconMime } from "./project-favicon.ts";

describe("project favicon", () => {
  const roots: string[] = [];

  function sandbox(): string {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "omg-project-favicon-")));
    roots.push(root);
    return root;
  }

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  test("prefers the root favicon over nested conventions", async () => {
    const root = sandbox();
    mkdirSync(join(root, "public"));
    writeFileSync(join(root, "favicon.svg"), "<svg/>");
    writeFileSync(join(root, "public", "favicon.png"), "png");

    expect(await findProjectFavicon(root)).toBe(join(root, "favicon.svg"));
  });

  test("finds the web shell icon in a monorepo", async () => {
    const root = sandbox();
    mkdirSync(join(root, "web", "public"), { recursive: true });
    writeFileSync(join(root, "web", "public", "icon.svg"), "<svg/>");

    expect(await findProjectFavicon(root)).toBe(join(root, "web", "public", "icon.svg"));
  });

  test("does not follow a conventional path outside the configured repo", async () => {
    const root = sandbox();
    const outside = sandbox();
    const secret = join(outside, "favicon.svg");
    writeFileSync(secret, "<svg/>");
    symlinkSync(secret, join(root, "favicon.svg"));

    expect(await findProjectFavicon(root)).toBeNull();
  });

  test("maps browser image types", () => {
    expect(projectFaviconMime("favicon.svg")).toBe("image/svg+xml");
    expect(projectFaviconMime("favicon.ico")).toBe("image/x-icon");
    expect(projectFaviconMime("favicon.png")).toBe("image/png");
  });
});
