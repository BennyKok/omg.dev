import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const TEST_BUILDS = [
  {
    output: "packages/protocol/dist/index.js",
    inputs: [
      "packages/protocol/src",
      "packages/protocol/package.json",
      "packages/protocol/tsconfig.build.json",
    ],
  },
  {
    output: "packages/client/dist/index.js",
    inputs: [
      "packages/client/src/index.ts",
      "packages/client/package.json",
      "packages/client/tsconfig.build.json",
      "packages/protocol/dist/index.js",
    ],
  },
  {
    output: "packages/react/dist/index.js",
    inputs: [
      "packages/react/src",
      "packages/react/package.json",
      "packages/react/tsconfig.build.json",
      "packages/client/dist/index.js",
      "packages/protocol/dist/index.js",
    ],
  },
  {
    output: "packages/react/dist/styles.css",
    inputs: ["packages/react/src/styles.css"],
  },
  {
    output: "web/dist-lib/index.js",
    inputs: [
      "package.json",
      "web/src",
      "web/package.json",
      "web/tsconfig.json",
      "web/vite.lib.config.ts",
      "packages/client/dist/index.js",
    ],
  },
] as const;

function newestMtime(path: string): number {
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return readdirSync(path, { withFileTypes: true }).reduce(
    (latest, entry) =>
      /\.test\.[^.]+$/.test(entry.name)
        ? latest
        : Math.max(latest, newestMtime(join(path, entry.name))),
    0,
  );
}

export function unreadyTestBuilds(root: string): string[] {
  return TEST_BUILDS.filter(({ output, inputs }) => {
    const outputPath = join(root, output);
    if (!existsSync(outputPath)) return true;
    const outputMtime = statSync(outputPath).mtimeMs;
    return inputs.some((input) => newestMtime(join(root, input)) > outputMtime);
  }).map(({ output }) => output);
}

export function testBuildPrerequisiteError(unready: readonly string[]): Error {
  return new Error(
    [
      "Test build prerequisites are missing or stale:",
      ...unready.map((path) => `- ${path}`),
      "Run `bun run test` from the repository root.",
      "It builds package entrypoints before Bun starts loading test files.",
      "Do not run package builds concurrently with `bun test`; they replace these dist entrypoints.",
    ].join("\n"),
  );
}

export function assertTestBuilds(root: string): void {
  const unready = unreadyTestBuilds(root);
  if (unready.length > 0) throw testBuildPrerequisiteError(unready);
}
