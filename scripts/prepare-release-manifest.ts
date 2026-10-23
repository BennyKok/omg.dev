import { readFileSync, writeFileSync } from "node:fs";

type PackageManifest = Record<string, unknown> & {
  workspaces?: unknown;
  patchedDependencies?: unknown;
};

export function prepareReleaseManifest(
  manifest: PackageManifest,
): PackageManifest {
  // The release installs only the runtime. Workspaces go, and so do patches:
  // every patched package today is a web dependency, already bundled into
  // web/dist, and patches/ is not staged. Bun refuses to install with a
  // patchedDependencies entry whose file is missing.
  const runtimeDeps = (manifest.dependencies ?? {}) as Record<string, unknown>;
  for (const spec of Object.keys((manifest.patchedDependencies ?? {}) as Record<string, unknown>)) {
    const name = spec.slice(0, spec.lastIndexOf("@") > 0 ? spec.lastIndexOf("@") : spec.length);
    if (name in runtimeDeps) {
      throw new Error(`${spec} is patched and is a runtime dependency. Stage patches/ in scripts/release.sh before dropping this check.`);
    }
  }
  const {
    workspaces: _workspaces,
    patchedDependencies: _patchedDependencies,
    ...runtimeManifest
  } = manifest;
  return runtimeManifest;
}

if (import.meta.main) {
  const manifestPath = process.argv[2];
  if (!manifestPath) {
    throw new Error("Usage: prepare-release-manifest.ts <package.json>");
  }

  const manifest = JSON.parse(
    readFileSync(manifestPath, "utf8"),
  ) as PackageManifest;
  writeFileSync(
    manifestPath,
    `${JSON.stringify(prepareReleaseManifest(manifest), null, 2)}\n`,
  );
}
