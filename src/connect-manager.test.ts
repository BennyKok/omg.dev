import { describe, expect, test } from "bun:test";
import { CONNECT_AUTH_REJECTED_EXIT_CODE, ConnectManager } from "./connect-manager.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture() {
  let revision: string | null = null;
  let nextPid = 100;
  const children: Array<{
    pid: number;
    exited: ReturnType<typeof deferred<number>>;
    killed: boolean;
    stdinEnded: boolean;
  }> = [];
  const logs: string[] = [];
  const manager = new ConnectManager({
    credentialRevision: () => revision,
    spawn: () => {
      const child = {
        pid: nextPid++,
        exited: deferred<number>(),
        killed: false,
        stdinEnded: false,
      };
      children.push(child);
      return {
        pid: child.pid,
        exited: child.exited.promise,
        kill: () => {
          child.killed = true;
        },
        stdin: {
          end: () => {
            child.stdinEnded = true;
          },
        },
      };
    },
    setInterval: () => 1 as unknown as ReturnType<typeof setInterval>,
    clearInterval: () => {},
    log: (message) => logs.push(message),
  });
  return {
    manager,
    children,
    logs,
    setRevision(value: string | null) {
      revision = value;
    },
  };
}

describe("daemon-managed relay lifecycle", () => {
  test("starts only when a saved binding exists", async () => {
    const f = fixture();
    expect(await f.manager.reconcile()).toEqual({ state: "unpaired", pid: null });
    expect(f.children).toHaveLength(0);

    f.setRevision("binding-a");
    expect(await f.manager.reconcile()).toEqual({ state: "running", pid: 100 });
    expect(await f.manager.reconcile()).toEqual({ state: "running", pid: 100 });
    expect(f.children).toHaveLength(1);
  });

  test("restarts for a fresh pairing and stops after disconnect", async () => {
    const f = fixture();
    f.setRevision("binding-a");
    await f.manager.reconcile();

    f.setRevision("binding-b");
    expect(await f.manager.reconcile()).toEqual({ state: "running", pid: 101 });
    expect(f.children[0]?.stdinEnded).toBe(true);
    expect(f.children[0]?.killed).toBe(true);

    f.setRevision(null);
    expect(await f.manager.reconcile()).toEqual({ state: "unpaired", pid: null });
    expect(f.children[1]?.stdinEnded).toBe(true);
    expect(f.children[1]?.killed).toBe(true);
  });

  test("does not retry rejected credentials until pairing changes them", async () => {
    const f = fixture();
    f.setRevision("rejected-binding");
    await f.manager.reconcile();
    f.children[0]!.exited.resolve(CONNECT_AUTH_REJECTED_EXIT_CODE);
    await Promise.resolve();

    expect(await f.manager.reconcile()).toEqual({ state: "auth-rejected", pid: null });
    expect(f.children).toHaveLength(1);

    f.setRevision("fresh-binding");
    expect(await f.manager.reconcile()).toEqual({ state: "running", pid: 101 });
  });

  test("restarts an unexpected worker exit", async () => {
    const f = fixture();
    f.setRevision("binding-a");
    await f.manager.reconcile();
    f.children[0]!.exited.resolve(1);
    await Promise.resolve();

    expect(await f.manager.reconcile()).toEqual({ state: "running", pid: 101 });
    expect(f.logs.some((line) => line.includes("restarting"))).toBe(true);
  });
});
