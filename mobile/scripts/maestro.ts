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
 *   bun run test:e2e --flow onboarding    fresh install -> sign-in code from Gmail -> home
 *   bun run test:e2e --install URL        install a simulator build (EAS tar.gz url or .app path on the Mac)
 *   bun run test:e2e --plan onboarding --record
 *                                         the default proof: Jev judges each step, side-by-side video
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
// An onboarding run provisions a Computer and waits on a mail round trip, so
// a live run can legitimately be long. Well past that before a lock is broken.
const LOCK_STALE_MS = 60 * 60 * 1000;

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


/**
 * Put a simulator build on the device. `source` is either an EAS artifact URL
 * (the .tar.gz `eas build:view --json` reports) or a path to an .app already
 * on the Mac. The app is terminated and replaced; its data is kept, which is
 * why the onboarding flow starts with `launchApp: clearState: true`.
 */
async function installApp(udid: string, source: string) {
  let app = source;
  if (/^https?:\/\//.test(source)) {
    console.log(`Downloading ${source} on the Mac...`);
    const { out } = await ssh(
      `set -e; D=$(mktemp -d ~/.omg-e2e-build.XXXXXX); curl -fsSL -o "$D/build.tar.gz" "${source}"; ` +
        `tar xzf "$D/build.tar.gz" -C "$D"; ls -d "$D"/*.app | head -1`,
    );
    app = out.trim();
    if (!app) throw new Error("The EAS artifact did not contain an .app bundle.");
  }
  await ssh(`xcrun simctl terminate ${udid} dev.omg.computer 2>/dev/null; xcrun simctl install ${udid} "${app}"`);
  console.log(`Installed ${app} on ${DEVICE}.`);
}

/**
 * The onboarding flow needs a code that only exists in a mailbox, so it runs
 * in two halves with the runner in between: the first half asks auth for the
 * code, the runner reads it from Gmail, the second half types it and walks the
 * signed-in steps. Each run uses a fresh plus-alias of the test mailbox, so
 * each run is a brand-new account and a brand-new hosted Computer.
 */
async function runOnboarding(udid: string): Promise<number> {
  const mailbox = process.env.OMG_E2E_MAILBOX ?? "itechbenny@gmail.com";
  const [user, domain] = mailbox.split("@");
  const email = process.env.OMG_E2E_EMAIL ?? `${user}+e2e${Date.now().toString(36)}@${domain}`;
  const { readSignInCode } = await import("./e2e-otp.ts");
  console.log(`Onboarding as ${email}`);
  // --record here is a simctl screen capture around both halves, because
  // `maestro record` renders one flow and this is two with a mail round trip
  // in between. The mp4 lands next to the flows, like the single-flow case.
  const recording = has("record") ? await startRecording(udid) : null;
  const started = new Date();
  const first = await ssh(
    `${REMOTE_ENV} maestro --udid=${udid} test -e EMAIL='${email}' ~/${REMOTE_DIR}/onboarding/01-request-code.yaml`,
    { allowFail: true },
  );
  console.log(first.out || first.err);
  if (first.code !== 0) {
    if (recording) await recording.stop("onboarding");
    return 1;
  }
  const { code, date } = await readSignInCode(mailbox, email, { notBefore: started });
  console.log(`Sign-in code arrived (${date}).`);
  const second = await ssh(
    `${REMOTE_ENV} maestro --udid=${udid} test -e CODE='${code}' ~/${REMOTE_DIR}/onboarding/02-verify.yaml`,
    { allowFail: true },
  );
  console.log(second.out || second.err);
  if (recording) await recording.stop("onboarding");
  console.log(`Test account left in place: ${email}. Account deletion finishes in the browser, so the runner cannot remove it.`);
  return second.code === 0 ? 0 : 1;
}

/**
 * The default proof: a plan judged by Jev, one persistent Maestro session,
 * and the Maestro-style step video composed from the runner's own log.
 * See e2e-jev.ts for the loop and e2e/<name>.plan.json for the plans.
 */
/** Work to do after the device lock is released: the video render. */
let afterRelease: (() => Promise<void>) | null = null;

