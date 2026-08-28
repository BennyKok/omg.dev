import { createHash } from "node:crypto";
import {
  lstatSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  DEFAULT_DESKTOP_RUNTIME_ORIGIN,
  desktopRuntimeStateRoot,
  embeddedRuntimeFingerprint,
  embeddedRuntimeArchiveCandidates,
  embeddedRuntimeCandidates,
  ensureRuntime,
  prepareEmbeddedRuntime,
  readDesktopRuntimeRecord,
  runtimeReadyInfo,
  runtimeIsReady,
  runtimeOrigin,
  waitForRuntime,
  writeDesktopRuntimeRecord,
  type OwnedRuntimeProcess,
} from "./runtime";

let ownershipState = "";

beforeEach(() => {
  ownershipState = mkdtempSync(join(tmpdir(), "omg-desktop-ownership-"));
});

afterEach(() => {
  rmSync(ownershipState, { force: true, recursive: true });
});

describe("runtimeOrigin", () => {
  test("uses the fixed local omg.dev origin by default", () => {
    expect(runtimeOrigin({})).toBe(DEFAULT_DESKTOP_RUNTIME_ORIGIN);
  });

  test("accepts a local port override", () => {
    expect(runtimeOrigin({ OMG_PORT: "9876" })).toBe("http://127.0.0.1:9876");
    expect(runtimeOrigin({ OMG_DESKTOP_URL: "http://localhost:9000/" })).toBe(
      "http://localhost:9000",
    );
  });

  test("rejects a remote or authenticated origin", () => {
    expect(() => runtimeOrigin({ OMG_DESKTOP_URL: "https://omg.dev" })).toThrow(
      "HTTP loopback",
    );
    expect(() => runtimeOrigin({ OMG_DESKTOP_URL: "http://user@localhost:8766" })).toThrow(
      "only an origin",
    );
  });
});

describe("runtime readiness", () => {
  test("accepts only the omg.dev ready response", async () => {
    const readyFetch = async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("http://127.0.0.1:8766/api/install?ready=1");
      return Response.json({ bootId: "boot-123" });
    };
    const unrelatedFetch = async () => Response.json({ ok: true });

    expect(await runtimeIsReady(DEFAULT_DESKTOP_RUNTIME_ORIGIN, readyFetch)).toBe(true);
    expect(await runtimeIsReady(DEFAULT_DESKTOP_RUNTIME_ORIGIN, unrelatedFetch)).toBe(false);
    expect(await runtimeReadyInfo(DEFAULT_DESKTOP_RUNTIME_ORIGIN, readyFetch)).toEqual({
      bootId: "boot-123",
      desktopRuntimeFingerprint: null,
      desktopRuntimeId: null,
    });
  });

  test("keeps trying until the background service is ready", async () => {
    let attempts = 0;
    const fetcher = async () => {
      attempts += 1;
      return attempts < 3
        ? new Response("offline", { status: 503 })
        : Response.json({ bootId: "boot-456" });
    };

    expect(
      await waitForRuntime(DEFAULT_DESKTOP_RUNTIME_ORIGIN, {
        fetch: fetcher,
        intervalMs: 1,
      }),
    ).toBe(true);
    expect(attempts).toBe(3);
  });

  test("stops waiting at the requested timeout", async () => {
    const started = Date.now();
    expect(
      await waitForRuntime(DEFAULT_DESKTOP_RUNTIME_ORIGIN, {
        fetch: async () => new Response("offline", { status: 503 }),
        intervalMs: 1,
        timeoutMs: 5,
      }),
    ).toBe(false);
    expect(Date.now() - started).toBeLessThan(100);
  });
});

function fakeProcess(): OwnedRuntimeProcess & { kills: (number | NodeJS.Signals | undefined)[] } {
  const kills: (number | NodeJS.Signals | undefined)[] = [];
  return {
    exited: new Promise(() => {}),
    kill: (signal) => {
      kills.push(signal);
    },
    kills,
    pid: 1234,
  };
}

