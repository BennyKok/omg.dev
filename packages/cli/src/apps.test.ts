import { describe, expect, test } from "bun:test";
import {
  APP_COMMANDS,
  APPS_CLI_ENTRY,
  APPS_CLI_SPEC,
  APPS_CLI_TARBALL,
  APPS_CLI_VERSION,
  appsEntryPath,
  ensureAppsCli,
  resolveAppRunner,
  runAppCommand,
} from "./apps.ts";

describe("hosted app verbs stay on this omg binary", () => {
  test("create, deploy, and login are in the forwarded set", () => {
    expect(APP_COMMANDS.has("create")).toBe(true);
    expect(APP_COMMANDS.has("deploy")).toBe(true);
    expect(APP_COMMANDS.has("login")).toBe(true);
    expect(APP_COMMANDS.has("computer")).toBe(false);
    expect(APP_COMMANDS.has("serve")).toBe(false);
  });

  test("the pin is the last published create/deploy CLI, not a stub", () => {
    expect(APPS_CLI_SPEC).toBe("@omg-dev/cli@0.4.42");
    expect(APPS_CLI_VERSION).toBe("0.4.42");
    expect(APPS_CLI_TARBALL).toContain("cli-0.4.42.tgz");
    expect(APPS_CLI_ENTRY).toBe("dist/omg-bun.mjs");
  });
});

describe("resolveAppRunner", () => {
  test("OMG_APPS_BIN wins so tests and local checkouts can inject a runner", async () => {
    const resolved = await resolveAppRunner({
      env: { OMG_APPS_BIN: "/opt/custom-apps" },
      which: () => "/usr/bin/omg-apps",
    });
    expect(resolved).toEqual({ command: ["/opt/custom-apps"], source: "override" });
  });

  test("uses omg-apps on PATH when present, without asking the user to type it", async () => {
    const resolved = await resolveAppRunner({
      env: {},
      which: (name) => (name === "omg-apps" ? "/usr/bin/omg-apps" : null),
    });
    expect(resolved).toEqual({ command: ["/usr/bin/omg-apps"], source: "omg-apps" });
  });

  test("falls back to the cached 0.4.42 entry run with Bun", async () => {
    const home = "/tmp/apps-home";
    const entry = appsEntryPath(home);
    const resolved = await resolveAppRunner({
      env: {},
      which: () => null,
      homedir: () => home,
      exists: (path) => path === entry,
      execPath: "/opt/bun/bin/bun",
    });
    expect(resolved.source).toBe("pinned-0.4.42");
    expect(resolved.command).toEqual(["/opt/bun/bin/bun", entry]);
  });
});

describe("ensureAppsCli", () => {
  test("downloads the pinned tarball once when the cache is empty", async () => {
    const home = "/tmp/empty-apps-home";
    const fetched: string[] = [];
    const extracted: string[][] = [];
    const made: string[] = [];
    const written: string[] = [];
    const entry = appsEntryPath(home);
    let extractedNow = false;
    const path = await ensureAppsCli({
      homedir: () => home,
      exists: (candidate) => extractedNow && candidate === entry,
      mkdir: (directory) => {
        made.push(directory);
      },
      fetchBuffer: async (url) => {
        fetched.push(url);
        return new Uint8Array([1, 2, 3]);
      },
      writeFile: (file) => {
        written.push(file);
      },
      extract: async (tarball, dest) => {
        extracted.push([tarball, dest]);
        extractedNow = true;
        return 0;
      },
    });
    expect(path).toBe(entry);
    expect(fetched).toEqual([APPS_CLI_TARBALL]);
    expect(made).toEqual([`${home}/.omg/apps-cli/0.4.42`]);
    expect(extracted).toHaveLength(1);
    expect(extracted[0]?.[1]).toBe(`${home}/.omg/apps-cli/0.4.42`);
    expect(written).toHaveLength(1);
  });

  test("reuses the cache and does not download again", async () => {
    let fetched = 0;
    const path = await ensureAppsCli({
      homedir: () => "/tmp/cached-apps-home",
      exists: () => true,
      fetchBuffer: async () => {
        fetched += 1;
        return new Uint8Array();
      },
    });
    expect(path).toBe(appsEntryPath("/tmp/cached-apps-home"));
    expect(fetched).toBe(0);
  });
});

describe("runAppCommand", () => {
  test("spawns the resolved runner with the original argv", async () => {
    const spawned: string[][] = [];
    const code = await runAppCommand(["create", "my-app", "--no-install"], {
      env: { OMG_APPS_BIN: "/tmp/apps" },
      spawn: async (argv) => {
        spawned.push(argv);
        return 7;
      },
    });
    expect(code).toBe(7);
    expect(spawned).toEqual([["/tmp/apps", "create", "my-app", "--no-install"]]);
  });

  test("reports a clear error when the runner cannot start", async () => {
    const lines: string[] = [];
    const code = await runAppCommand(["login"], {
      env: {},
      which: () => null,
      homedir: () => "/tmp/missing-apps",
      exists: () => false,
      fetchBuffer: async () => {
        throw new Error("registry unavailable");
      },
      error: (line) => {
        lines.push(line);
      },
    });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("could not start login");
    expect(lines.join("\n")).toContain("registry unavailable");
  });
});
