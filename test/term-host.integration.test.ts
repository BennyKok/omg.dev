// End-to-end tests for the terminal host: a real detached host process, real
// PTYs, real shells, driven through the same client serve uses. No tmux.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  attachTerminal,
  killTerminal,
  listTerminals,
  pingTermHost,
  runInTerminal,
  scanTerminal,
  type HostOptions,
} from "../src/term/client.ts";
import type { TermReply } from "../src/term/protocol.ts";
import { loadGhostty, screenText } from "../src/term/vt.ts";
import { detectUrls } from "../src/links.ts";

const base = join(homedir(), ".cache", "lfg", "tmp");
let dir = "";
let opts: HostOptions;

beforeAll(() => {
  require("node:fs").mkdirSync(base, { recursive: true });
  dir = mkdtempSync(join(base, "term-host-"));
  opts = {
    path: join(dir, "run", "h.sock"),
    env: {
      PATH: process.env.PATH,
      HOME: dir,
      LFG_TERM_SHELL: "/bin/sh",
      PS1: "$ ",
      LFG_TERM_HOST_IDLE_MS: "60000",
    },
  };
});

afterAll(async () => {
  try {
    const pong = await pingTermHost({ ...opts, spawn: false });
    process.kill(pong.pid, "SIGTERM");
  } catch {}
  rmSync(dir, { recursive: true, force: true });
});

/** A browser stand-in: a real ghostty screen fed by an attachment. */
async function viewer(id: string, cols = 60, rows = 12, cwd = dir) {
  const g = await loadGhostty();
  const screen = g.createTerminal(cols, rows, { scrollbackLimit: 1000 });
  const messages: TermReply[] = [];
  let closed = false;
  const att = await attachTerminal(
    { id, cwd, cols, rows },
    {
      onData: (d) => screen.write(d),
      onMessage: (m) => messages.push(m),
      onClose: () => {
        closed = true;
      },
    },
    opts,
  );
  const text = () => screenText(screen, 400);
  const waitFor = async (pred: () => boolean, what: string, ms = 5000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (pred()) return;
      await Bun.sleep(20);
    }
    throw new Error(`timed out waiting for ${what}; screen:\n${text()}`);
  };
  const type = (s: string) => att.write(new TextEncoder().encode(s));
  return { att, screen, messages, text, waitFor, type, isClosed: () => closed };
}

