#!/usr/bin/env bun
/**
 * Run Maestro flows against the shared iOS simulator on the Mac.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * mobile/AGENTS.md opens with "A UI change is not verified until you have SEEN
 * it", and then spends seventy lines teaching an agent to synthesise taps with
 * CGEvent: calibrate the Simulator window's accessibility group, convert
 * screenshot pixels to device points, AXRaise before EVERY tap, and post
 * Unicode keystrokes through Quartz because System Events silently no-ops over
 * SSH. Three separate silent-failure traps are documented there, all found the
 * hard way, all of which produce a green-looking run that touched nothing.
 *
 * Maestro removes the entire class. It talks to a device by UDID through its
 * own on-device driver. No window focus, no coordinates, no System Events, no
 * TCC permission bucket. A selector that does not match is a loud failure
 * instead of a tap into empty space.
 *
 * ── The device is shared, so this takes a lock ────────────────────────────
 *
 * Several agents drive this Mac at once. AGENTS.md already records two
 * incidents caused by that: bare `booted` resolving to another agent's device,
 * and an agent re-pointing a simulator somebody else was mid-run on. This
 * script pins the UDID by NAME and holds an exclusive lock for the run.
 *
 * Run:
 *   bun run test:e2e                      every flow in e2e/
 *   bun run test:e2e --flow new-project   one flow
 *   bun run test:e2e --record             render an mp4 locally and fetch it
 *   bun run test:e2e --inspect            print the current screen's elements
 */

const HOST = process.env.OMG_SIM_HOST ?? "bennykok@bennys-macbook-pro-2";
const DEVICE = process.env.OMG_SIM_DEVICE ?? "iPhone 17 Pro";

/**
 * Maestro is a Kotlin/JVM application and needs Java 17+. The Mac has no
 * system JDK and no Homebrew; the runtime lives in a self-contained directory
 * that `setup` below can recreate.
 */
const REMOTE_ENV =
  'export JAVA_HOME="$HOME/.local/jdk/Contents/Home"; ' +
  'export PATH="$JAVA_HOME/bin:$HOME/.maestro/bin:$PATH";';

const REMOTE_DIR = ".omg-e2e";
const LOCK_ROOT = ".omg-sim-locks";
/** A lock older than this is assumed to be a crashed run, not a live one. */
const LOCK_STALE_MS = 30 * 60 * 1000;

const LOCAL_E2E = new URL("../e2e", import.meta.url).pathname;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const has = (name: string) => process.argv.includes(`--${name}`);

