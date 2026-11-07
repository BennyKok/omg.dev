// `omg update` exists because the capability was reachable twice and obvious
// neither time: a button in the web UI, and `omg setup`, which reads like it
// might reconfigure the machine. From a terminal there was no answer to "how do
// I just update?".
//
// It deliberately drives the same code path the UI button does, so there is one
// update mechanism rather than a second that drifts out of step with it.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cmdUpdate, localServeControl, restartLocalService, restartRunningService, type ServeIdentity } from "./update.ts";

const realFetch = globalThis.fetch;
const cleanup: string[] = [];
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const root of cleanup.splice(0)) rmSync(root, { recursive: true, force: true });
});

function harness(channel: string) {
  const output: string[] = [];
  return {
    output,
    deps: {
      root: "/opt/omg",
      install: { channel, repoSlug: "BennyKok/omg.dev" } as never,
      output: (message: string) => output.push(message),
    },
  };
}

describe("argument handling", () => {
  test("help is read-only and names the flag", async () => {
    const h = harness("release");
    await cmdUpdate(["--help"], h.deps);
    expect(h.output[0]).toContain("omg update");
    expect(h.output.join("\n")).toContain("--check");
  });

  test("an unknown option is rejected rather than ignored", async () => {
    const h = harness("release");
    await expect(cmdUpdate(["--forse"], h.deps)).rejects.toThrow("Unknown update option");
  });
});

describe("installs that cannot update themselves", () => {
  // A container image is rebuilt and redeployed. Saying so beats failing
  // halfway through swapping files in a filesystem that will not persist.
  test("a container install explains itself instead of trying", async () => {
    const h = harness("container");
    await expect(cmdUpdate([], h.deps)).rejects.toThrow("container install");
    expect(h.output).toEqual([]);
  });

  test("an unrecognised channel does not attempt an update", async () => {
    const h = harness("unknown");
    await expect(cmdUpdate([], h.deps)).rejects.toThrow("Update it through the deployment");
  });
});

