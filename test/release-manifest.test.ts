import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { prepareReleaseManifest } from "../scripts/prepare-release-manifest";

const read = (rel: string) =>
  readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

const SRC_ROOT = new URL("../src", import.meta.url).pathname;

function walkProductionTs(dir: string): string[] {
  const out: string[] = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...walkProductionTs(path));
      continue;
    }
    if (ent.name.endsWith(".ts") && !ent.name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

// Workspace packages the server imports from source: tsconfig.json "paths"
// aliases, plus relative `packages/<name>/src` imports. Bun resolves both at
// runtime, so each package directory must be staged into every runtime bundle.
function sourceWorkspacePackages(): string[] {
  const tsconfig = JSON.parse(read("tsconfig.json")) as {
    compilerOptions?: { paths?: Record<string, string[]> };
  };
  const paths = tsconfig.compilerOptions?.paths ?? {};
  const names = new Set<string>();
  for (const target of Object.values(paths).flat()) {
    const name = target.match(/^\.\/packages\/([^/]+)\/src\//)?.[1];
    if (name) names.add(name);
  }
  const relativeImport = /from ["'](?:\.\.\/)+packages\/([^/]+)\/src\//;
  for (const file of walkProductionTs(SRC_ROOT)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const match = line.match(relativeImport);
      if (match) names.add(match[1]);
    }
  }
  return [...names].sort();
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
    expect(packages).toContain("protocol");
    expect(packages).toContain("cloud");
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
