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
 * 3. `expo prebuild` and `pod install` only when `ios/` is absent. The native
 *    project and its DerivedData are kept between runs; that is the whole
 *    source of the speed.
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
  `export EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=${GOOGLE_IOS_CLIENT_ID};`;

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
    // The native project is kept between runs; regenerate it only when it is
    // gone. `expo prebuild` rewrites ios/ and would throw away DerivedData.
    'if [ ! -d ios ]; then npx expo prebuild --platform ios --no-install; (cd ios && pod install); fi',
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