describe("desktop runtime ownership", () => {
  test("starts its own runtime even when the preferred origin is healthy", async () => {
    const child = fakeProcess();
    const waits: string[] = [];
    let preferredPort = 0;
    const connection = await ensureRuntime({
      choosePort: async (port) => {
        preferredPort = port;
        return 9123;
      },
      launch: () => child,
      fingerprint: "current",
      runtimeId: "desktop-runtime-test",
      stateRoot: ownershipState,
      wait: async (origin) => {
        waits.push(origin);
        return true;
      },
    });

    expect(preferredPort).toBe(8766);
    expect(waits).toEqual(["http://127.0.0.1:9123"]);
    expect(connection).toEqual({
      origin: "http://127.0.0.1:9123",
      owner: "desktop",
      process: child,
    });
  });

  test("waits for the embedded runtime before returning its connection", async () => {
    const child = fakeProcess();
    const waits: string[] = [];
    const connection = await ensureRuntime({
      choosePort: async () => 9123,
      fingerprint: "current",
      launch: (port) => {
        expect(port).toBe(9123);
        return child;
      },
      runtimeId: "desktop-runtime-test",
      stateRoot: ownershipState,
      wait: async (origin) => {
        waits.push(origin);
        return origin === "http://127.0.0.1:9123";
      },
    });

    expect(waits).toEqual(["http://127.0.0.1:9123"]);
    expect(connection.owner).toBe("desktop");
    expect(connection.process).toBe(child);
  });

  test("stops a child that never becomes ready", async () => {
    const child = fakeProcess();
    await expect(
      ensureRuntime({
        choosePort: async () => 9123,
        fingerprint: "current",
        launch: () => child,
        runtimeId: "desktop-runtime-test",
        stateRoot: ownershipState,
        wait: async () => false,
      }),
    ).rejects.toThrow("startup timeout");
    expect(child.kills).toEqual([undefined]);
    expect(readDesktopRuntimeRecord(ownershipState)).toBeNull();
  });

  test("reconnects to the same current background runtime", async () => {
    writeDesktopRuntimeRecord(
      {
        fingerprint: "current",
        origin: "http://127.0.0.1:9123",
        pid: 4321,
        runtimeId: "desktop-runtime-test",
      },
      ownershipState,
    );

    const connection = await ensureRuntime({
      choosePort: async () => {
        throw new Error("must not choose a new port");
      },
      fingerprint: "current",
      inspect: async () => ({
        bootId: "boot-existing",
        desktopRuntimeFingerprint: "current",
        desktopRuntimeId: "desktop-runtime-test",
      }),
      launch: () => {
        throw new Error("must not launch a second runtime");
      },
      runtimeId: "desktop-runtime-test",
      stateRoot: ownershipState,
    });

    expect(connection).toEqual({
      origin: "http://127.0.0.1:9123",
      owner: "desktop",
    });
  });

  test("replaces an older background runtime when the embedded app changes", async () => {
    writeDesktopRuntimeRecord(
      {
        fingerprint: "old",
        origin: "http://127.0.0.1:9123",
        pid: 4321,
        runtimeId: "desktop-runtime-test",
      },
      ownershipState,
    );
    let running = true;
    const stopped: number[] = [];
    const child = fakeProcess();

    const connection = await ensureRuntime({
      choosePort: async () => 9123,
      fingerprint: "current",
      inspect: async () =>
        running
          ? {
              bootId: "boot-old",
              desktopRuntimeFingerprint: "old",
              desktopRuntimeId: "desktop-runtime-test",
            }
          : null,
      launch: () => child,
      runtimeId: "desktop-runtime-test",
      stateRoot: ownershipState,
      stop: async (pid) => {
        stopped.push(pid);
        running = false;
      },
      wait: async () => true,
    });

    expect(stopped).toEqual([4321]);
    expect(connection.process).toBe(child);
    expect(readDesktopRuntimeRecord(ownershipState)).toEqual({
      fingerprint: "current",
      origin: "http://127.0.0.1:9123",
      pid: 1234,
      runtimeId: "desktop-runtime-test",
    });
  });
});

describe("embedded runtime paths", () => {
  test("checks packaged, staged, then source runtime locations", () => {
    expect(embeddedRuntimeCandidates("/app/Resources/app/bun")).toEqual([
      "/app/Resources/app/embedded-runtime",
      "/app/Resources/embedded-runtime",
      "/app",
    ]);
    expect(embeddedRuntimeArchiveCandidates("/app/Resources/app/bun")).toEqual([
      "/app/Resources/app/embedded-runtime.tar.gz",
      "/app/Resources/embedded-runtime.tar.gz",
    ]);
    expect(embeddedRuntimeFingerprint(["/missing/archive.tar.gz"])).toBe("source");
  });

  test("extracts the packaged archive once and preserves dependency links", async () => {
    const root = mkdtempSync(join(tmpdir(), "omg-desktop-runtime-"));
    try {
      const fixture = join(root, "fixture");
      mkdirSync(join(fixture, "src"), { recursive: true });
      mkdirSync(join(fixture, "web", "dist"), { recursive: true });
      mkdirSync(join(fixture, "node_modules", "real-package"), { recursive: true });
      writeFileSync(join(fixture, "src", "cli.ts"), "console.log('ok')\n");
      writeFileSync(join(fixture, "web", "dist", "index.html"), "<div id=\"root\"></div>\n");
      symlinkSync("real-package", join(fixture, "node_modules", "linked-package"));

      const archive = join(root, "embedded-runtime.tar.gz");
      const packed = Bun.spawnSync({
        cmd: ["/usr/bin/tar", "-C", fixture, "-czf", archive, "."],
      });
      expect(packed.exitCode).toBe(0);
      const fingerprint = createHash("sha256").update(readFileSync(archive)).digest("hex");
      writeFileSync(`${archive}.sha256`, `${fingerprint}\n`);

      const state = join(root, "state");
      const staleRuntime = join(state, "apps", "a".repeat(20));
      mkdirSync(staleRuntime, { recursive: true });
      const first = await prepareEmbeddedRuntime(state, [archive]);
      const second = await prepareEmbeddedRuntime(state, [archive]);
      expect(second).toBe(first);
      expect(readFileSync(join(first, "src", "cli.ts"), "utf8")).toContain("ok");
      expect(lstatSync(join(first, "node_modules", "linked-package")).isSymbolicLink()).toBe(
        true,
      );
      expect(existsSync(staleRuntime)).toBe(false);
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  test("stores mutable state outside the packaged application", () => {
    expect(desktopRuntimeStateRoot("darwin", {}, "/Users/me")).toBe(
      "/Users/me/Library/Application Support/dev.omg.desktop/runtime",
    );
    expect(desktopRuntimeStateRoot("linux", {}, "/home/me")).toBe(
      "/home/me/.local/share/dev.omg.desktop/runtime",
    );
    expect(
      desktopRuntimeStateRoot("linux", { XDG_DATA_HOME: "/data/me" }, "/home/me"),
    ).toBe("/data/me/dev.omg.desktop/runtime");
  });
});
