#!/usr/bin/env bun
/**
 * Build the simulator-release app on the Mac, with Xcode, not EAS.
 *
 * ── Why ───────────────────────────────────────────────────────────────────
 *
 * The Jev plans need a build with the JS bundle EMBEDDED (`e2e/README.md`),
 * because every plan starts with `launchApp: clearState: true` and a dev
 * client would land on "Searching for development servers...". Until now the
 * only way to get one was `eas build --profile simulator-release`: about ten
 * minutes on EAS, plus the queue, for every app-code change.
 *
 * The Mac already has Xcode, CocoaPods, Node and bun. Building there is the
 * same product, with two differences that matter:
 *
 *   - Xcode is incremental. The first build pays the full native compile;
 *     after that a JS-only change is the bundle phase alone.
 *   - There is no queue and no upload.
 *
 * ── What it does ──────────────────────────────────────────────────────────
 *
 * 1. rsync `mobile/` to `~/.omg-e2e-src/mobile` on the Mac, and
 *    `packages/protocol/src` next to it. `src/omg/session-options.ts` imports
 *    that path directly and `metro.config.js` watches it, so a sync of
 *    `mobile/` alone fails in the bundle phase.
 * 2. `bun install --frozen-lockfile`.
 * 3. `expo prebuild` when `ios/` is absent, and `pod install` whenever the
 *    dependency list in package.json has moved since the last build. The
 *    native project and its DerivedData are kept between runs; that is the
 *    whole source of the speed. Pods must still be re-installed on a new
 *    package, because autolinking runs in the Podfile: skipping that step
 *    builds an app that is missing the native module and crashes when the JS
 *    reaches for it.
 * 4. `xcodebuild -sdk iphonesimulator -configuration Release`.
 *
 * `expo run:ios --device <udid>` is NOT used. It resolves a simulator UDID as
 * a physical device and stops on "No code signing certificates are
 * available". xcodebuild against `generic/platform=iOS Simulator` with
 * `CODE_SIGNING_ALLOWED=NO` is the same build without that guess.
 */

const HOST = process.env.OMG_SIM_HOST ?? "bennykok@bennys-macbook-pro-2";
const REMOTE_SRC = process.env.OMG_E2E_REMOTE_SRC ?? ".omg-e2e-src";
if (!/^\.[a-zA-Z0-9_-]+$/.test(REMOTE_SRC)) throw new Error("OMG_E2E_REMOTE_SRC must be a simple hidden directory name");
const LOCAL_MOBILE = new URL("..", import.meta.url).pathname;
const LOCAL_PROTOCOL = new URL("../../packages/protocol/src", import.meta.url).pathname;

/**
 * The Google iOS OAuth client, the one value `eas.json` sets for the
 * `simulator-release` profile. It is a public identifier, not a secret.
 * `app.config.js` registers the Google Sign-In plugin and the reversed URL
 * scheme only when it is set, so a build without it has no Google button and
 * the plan's sign-in step fails on a missing string.
 */
const GOOGLE_IOS_CLIENT_ID =
  "470443022473-sj262et812jqi3pvl05ccr8spuq2th45.apps.googleusercontent.com";

/**
 * A non-interactive ssh gets a PATH without nvm, and `~/.bun/bin/node` (bun's
 * node shim) shadows the real node when it is first. Expo needs node
 * >= 20.19.4, so the highest nvm version is put in front by hand.
 */
const REMOTE_ENV =
  'N=$(ls ~/.nvm/versions/node 2>/dev/null | sed "s/^v//" | sort -t. -k1,1n -k2,2n -k3,3n | tail -1); ' +
  'export PATH="$HOME/.nvm/versions/node/v$N/bin:$HOME/.bun/bin:/opt/homebrew/bin:$PATH"; ' +
  `export EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=${GOOGLE_IOS_CLIENT_ID};` +
  // Demo mode and its fixtures (demo.ts, demo-data.ts) are read at bundle
  // time, so a plan that needs them must set them on the machine that builds.
  Object.entries(process.env)
    .filter(([key, value]) => /^EXPO_PUBLIC_OMG_[A-Z_]+$/.test(key) && /^[A-Za-z0-9_.-]*$/.test(value ?? ""))
    .map(([key, value]) => ` export ${key}=${value};`)
    .join("");

/**
 * A stable signature of every dependency name and version in
 * mobile/package.json. The remote build compares it with the copy stored in
 * ios/ to decide whether pods are stale. Names and versions only: a change to
 * a script or the app name does not touch autolinking.
 */
function depsFingerprint(): string {
  const pkg = require("../package.json") as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  return Object.keys(all)
    .sort()
    .map((name) => `${name}@${all[name]}`)
    .join(" ");
}

