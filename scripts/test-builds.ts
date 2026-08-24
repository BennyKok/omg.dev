import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export type TestBuild = {
  readonly output: string;
  readonly build: readonly string[];
  readonly inputs: readonly string[];
};

/**
 * What `bun test` genuinely cannot resolve without a build.
 *
 * ONLY these two. The chain is narrow: src/plan-limit-error.test.ts imports
 * web/src/lib/omg-client.ts, which imports @omg-dev/client, which resolves
 * through package.json "main" to dist, and client's dist imports
 * @omg-dev/protocol's dist in turn.
 *
 * packages/react used to be listed here and nothing under test imports it.
 * It was demanded only by this file's own assertion, so it cost every fresh
 * worktree a tsc build and a stylesheet copy to satisfy a guard rather than a
 * dependency. Measured with both removed: 2571 tests, no resolution failure.
 *
 * Do not add an entry here to make a check pass. Add one only when a test
 * cannot resolve a module without it.
 */
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
] as const;

/**
 * The prebuilt `@omg-dev/app` embed bundle.
 *
 * Deliberately NOT in TEST_BUILDS. This one output is a full vite build that
 * peaks at 1.7 GB resident and takes ~30 s, and it lists `web/src` as an
 * input — so every edit to the UI marked it stale and every `bun run test`
 * rebuilt it. With several worktrees testing at once that is the memory
 * spike, not a disk problem: bun hardlinks packages from the global cache,
 * so a worktree's node_modules costs almost no incremental disk.
 *
 * It still has to run before the tarball ships. `bun run test:embed` builds
 * it and runs the smoke, and release.yml calls that on the publish path.
 */
export const EMBED_TEST_BUILDS = [
  ...TEST_BUILDS,
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

export function unreadyTestBuilds(
  root: string,
  builds: readonly TestBuild[] = TEST_BUILDS,
): string[] {
  return builds.filter(({ output, inputs }) => isStale(root, output, inputs)).map(
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
export function staleTestBuildCommands(
  root: string,
  builds: readonly TestBuild[] = TEST_BUILDS,
): string[][] {
  const seen = new Set<string>();
  const commands: string[][] = [];
  for (const { output, inputs, build } of builds) {
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

export function assertTestBuilds(
  root: string,
  builds: readonly TestBuild[] = TEST_BUILDS,
): void {
  const unready = unreadyTestBuilds(root, builds);
  if (unready.length > 0) throw testBuildPrerequisiteError(unready);
}
