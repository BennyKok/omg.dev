#!/usr/bin/env bun
/**
 * Build the iOS app on bennys-macbook-pro-2 instead of on EAS Build.
 *
 * ── Why ───────────────────────────────────────────────────────────────────
 *
 * `mobile-release.yml` runs `eas build` on a GitHub runner, which bills an
 * EAS build (iOS medium, about $2) per attempt. Four attempts on 2026-09-23
 * cost roughly $8, and two of them failed for toolchain reasons rather than
 * anything in the app. The Mac already has Xcode, CocoaPods, fastlane and
 * the signing credentials, so `eas build --local` produces the SAME signed
 * IPA there for nothing.
 *
 * The cloud path stays. It is the one that works when the Mac is asleep, off
 * the tailnet, or busy with the e2e suite. This is the cheap path, not the
 * replacement.
 *
 * ── Three things that are NOT optional ─────────────────────────────────────
 *
 * Each of these cost a failed build to find, and each fails in a way that
 * blames something else entirely.
 *
 * 1. A GIT CLONE, NOT AN RSYNC. `eas build --local` archives from the git
 *    root. `metro.config.js` watches `../packages/protocol/src`, which is
 *    OUTSIDE mobile/, so a project-directory-only copy loses it. Metro then
 *    fails to build its Transformer, and react/metro#1808 swallows the real
 *    error and reports `Cannot read properties of undefined (reading
 *    'transformFile')` instead. Nothing in that message points at the cause.
 *
 * 2. A PRIVATE TMPDIR, OUTSIDE THE CLONE, WITH THE METRO CACHE WIPED EACH RUN.
 *    `computer-control-dom.tsx` is a `use dom` component, and the transformer
 *    generates its entry with an ABSOLUTE path baked in. Metro caches that
 *    entry under $TMPDIR, so the path outlives the directory it names.
 *
 *    Isolating $TMPDIR is necessary but NOT sufficient, which cost a build to
 *    learn. Sharing the default $TMPDIR pulled in
 *    `~/.omg-e2e-src/.../computer-control-dom.tsx` from the e2e tree. Using a
 *    private one then pulled in `<previous-build-uuid>/build/mobile/src/...`,
 *    because eas-build-local uses a fresh UUID directory per run and the
 *    cached entry still pointed at the last one. So the cache is deleted
 *    before every build.
 *
 *    It must also not live inside the clone, or EAS refuses outright with
 *    "cannot copy <dir> to a subdirectory of self".
 *
 * 3. DEVELOPER_DIR, NOT xcode-select. Xcode 27 sits beside 26.6 and only 26.6
 *    is selected, because the e2e suite and every proven build run on it.
 *    Switching the system default to try 27 would put that at risk for every
 *    other agent on the box.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────
 *
 *   bun run scripts/mac-build.ts                      # main, Xcode 27, no submit
 *   bun run scripts/mac-build.ts --ref my-branch
 *   bun run scripts/mac-build.ts --xcode 26           # the proven toolchain
 *   bun run scripts/mac-build.ts --submit             # upload to App Store Connect
 *   bun run scripts/mac-build.ts --profile preview
 */

const HOST = process.env.OMG_SIM_HOST ?? "bennykok@bennys-macbook-pro-2";
/** A clone, never an rsync target. See note 1 above. */
const REPO = ".omg-build-repo";
/** Outside REPO on purpose. See note 2 above. */
const TMP = ".omg-build-tmp";
const ORIGIN = "https://github.com/BennyKok/omg.dev.git";

/**
 * The Google iOS OAuth client, mirroring eas.json's production profile.
 * Public identifier, not a secret: app.config.js only registers the Google
 * Sign-In plugin when it is set, so a build without it has no Google button.
 */
const GOOGLE_IOS_CLIENT_ID =
  "470443022473-sj262et812jqi3pvl05ccr8spuq2th45.apps.googleusercontent.com";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const has = (name: string) => process.argv.includes(`--${name}`);

/**
 * Xcode 26.6 is the system default and the toolchain every green build in
 * this repo used. 27 is opt-in and is what the iOS 27 SDK needs.
 */
const XCODE_PATHS: Record<string, string> = {
  "26": "/Applications/Xcode.app/Contents/Developer",
  "27": "/Applications/Xcode-27.0.0.app/Contents/Developer",
};

async function main(): Promise<number> {
  const ref = arg("ref") ?? "main";
  const profile = arg("profile") ?? "production";
  const xcode = arg("xcode") ?? "27";
  const submit = has("submit");
  const developerDir = XCODE_PATHS[xcode];
  if (!developerDir) throw new Error(`--xcode must be one of ${Object.keys(XCODE_PATHS).join(", ")}`);
  if (!/^[A-Za-z0-9._\/-]+$/.test(ref)) throw new Error("--ref has an unexpected character");
  if (!/^[a-z-]+$/.test(profile)) throw new Error("--profile has an unexpected character");

  const out = `~/${REPO}/omg-${profile}.ipa`;
  const script = [
    "set -eo pipefail",
    // A non-interactive ssh gets a PATH without nvm, and ~/.bun/bin/node (bun's
    // node shim) shadows the real node when it is first. Expo needs node
    // >= 20.19.4, so the highest nvm version goes in front by hand. Homebrew
    // is where pod and fastlane live.
    'N=$(ls ~/.nvm/versions/node 2>/dev/null | sed "s/^v//" | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)',
    'export PATH="$HOME/.nvm/versions/node/v$N/bin:$HOME/.bun/bin:/opt/homebrew/bin:$PATH"',
    `export EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=${GOOGLE_IOS_CLIENT_ID}`,
    `export DEVELOPER_DIR=${developerDir}`,
    `mkdir -p ~/${TMP} && export TMPDIR=$HOME/${TMP}`,
    // See note 2: a `use dom` entry caches an absolute path that is wrong on
    // the very next run. Cheap to rebuild, and the alternative is a failure
    // that names a module in a directory that no longer exists.
    'rm -rf "$TMPDIR"/metro-cache "$TMPDIR"/metro-file-map-* 2>/dev/null || true',
    // Clone once, then keep it on the requested ref. --hard because prebuild
    // writes ios/ into the tree and we never want that carried between runs.
    `if [ ! -d ~/${REPO}/.git ]; then git clone ${ORIGIN} ~/${REPO}; fi`,
    `cd ~/${REPO}`,
    "git fetch -q origin",
    `git reset -q --hard origin/${ref} 2>/dev/null || git reset -q --hard ${ref}`,
    "git clean -qfd mobile/ios || true",
    'echo "==> building $(git log --oneline -1)"',
    `echo "==> xcode $(${developerDir}/usr/bin/xcodebuild -version | head -1)"`,
    "cd mobile",
    "bun install --frozen-lockfile 2>&1 | tail -2",
    `npx -y eas-cli@latest build --local --platform ios --profile ${profile} --non-interactive --output ${out}`,
    `ls -lh ${out}`,
    ...(submit
      ? [
          'echo "==> submitting to App Store Connect"',
          `npx -y eas-cli@latest submit --platform ios --path ${out} --non-interactive`,
        ]
      : ['echo "==> not submitting (pass --submit to upload)"']),
  ].join("\n");

  const p = Bun.spawn(["ssh", "-o", "BatchMode=yes", HOST, script], {
    stdout: "inherit",
    stderr: "inherit",
  });
  return await p.exited;
}

process.exit(await main());
