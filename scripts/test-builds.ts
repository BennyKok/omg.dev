import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const TEST_BUILDS = [
  {
    output: "packages/protocol/dist/index.js",
    build: ["run", "--cwd", "packages/protocol", "build"],
    inputs: [
      "packages/protocol/src",
      "packages/protocol/package.json",
      "packages/protocol/tsconfig.build.json",
    ],
  },
  {
    output: "packages/client/dist/index.js",
    build: ["run", "--cwd", "packages/client", "build"],
    inputs: [
      "packages/client/src/index.ts",
      "packages/client/package.json",
      "packages/client/tsconfig.build.json",
      "packages/protocol/dist/index.js",
    ],
  },
  {
    output: "packages/react/dist/index.js",
    build: ["run", "--cwd", "packages/react", "build"],
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
    build: ["run", "--cwd", "packages/react", "build"],
    inputs: ["packages/react/src/styles.css"],
  },
  {
    output: "web/dist-lib/index.js",
    build: ["run", "--cwd", "web", "build:lib"],
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

function isStale(root: string, output: string, inputs: readonly string[]): boolean {
  const outputPath = join(root, output);
  if (!existsSync(outputPath)) return true;
  const outputMtime = statSync(outputPath).mtimeMs;
  return inputs.some((input) => newestMtime(join(root, input)) > outputMtime);
}

export function unreadyTestBuilds(root: string): string[] {
  return TEST_BUILDS.filter(({ output, inputs }) => isStale(root, output, inputs)).map(
    ({ output }) => output,
  );
}

/**
 * The build commands for exactly the stale outputs, in dependency order.
 *
 * `bun run test` used to answer "something is stale" by running the entire
 * build:packages script — every package plus the web library bundle, which is
 * a ~1GB vite build on its own. And `web/dist-lib` lists `web/src` as an
 * input, so ANY edit to the UI marked it stale. Every test run after touching
 * App.tsx therefore rebuilt the whole world.
 *
 * That is what put this box at load 44 with 24% iowait: three worktrees each
 * running that full build at once, none of them finishing. TEST_BUILDS is
 * already declared in dependency order, so filtering it preserves that.
 */
export function staleTestBuildCommands(root: string): string[][] {
  const seen = new Set<string>();
  const commands: string[][] = [];
  for (const { output, inputs, build } of TEST_BUILDS) {
    if (!isStale(root, output, inputs)) continue;
    const key = build.join(" ");
    // react emits index.js and styles.css from one build; run it once.
    if (seen.has(key)) continue;
    seen.add(key);
    commands.push([...build]);
  }
  return commands;
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