// On an omg.dev Computer the old command installed the new bundle, printed
// "Restarting the service…", and restarted nothing. The Computer then served
// the old code until someone killed serve by hand. These cases pin the
// replacement: the running service is asked to restart, and the command only
// succeeds once a NEW process reports the version on disk.
describe("restarting the running service", () => {
  type Boot = ServeIdentity | null;

  function restartHarness(opts: {
    disk: string;
    boots: Boot[];
    refuse?: string;
  }) {
    const output: string[] = [];
    const restarts: string[] = [];
    let i = 0;
    const deps = {
      root: "/opt/omg",
      install: { channel: "release" } as never,
      output: (m: string) => output.push(m),
      diskVersion: () => opts.disk,
      sleep: async () => {},
      restartTimeoutMs: 50,
      pollIntervalMs: 0,
      serve: {
        probe: async () => opts.boots[Math.min(i++, opts.boots.length - 1)] ?? null,
        requestRestart: async (channel: "source" | "release") => {
          if (opts.refuse) throw new Error(opts.refuse);
          restarts.push(channel);
        },
      },
    };
    return { output, restarts, deps };
  }

  test("an old service is restarted and the new version is reported", async () => {
    const h = restartHarness({
      disk: "0.6.138",
      boots: [{ bootId: "a" }, { bootId: "a" }, null, { bootId: "b", version: "0.6.138" }],
    });
    await restartRunningService(h.deps, "release");
    expect(h.restarts).toEqual(["release"]);
    expect(h.output.at(-1)).toBe("The service now runs omg.dev 0.6.138.");
  });

  test("a service that keeps its boot id fails loudly with the old version named", async () => {
    const h = restartHarness({
      disk: "0.6.138",
      boots: [{ bootId: "a", version: "0.6.137" }],
    });
    await expect(restartRunningService(h.deps, "release")).rejects.toThrow(
      "still runs the old code (0.6.137)",
    );
  });

  test("a restarted service on the wrong version fails loudly", async () => {
    const h = restartHarness({
      disk: "0.6.138",
      boots: [{ bootId: "a", version: "0.6.137" }, { bootId: "b", version: "0.6.137" }],
    });
    await expect(restartRunningService(h.deps, "release")).rejects.toThrow(
      "runs 0.6.137, not the installed 0.6.138",
    );
  });

  test("a service that never comes back is an error", async () => {
    const h = restartHarness({ disk: "0.6.138", boots: [{ bootId: "a", version: "0.6.137" }, null] });
    await expect(restartRunningService(h.deps, "release")).rejects.toThrow("did not come back");
  });

  test("a refused restart surfaces the service's reason", async () => {
    const h = restartHarness({
      disk: "0.6.138",
      boots: [{ bootId: "a", version: "0.6.137" }],
      refuse: "Automatic restart is unavailable on this install.",
    });
    await expect(restartRunningService(h.deps, "release")).rejects.toThrow("Automatic restart is unavailable");
  });

  test("a service already on the disk version is left alone", async () => {
    const h = restartHarness({ disk: "0.6.138", boots: [{ bootId: "a", version: "0.6.138" }] });
    await restartRunningService(h.deps, "release");
    expect(h.restarts).toEqual([]);
    expect(h.output).toEqual(["The service already runs omg.dev 0.6.138."]);
  });

  test("no running service is not an error", async () => {
    const h = restartHarness({ disk: "0.6.138", boots: [null] });
    await restartRunningService(h.deps, "release");
    expect(h.restarts).toEqual([]);
    expect(h.output[0]).toContain("not running");
  });

  test("restart-only recovery does not contact GitHub", async () => {
    globalThis.fetch = (async () => { throw new Error("No download or release check is allowed."); }) as unknown as typeof fetch;
    const h = restartHarness({
      disk: "0.7.1",
      boots: [{ bootId: "a", version: "0.6.203" }, { bootId: "a", version: "0.6.203" }, { bootId: "b", version: "0.7.1" }],
    });
    await cmdUpdate(["--restart"], h.deps);
    expect(h.restarts).toEqual(["release"]);
    expect(h.output.at(-1)).toBe("The service now runs omg.dev 0.7.1.");
  });

  test("a desktop runtime blocks updates before any download or restart", async () => {
    let requests = 0;
    globalThis.fetch = (async () => { requests++; throw new Error("Unexpected network request."); }) as unknown as typeof fetch;
    const h = restartHarness({
      disk: "0.7.1",
      boots: [{ bootId: "desktop", version: "0.6.203", desktopRuntimeId: "ba32ae39" }],
    });
    for (const args of [[], ["--check"], ["--restart"]]) {
      await expect(cmdUpdate(args, h.deps)).rejects.toThrow("Quit the desktop app fully");
    }
    expect(requests).toBe(0);
    expect(h.restarts).toEqual([]);
    expect(h.output.join("\n")).toContain("Running: omg.dev 0.6.203.");
  });

  test("a service from another install is not restarted even on the same version", async () => {
    const h = restartHarness({ disk: "0.7.1", boots: [{ bootId: "a", version: "0.7.1", root: "/other/omg" }] });
    await expect(restartRunningService(h.deps, "release")).rejects.toThrow("service runs from /other/omg");
    expect(h.restarts).toEqual([]);
  });

  test("a desktop app taking the port during restart is not reported as success", async () => {
    const h = restartHarness({
      disk: "0.7.1",
      boots: [{ bootId: "a", version: "0.6.203" }, { bootId: "desktop", version: "0.7.1", desktopRuntimeId: "desktop" }],
    });
    await expect(restartRunningService(h.deps, "release")).rejects.toThrow("desktop app");
    expect(h.output.join("\n")).not.toContain("service now runs");
  });

  test("check reports a pending restart from the service version, not the CLI version", async () => {
    const root = mkdtempSync(join(tmpdir(), "omg-update-status-"));
    cleanup.push(root);
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "0.7.1" }));
    const requests: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      requests.push(String(input));
      return Response.json({ tag_name: "v0.7.1" });
    }) as typeof fetch;
    const h = restartHarness({ disk: "0.7.1", boots: [{ bootId: "a", version: "0.6.203" }] });
    await cmdUpdate(["--check"], { ...h.deps, root, install: { channel: "release", repoSlug: "example/status", source: "file", updateCommand: "omg update" } });
    expect(h.output.at(-1)).toContain("starts after a restart (running 0.6.203)");
    expect(h.restarts).toEqual([]);
    expect(requests).toEqual(["https://api.github.com/repos/example/status/releases/latest"]);
  });
});