/** Run a command on the Mac. Returns stdout; throws on a non-zero exit. */
async function ssh(command: string, { allowFail = false } = {}) {
  const p = Bun.spawn(["ssh", "-o", "BatchMode=yes", HOST, command], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  const code = await p.exited;
  if (code !== 0 && !allowFail) {
    throw new Error(`ssh exited ${code}\n${command}\n${err || out}`);
  }
  return { out, err, code };
}

/**
 * Resolve the UDID by device NAME.
 *
 * Never pass bare `booted` to simctl. More than one simulator is routinely up
 * and `booted` picks one of them silently — the 2026-08-16 incident in
 * AGENTS.md is exactly this, an agent reading one device and tapping another.
 */
async function resolveUdid(): Promise<string> {
  const { out } = await ssh(
    `xcrun simctl list devices booted | grep -F '${DEVICE} (' | head -1`,
  );
  const m = out.match(/\(([0-9A-F-]{36})\)/i);
  if (!m) {
    const { out: booted } = await ssh("xcrun simctl list devices booted");
    throw new Error(
      `No booted simulator named "${DEVICE}".\nBooted now:\n${booted}\n` +
        `Set OMG_SIM_DEVICE, or boot one with:\n` +
        `  ssh ${HOST} "xcrun simctl boot '${DEVICE}'"`,
    );
  }
  return m[1];
}

/**
 * Take an exclusive lock on the device.
 *
 * `mkdir` is the atomic primitive: it either creates the directory or fails,
 * with no window between the check and the create. A plain `test -f && touch`
 * has that window and two agents starting together would both win it.
 */
async function lock(udid: string): Promise<() => Promise<void>> {
  const dir = `${LOCK_ROOT}/${udid}`;
  const owner = `${process.env.USER ?? "agent"}@${process.env.HOSTNAME ?? "devbox"} pid:${process.pid}`;

  const attempt = async () =>
    ssh(`mkdir -p ~/${LOCK_ROOT} && mkdir ~/${dir} 2>/dev/null && ` +
        `printf '%s\\n%s\\n' "${owner}" "$(date +%s)" > ~/${dir}/owner && echo ACQUIRED`,
        { allowFail: true });

  let got = await attempt();
  if (!got.out.includes("ACQUIRED")) {
    const { out: info } = await ssh(`cat ~/${dir}/owner 2>/dev/null`, { allowFail: true });
    const [holder = "unknown", takenAt = "0"] = info.trim().split("\n");
    const ageMs = Date.now() - Number(takenAt) * 1000;

    if (ageMs > LOCK_STALE_MS) {
      console.warn(
        `Breaking a stale lock on ${DEVICE} held by ${holder} for ` +
          `${Math.round(ageMs / 60000)} minutes.`,
      );
      await ssh(`rm -rf ~/${dir}`, { allowFail: true });
      got = await attempt();
    }
    if (!got.out.includes("ACQUIRED")) {
      throw new Error(
        `${DEVICE} is in use by ${holder} (held ${Math.round(ageMs / 60000)}m).\n` +
          `Wait, pick another device with OMG_SIM_DEVICE, or release it with:\n` +
          `  ssh ${HOST} "rm -rf ~/${dir}"`,
      );
    }
  }
  console.log(`Locked ${DEVICE} (${udid}).`);
  return async () => {
    await ssh(`rm -rf ~/${dir}`, { allowFail: true });
    console.log(`Released ${DEVICE}.`);
  };
}

/** Copy the flows over. The Mac runs them, so it needs the current files. */
async function pushFlows() {
  await ssh(`mkdir -p ~/${REMOTE_DIR}`);
  const p = Bun.spawn(
    ["scp", "-q", "-o", "BatchMode=yes", "-r", `${LOCAL_E2E}/.`, `${HOST}:${REMOTE_DIR}/`],
    { stdout: "inherit", stderr: "inherit" },
  );
  if ((await p.exited) !== 0) throw new Error("Could not copy e2e/ to the Mac.");
}

/** Print the current screen as a labelled element list, for writing selectors. */
async function inspect(udid: string) {
  const { out } = await ssh(`${REMOTE_ENV} maestro --udid=${udid} hierarchy 2>/dev/null`);
  const tree = JSON.parse(out);
  const seen = new Set<string>();
  const rows: string[] = [];
  (function walk(n: any) {
    const a = n.attributes ?? {};
    const label = (a.text || a.accessibilityText || "").trim();
    const leaf = !n.children?.length;
    if (label && leaf && a.enabled === "true" && !seen.has(label)) {
      seen.add(label);
      const rid = (a["resource-id"] || "").trim();
      rows.push(`  ${JSON.stringify(label)}${rid ? `   id: ${rid}` : ""}`);
    }
    for (const c of n.children ?? []) walk(c);
  })(tree);
  console.log(
    `${rows.length} selectable elements on ${DEVICE}.\n` +
      `Copy strings VERBATIM. \`text:\` is full-string regex, IGNORE_CASE.\n`,
  );
  console.log(rows.join("\n"));
}

async function main() {
  if (has("help")) {
    console.log(
      "bun run test:e2e [--flow NAME] [--record] [--inspect] [--device NAME]",
    );
    return 0;
  }

  const udid = await resolveUdid();
  const release = await lock(udid);
  try {
    if (has("inspect")) {
      await inspect(udid);
      return 0;
    }

    await pushFlows();
    const flow = arg("flow");
    const target = flow ? `~/${REMOTE_DIR}/${flow}.yaml` : `~/${REMOTE_DIR}`;

    if (has("record")) {
      if (!flow) throw new Error("--record needs --flow NAME; it renders one flow.");
      const remoteMp4 = `~/${REMOTE_DIR}/${flow}.mp4`;
      // --local keeps the recording on this machine. Without it, `record`
      // uploads the screen capture to mobile.dev to be rendered there.
      const r = await ssh(
        `${REMOTE_ENV} maestro --udid=${udid} record --local ${target} ${remoteMp4}`,
        { allowFail: true },
      );
      console.log(r.out || r.err);
      if (r.code !== 0) return 1;
      const dest = `${LOCAL_E2E}/${flow}.mp4`;
      const p = Bun.spawn(
        ["scp", "-q", "-o", "BatchMode=yes", `${HOST}:${remoteMp4}`, dest],
        { stdout: "inherit", stderr: "inherit" },
      );
      if ((await p.exited) !== 0) throw new Error("Could not fetch the recording.");
      console.log(`\nRecording: ${dest}`);
      return 0;
    }

    const r = await ssh(`${REMOTE_ENV} maestro --udid=${udid} test ${target}`, {
      allowFail: true,
    });
    console.log(r.out || r.err);
    return r.code === 0 ? 0 : 1;
  } finally {
    await release();
  }
}

process.exit(await main());