async function runJevPlan(udid: string, name: string): Promise<number> {
  const { runPlan, loadPlan, composeStepVideo } = await import("./e2e-jev.ts");
  const plan = await loadPlan(LOCAL_E2E, name);
  const mailbox = process.env.OMG_E2E_MAILBOX ?? "itechbenny@gmail.com";
  const [user, domain] = mailbox.split("@");
  const email = process.env.OMG_E2E_EMAIL ?? `${user}+e2e${Date.now().toString(36)}@${domain}`;
  const needsOtp = plan.steps.some((s) => s.otp);
  if (needsOtp) console.log(`Onboarding as ${email}`);
  const recording = has("record") ? await startRecording(udid) : null;
  const recordingStartedAt = Date.now();
  const started = new Date();
  const t0 = Date.now();
  const result = await runPlan({
    host: HOST,
    remoteEnv: REMOTE_ENV,
    udid,
    plan,
    vars: { EMAIL: email },
    readOtp: async () => {
      const { readSignInCode } = await import("./e2e-otp.ts");
      const { code, date } = await readSignInCode(mailbox, email, { notBefore: started });
      console.log(`  sign-in code arrived (${date})`);
      return code;
    },
  });
  const total = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${result.ok ? "GREEN" : "RED"}: ${result.steps.filter((s) => s.status === "pass").length}/${plan.steps.length} steps in ${total}s (maestro start ${(result.mcpStartMs / 1000).toFixed(1)}s)`);
  if (recording) {
    const capture = await recording.stop(`${name}-capture`);
    if (capture) {
      const steps = plan.steps.map((s) => {
        const r = result.steps.find((x) => x.name === s.name);
        return r ? { name: s.name, status: r.status, at: r.at } : { name: s.name, status: "todo" as const };
      });
      const out = `${LOCAL_E2E}/${name}.mp4`;
      // Rendering takes half a minute on this box and needs nothing from the
      // device, so it runs after the lock is released (see main).
      afterRelease = async () => {
        const ok = await composeStepVideo({ capture, out, recordingStartedAt, steps, title: `${name} · ${result.ok ? "green" : "red"} · ${total}s` });
        console.log(ok ? `\nVideo: ${out}` : "Could not compose the step video; the raw capture is next to it.");
      };
    }
  }
  if (needsOtp) console.log(`Test account left in place: ${email}. Account deletion finishes in the browser, so the runner cannot remove it.`);
  return result.ok ? 0 : 1;
}

async function startRecording(udid: string) {
  const name = `capture-${Date.now()}.mp4`;
  const remote = `~/${REMOTE_DIR}/${name}`;
  // One recorder per device. A capture left running by a killed run answers
  // "Host recording is already in progress" to the next one. Signalled by pid:
  // a `pkill -f` pattern also matches the shell that runs it.
  await ssh(
    `for p in $(pgrep -f "simctl io ${udid} recordVideo"); do kill -INT $p; done; sleep 2`,
    { allowFail: true },
  );
  const { out } = await ssh(
    `rm -f ${remote}; nohup xcrun simctl io ${udid} recordVideo --codec h264 --force ${remote} >/dev/null 2>&1 & echo $!`,
  );
  const pid = out.trim();
  if (!/^\d+$/.test(pid)) throw new Error(`Could not start the device recorder: ${out}`);
  console.log("Recording the device.");
  return {
    async stop(flowName: string) {
      // SIGINT is how simctl finalises the file. Wait for the process to go
      // before copying, or the mp4 has no moov atom and will not play.
      await ssh(
        `kill -INT ${pid}; for i in 1 2 3 4 5 6 7 8 9 10; do sleep 1; kill -0 ${pid} 2>/dev/null || break; done`,
        { allowFail: true },
      );
      const dest = `${LOCAL_E2E}/${flowName}.mp4`;
      const p = Bun.spawn(["scp", "-q", "-o", "BatchMode=yes", `${HOST}:${remote}`, dest], { stdout: "inherit", stderr: "inherit" });
      if ((await p.exited) !== 0) {
        console.warn("Could not fetch the recording.");
        return null;
      }
      console.log(`\nRecording: ${dest}`);
      return dest;
    },
  };
}

async function main() {
  if (has("help")) {
    console.log(
      "bun run test:e2e [--plan NAME] [--flow NAME|onboarding] [--record] [--inspect] [--install URL|PATH] [--device NAME]",
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

    const install = arg("install");
    if (install) {
      await installApp(udid, install);
      if (!arg("flow") && !arg("plan")) return 0;
    }
    const planName = arg("plan");
    if (planName) return await runJevPlan(udid, planName);
    await pushFlows();
    const flow = arg("flow");
    if (flow === "onboarding") return await runOnboarding(udid);
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

const code = await main();
if (afterRelease) await afterRelease();
process.exit(code);
