import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { prepareReleaseManifest } from "../scripts/prepare-release-manifest";

const read = (rel: string) =>
  readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

// Every @omg-dev/* alias in tsconfig.json "paths" is a workspace package the
// server imports from source. Bun resolves those aliases at runtime, so each
// package directory must be staged into every runtime bundle.
function sourceWorkspacePackages(): string[] {
  const tsconfig = JSON.parse(read("tsconfig.json")) as {
    compilerOptions?: { paths?: Record<string, string[]> };
  };
  const paths = tsconfig.compilerOptions?.paths ?? {};
  return Object.values(paths)
    .flat()
    .map((target) => target.match(/^\.\/packages\/([^/]+)\/src\//)?.[1])
    .filter((name): name is string => Boolean(name));
}

describe("release bundle manifest", () => {
  test("does not advertise source workspaces that are absent from the bundle", () => {
    const source = {
      name: "lfg",
      workspaces: ["packages/*", "web"],
      dependencies: { zod: "^4.0.0" },
    };

    expect(prepareReleaseManifest(source)).toEqual({
      name: "lfg",
      dependencies: { zod: "^4.0.0" },
    });
  });

  test("the release packer prepares the staged manifest", () => {
    const releaseScript = readFileSync(
      new URL("../scripts/release.sh", import.meta.url),
      "utf8",
    );

    expect(releaseScript).toContain(
      'bun run scripts/prepare-release-manifest.ts "$STAGE/lfg/package.json"',
    );
    expect(releaseScript).toContain(
      '( cd "$STAGE/lfg" && unset CI && bun install --production --lockfile-only )',
    );
  });

  test("every source workspace package is staged into the release bundle", () => {
    const releaseScript = read("scripts/release.sh");
    const packages = sourceWorkspacePackages();
    expect(packages).toContain("connectors");
    for (const name of packages) {
      expect(releaseScript).toContain(
        `stage_runtime_workspace_package "$STAGE/lfg" ${name}`,
      );
    }
  });

  test("every source workspace package is staged into the desktop runtime", () => {
    const runtimeScript = read("desktop/scripts/prepare-runtime.sh");
    for (const name of sourceWorkspacePackages()) {
      expect(runtimeScript).toContain(`packages/${name}/src`);
    }
  });
});