// The real HTTP client against a stand-in service that behaves like serve on a
// Computer: POST /api/install makes it "exit" and come back with a new boot id
// running the staged version.
describe("localServeControl", () => {
  test("preserves desktop and install identity from the readiness response", async () => {
    const identity = { bootId: "a", version: "0.6.203", desktopRuntimeId: "desktop", root: "/app/runtime" };
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json(identity) });
    try {
      expect(await localServeControl(`http://127.0.0.1:${server.port}`).probe()).toEqual(identity);
    } finally { server.stop(true); }
  });

  test("a legacy install rejection falls back to the local service manager and verifies the new process", async () => {
    let boot = { bootId: "old", version: "0.6.203" };
    let nativeRestarts = 0;
    const server = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      fetch: req => req.method === "POST"
        ? Response.json({ error: "UI updates are only available for Git and release installs." }, { status: 400 })
        : Response.json(boot),
    });
    try {
      const output: string[] = [];
      await restartRunningService({
        ...harness("release").deps,
        output: message => output.push(message),
        diskVersion: () => "0.7.1", sleep: async () => {}, restartTimeoutMs: 100, pollIntervalMs: 0,
        serve: localServeControl(`http://127.0.0.1:${server.port}`, () => {
          nativeRestarts++;
          boot = { bootId: "new", version: "0.7.1" };
        }),
      }, "release");
      expect(nativeRestarts).toBe(1);
      expect(output.at(-1)).toBe("The service now runs omg.dev 0.7.1.");
    } finally { server.stop(true); }
  });

  test("native restart is not a fallback for authorization or concurrency failures", async () => {
    let restarts = 0;
    for (const status of [401, 403, 409, 500]) {
      const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => Response.json({ error: "refused" }, { status }) });
      try {
        await expect(localServeControl(`http://127.0.0.1:${server.port}`, () => { restarts++; }).requestRestart("release"))
          .rejects.toThrow("refused");
      } finally { server.stop(true); }
    }
    expect(restarts).toBe(0);
  });
  test("drives a release restart over the same routes serve exposes", async () => {
    let boot = { bootId: "old", version: "0.6.137" };
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/install" && req.method === "GET" && url.searchParams.get("ready") === "1") {
          return Response.json(boot);
        }
        if (url.pathname === "/api/install" && req.method === "POST") {
          setTimeout(() => { boot = { bootId: "new", version: "0.6.138" }; }, 20);
          return Response.json({ restarting: true });
        }
        return new Response("nope", { status: 404 });
      },
    });
    try {
      const output: string[] = [];
      await restartRunningService({
        root: "/opt/omg",
        install: { channel: "release" } as never,
        output: m => output.push(m),
        diskVersion: () => "0.6.138",
        sleep: ms => new Promise(r => setTimeout(r, ms)),
        restartTimeoutMs: 2_000,
        pollIntervalMs: 10,
        serve: localServeControl(`http://127.0.0.1:${server.port}`),
      }, "release");
      expect(output.at(-1)).toBe("The service now runs omg.dev 0.6.138.");
    } finally {
      server.stop(true);
    }
  });

  test("a service that refuses the restart is reported with its error text", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => Response.json({ error: "An omg.dev update is already running." }, { status: 409 }),
    });
    try {
      await expect(localServeControl(`http://127.0.0.1:${server.port}`).requestRestart("release"))
        .rejects.toThrow("already running");
    } finally {
      server.stop(true);
    }
  });

  test("nothing listening reads as no service", async () => {
    expect(await localServeControl("http://127.0.0.1:1").probe()).toBeNull();
  });
});

test("a supervisor-loop restart cannot signal the update CLI itself", () => {
  let ran = false;
  expect(() => restartLocalService({ command: ["/bin/kill", "-TERM", String(process.pid)] }, () => {
    ran = true;
    throw new Error("must not execute");
  })).toThrow("cannot be restarted from the command line");
  expect(ran).toBe(false);
});