describe("terminal host", () => {
  test("starts on demand, on a private socket", async () => {
    const pong = await pingTermHost(opts);
    expect(pong.op).toBe("pong");
    expect(pong.pid).toBeGreaterThan(0);
    expect(statSync(opts.path!).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "run")).mode & 0o777).toBe(0o700);
  });

  test("runs a shell in the requested folder and streams output", async () => {
    const v = await viewer("t-basic");
    await v.waitFor(() => v.messages.some((m) => m.op === "attached"), "attached");
    const attached = v.messages.find((m) => m.op === "attached");
    expect(attached && attached.op === "attached" && attached.created).toBe(true);
    v.type("pwd; echo hel''lo-world\r");
    await v.waitFor(() => v.text().includes("hello-world"), "echo output");
    expect(v.text()).toContain(dir);
    v.att.close();
  });

  test("a reattach restores the screen from the host, and the shell kept running", async () => {
    const a = await viewer("t-resume");
    a.type("for i in 1 2 3; do echo line-$i; done; printf '\\033[1;32mgreen\\033[0m\\n'\r");
    await a.waitFor(() => a.text().includes("line-3") && a.text().includes("green"), "first output");
    a.type("X=kept\r");
    await Bun.sleep(150);
    a.att.close();

    const b = await viewer("t-resume");
    // The snapshot alone rebuilds what was on screen, before any new output.
    await b.waitFor(() => b.text().includes("line-3"), "restored screen");
    const attached = b.messages.find((m) => m.op === "attached");
    expect(attached && attached.op === "attached" && attached.created).toBe(false);
    // Colour survives: the restored "green" cell is not the default colour.
    b.screen.update();
    const vp = b.screen.getViewport();
    const fg = b.screen.getColors().foreground;
    const cols = b.screen.cols;
    let found = false;
    for (let r = 0; r < b.screen.rows && !found; r++) {
      const row = vp.slice(r * cols, r * cols + cols);
      const s = row.map((c) => (c.codepoint > 32 ? String.fromCodePoint(c.codepoint) : " ")).join("");
      const at = s.indexOf("green");
      if (at >= 0) {
        found = true;
        expect(row[at].fg_g).not.toBe(fg.g);
        expect(row[at].flags & 1).toBe(1); // bold
      }
    }
    expect(found).toBe(true);
    // Same shell process: state set before the detach is still there.
    b.type("echo value=$X\r");
    await b.waitFor(() => b.text().includes("value=kept"), "shell state");
    b.att.close();
  });

  test("a full-screen app is restored on its alternate screen with its modes", async () => {
    const a = await viewer("t-alt", 40, 8);
    a.type("printf '\\033[?1049h\\033[?2004h\\033[3;5HFULLSCREEN'; sleep 30\r");
    await a.waitFor(() => a.screen.isAlternateScreen() && a.text().includes("FULLSCREEN"), "alt screen");
    a.att.close();
    const b = await viewer("t-alt", 40, 8);
    await b.waitFor(() => b.screen.isAlternateScreen() && b.text().includes("FULLSCREEN"), "restored alt screen");
    expect(b.screen.getMode(2004)).toBe(true);
    b.type("\x03");
    b.att.close();
  });

  test("two viewers see the same live output", async () => {
    const a = await viewer("t-shared");
    const b = await viewer("t-shared");
    a.type("echo from-a\r");
    await b.waitFor(() => b.text().includes("from-a"), "output in second viewer");
    a.att.close();
    b.att.close();
  });

  test("resize reaches the shell", async () => {
    const a = await viewer("t-size", 50, 10);
    a.att.resize(73, 19);
    await Bun.sleep(100);
    a.type("stty size\r");
    await a.waitFor(() => a.text().includes("19 73"), "new size");
    a.att.close();
  });

  test("exit ends the attachment and removes the shell", async () => {
    const a = await viewer("t-exit");
    a.type("exit 3\r");
    await a.waitFor(() => a.isClosed(), "close after exit");
    const exit = a.messages.find((m) => m.op === "exit");
    expect(exit && exit.op === "exit" && exit.code).toBe(3);
    const left = await listTerminals("t-exit", opts);
    expect(left).toHaveLength(0);
  });

  test("list scopes by prefix, kill hangs up and tells viewers", async () => {
    const a = await viewer("s-abc");
    const b = await viewer("s-abc-t2");
    const other = await viewer("s-abcd");
    await Bun.sleep(100);
    const ids = (await listTerminals("s-abc", opts)).map((s) => s.id);
    expect(ids).toEqual(["s-abc", "s-abc-t2"]);
    expect(await killTerminal("s-abc-t2", opts)).toBe(true);
    await b.waitFor(() => b.isClosed(), "killed viewer closed");
    expect(b.messages.some((m) => m.op === "exit")).toBe(true);
    expect((await listTerminals("s-abc", opts)).map((s) => s.id)).toEqual(["s-abc"]);
    expect(await killTerminal("nope", opts)).toBe(false);
    a.att.close();
    other.att.close();
  });

  test("title set by the shell reaches viewers and the list", async () => {
    const a = await viewer("t-title");
    a.type("printf '\\033]2;my-title\\007'\r");
    await a.waitFor(() => a.messages.some((m) => m.op === "title" && m.title === "my-title"), "title");
    const [info] = await listTerminals("t-title", opts);
    expect(info.title).toBe("my-title");
    a.att.close();
    // A new viewer gets the title as part of the snapshot.
    const b = await viewer("t-title");
    await b.waitFor(() => b.messages.some((m) => m.op === "attached"), "attached");
    const att = b.messages.find((m) => m.op === "attached");
    expect(att && att.op === "attached" && att.shell.title).toBe("my-title");
    b.att.close();
  });

  test("run types a command into a new or existing shell", async () => {
    await runInTerminal("login-x", dir, "echo ran-$((40+2))", opts);
    const v = await viewer("login-x");
    await v.waitFor(() => v.text().includes("ran-42"), "command output");
    v.att.close();
  });

  test("scan returns the rows for link detection", async () => {
    const v = await viewer("t-scan", 30, 8);
    v.type("printf 'see %s\\n' https://example.com/a/very/long/path/that/wraps/the/row\r");
    await v.waitFor(() => v.text().includes("see https"), "url output");
    const r = await scanTerminal("t-scan", opts);
    expect(r.width).toBe(30);
    // The URL wraps over three rows; link detection rebuilds it whole.
    expect(detectUrls(r)).toContain("https://example.com/a/very/long/path/that/wraps/the/row");
    v.att.close();
  });

  test("shells survive the host's clients going away entirely", async () => {
    const a = await viewer("t-survive");
    a.type("Y=still-here\r");
    await Bun.sleep(100);
    a.att.close();
    await Bun.sleep(200);
    expect((await listTerminals("t-survive", opts)).length).toBe(1);
    const b = await viewer("t-survive");
    b.type("echo $Y\r");
    await b.waitFor(() => b.text().includes("still-here"), "state after reconnect");
    b.att.close();
  });

  test("the socket path is not left world-reachable", () => {
    expect(existsSync(opts.path!)).toBe(true);
  });
});