/**
 * A signature of everything that decides what the NATIVE project looks like:
 * the app config and the config plugins it names.
 *
 * `depsFingerprint` above only sees package.json, so it catches a new pod but
 * not a new config plugin. Adding `expo-app-intents` on 2026-09-23 moved the
 * config alone: the plugin adds an `app-intents` synchronized group to the
 * Xcode project, and ONLY `expo prebuild` writes that. The remote `ios/` is
 * kept between runs, so prebuild never re-ran, the group never appeared, and
 * the app built green with no App Intent inside it. Nothing failed. The
 * feature was simply absent, which is the worst shape a build result can take.
 *
 * Config plugin FILES are included, not just their names: editing
 * `plugins/with-key-commands.js` changes the generated AppDelegate with no
 * change to any config.
 */
function nativeFingerprint(): string {
  const files = ["../app.json", "../app.config.js", ...readPluginFiles()];
  const hash = new Bun.CryptoHasher("sha256");
  for (const file of files.sort()) {
    hash.update(file);
    hash.update(readIfPresent(new URL(file, import.meta.url).pathname));
  }
  return hash.digest("hex");
}

function readIfPresent(path: string): string {
  try {
    return require("node:fs").readFileSync(path, "utf8") as string;
  } catch {
    return "";
  }
}

/** Every local config plugin, which the app config reaches by relative path. */
function readPluginFiles(): string[] {
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const dir = new URL("../plugins", import.meta.url).pathname;
    return fs.readdirSync(dir).filter((name) => name.endsWith(".js")).map((name) => `../plugins/${name}`);
  } catch {
    return [];
  }
}

async function sh(argv: string[]): Promise<number> {
  const p = Bun.spawn(argv, { stdout: "inherit", stderr: "inherit" });
  return await p.exited;
}

async function capture(argv: string[]): Promise<{ out: string; code: number }> {
  const p = Bun.spawn(argv, { stdout: "pipe", stderr: "inherit" });
  const out = await new Response(p.stdout).text();
  return { out, code: await p.exited };
}

/** Run a command with `text` on its stdin. */
async function pipe(argv: string[], text: string) {
  const p = Bun.spawn(argv, { stdin: new TextEncoder().encode(text), stdout: "inherit", stderr: "inherit" });
  if ((await p.exited) !== 0) throw new Error(`${argv[0]} failed.`);
}

async function rsync(from: string, to: string, excludes: string[] = []) {
  const argv = ["rsync", "-a", "--delete", "-q"];
  for (const e of excludes) argv.push("--exclude", e);
  argv.push(from, `${HOST}:${to}`);
  if ((await sh(argv)) !== 0) throw new Error(`rsync to ${to} failed.`);
}

/**
 * Build on the Mac and return the path of the .app there.
 *
 * `scheme` is the Xcode scheme `expo prebuild` generates from the app name.
 */
export async function buildSimulatorApp(): Promise<string> {
  const testEntry = process.env.OMG_E2E_ENTRY_FILE;
  if (testEntry && !/^scripts\/[a-z0-9-]+-e2e-entry\.tsx$/.test(testEntry)) {
    throw new Error("OMG_E2E_ENTRY_FILE must name a scripts/*-e2e-entry.tsx harness");
  }
  const started = Date.now();
  console.log("Syncing the source to the Mac...");
  /**
   * Drop source trees abandoned by sessions that are long gone.
   *
   * Every session that sets OMG_E2E_REMOTE_SRC gets its own checkout so two
   * agents cannot clobber each other, and the tree is KEPT between runs on
   * purpose: ios/ and its DerivedData are the whole speed of this path.
   * Nothing ever removed them, though, and on 2026-09-24 the Mac held five
   * abandoned 10 GB checkouts plus seven scratch dirs -- 64 GB of leftovers
   * on a disk with 426 MB free. That failed a build with an error about a
   * missing tarball, which looks nothing like "the disk is full".
   *
   * Fourteen days is deliberately generous. The cost of pruning too early is
   * one slow rebuild; the cost of never pruning is what happened above. The
   * tree this run is about to use is excluded by name, so an old session
   * resuming today keeps its cache.
   */
  await sh([
    "ssh",
    "-o",
    "BatchMode=yes",
    HOST,
    `find ~ -maxdepth 1 -type d -name '.omg-e2e-*' ! -name '${REMOTE_SRC}' -mtime +14 ` +
      `-exec echo 'pruning stale e2e tree:' {} ';' -exec rm -rf {} ';' 2>/dev/null || true`,
  ]);
  await sh(["ssh", "-o", "BatchMode=yes", HOST, `mkdir -p ~/${REMOTE_SRC}/mobile ~/${REMOTE_SRC}/packages/protocol`]);
  await rsync(`${LOCAL_MOBILE}`, `${REMOTE_SRC}/mobile/`, [
    "node_modules",
    "/ios",
    "/android",
    ".expo",
    "e2e/*.mp4",
  ]);
  await rsync(`${LOCAL_PROTOCOL}/`, `${REMOTE_SRC}/packages/protocol/src/`);

  const script = [
    "set -eo pipefail",
    REMOTE_ENV,
    `cd ~/${REMOTE_SRC}/mobile`,
    "bun install --frozen-lockfile 2>&1 | tail -2",
    `NEW_DEPS=${JSON.stringify(depsFingerprint())}`,
    `NEW_NATIVE=${JSON.stringify(nativeFingerprint())}`,
    // The native project is kept between runs, because DerivedData is the
    // whole speed of this path. Regenerate it when it is gone, and ALSO when
    // the app config or a config plugin moved: only prebuild writes what those
    // produce, so keeping a stale ios/ there builds an app that silently lacks
    // the feature. `--clean` rather than a bare prebuild, so a removed plugin
    // takes its native output with it.
    'if [ ! -d ios ] || [ "$NEW_NATIVE" != "$(cat ios/.omg-native 2>/dev/null)" ]; then',
    '  echo "native config changed: prebuild"',
    '  npx expo prebuild --platform ios --no-install --clean',
    // A fresh prebuild records BOTH fingerprints straight away. Without the
    // deps line the staleness check below saw no `ios/.omg-deps` and ran a
    // SECOND `pod install` over pods that were already current. On 2026-09-22
    // that second run stopped on "could not find compatible versions for pod
    // ExpoModulesCore" and left `ios/Pods` half written, and the build then
    // failed on source files that the stale project referenced but the
    // installed packages do not have.
    '  (cd ios && pod install)',
    '  printf %s "$NEW_DEPS" > ios/.omg-deps',
    '  printf %s "$NEW_NATIVE" > ios/.omg-native',
    "fi",
    /*
     * A NEW dependency needs `pod install` even though ios/ is present.
     *
     * Autolinking happens in the Podfile, so an expo module added to
     * package.json is absent from the built binary until pods are installed
     * again. The condition above only asked whether ios/ existed, so the
     * build kept succeeding and shipped an app without the module. Adding
     * expo-web-browser this way crashed the app on 2026-09-21 the moment the
     * JS called it: "Cannot find native module 'ExpoWebBrowser'", a fatal.
     * The build was green; the app was broken.
     *
     * So fingerprint the dependency list and re-install pods when it moves.
     * This is not the full expo fingerprint (config plugins and app.config.js
     * also change native state) -- it is the cheap part that covers adding,
     * removing or bumping a package, which is how this broke.
     */
    'if [ "$NEW_DEPS" != "$(cat ios/.omg-deps 2>/dev/null)" ]; then',
    '  echo "dependencies changed: pod install"; (cd ios && pod install) && printf %s "$NEW_DEPS" > ios/.omg-deps',
    "fi",
    // An explicit simulator harness tests native UI against local fixtures.
    // An ordinary build always keeps the normal Expo Router entry point.
    ...(testEntry ? [`export ENTRY_FILE="$PWD/${testEntry}"`] : []),
    "cd ios",
    'xcodebuild -workspace omg.xcworkspace -scheme omg -configuration Release ' +
      '-sdk iphonesimulator -destination "generic/platform=iOS Simulator" ' +
      "-derivedDataPath build CODE_SIGNING_ALLOWED=NO build 2>&1 | tee ../xcode-build.log " +
      "| grep -E \"error:|warning: no rule|BUILD (SUCCEEDED|FAILED)\"",
    // An absolute path: `simctl install` runs from the home directory.
    'ls -d "$PWD"/build/Build/Products/Release-iphonesimulator/*.app | head -1',
  ].join("\n");

  // The script goes over as a FILE, not as an argument. It contains quotes of
  // both kinds, and a shell command line that survives bun, ssh and zsh
  // unchanged does not exist.
  await pipe(["ssh", "-o", "BatchMode=yes", HOST, `cat > ~/${REMOTE_SRC}/build.sh`], script);
  const { out, code } = await capture([
    "ssh",
    "-o",
    "BatchMode=yes",
    HOST,
    `zsh -lc 'bash ~/${REMOTE_SRC}/build.sh'`,
  ]);
  process.stdout.write(out);
  if (code !== 0) throw new Error("The Mac build failed.");
  const app = out.trim().split("\n").filter(Boolean).pop() ?? "";
  if (!app.endsWith(".app")) throw new Error(`No .app in the build output:\n${out}`);
  console.log(`Built ${app} in ${Math.round((Date.now() - started) / 1000)}s.`);
  return app;
}

if (import.meta.main) {
  console.log(await buildSimulatorApp());
}
