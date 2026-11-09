// The terminal host: owns every browser-terminal shell.
//
// Each shell is a real PTY (src/pty.ts) plus a headless Ghostty screen
// (src/term/vt.ts) that sees every byte the shell prints. Browsers attach and
// detach freely; the shell keeps running, and a new attach gets a snapshot of
// the exact screen before the live stream continues.
//
// This class is transport-free so tests can drive it directly. host-main.ts
// puts it behind a unix socket in its own process, which is what lets shells
// outlive `lfg serve` restarts.
import { readFileSync, existsSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import type { GhosttyTerminal } from "ghostty-web";
import { PtyBridge } from "../pty.ts";
import { loadGhostty, screenText, serializeScreen } from "./vt.ts";
import { TERM_PROTOCOL_VERSION, type TermReply, type TermShellInfo } from "./protocol.ts";

type Vt = GhosttyTerminal;

/** One attached viewer. host-main.ts wraps a socket in this. */
export interface TermClient {
  sendData(data: Uint8Array): void;
  sendMessage(message: TermReply): void;
  /** Called when the shell this client watches exits. */
  end(): void;
}

interface Shell {
  id: string;
  cwd: string;
  createdAt: number;
  pty: PtyBridge;
  vt: Vt;
  cols: number;
  rows: number;
  title: string | null;
  clients: Set<TermClient>;
  /** Last raw bytes, kept for OSC 8 link targets that the screen drops. */
  tail: Uint8Array;
  decoder: TextDecoder;
  /** Partial OSC sequence carried across chunk boundaries. */
  oscCarry: string;
}

export interface TermHostOptions {
  /** argv for a new shell. Defaults to the user's login shell. */
  shell?: string[];
  /** Base environment for shells. Defaults to this process's env. */
  env?: NodeJS.ProcessEnv;
  maxShells?: number;
  scrollback?: number;
  /** Called whenever the last shell goes away. */
  onEmpty?: () => void;
  log?: (line: string) => void;
}

const TAIL_BYTES = 64 * 1024;
const TITLE_RE = /\x1b\]([012]);([^\x07\x1b]*?)(?:\x07|\x1b\\)/g;

export function defaultShell(env: NodeJS.ProcessEnv = process.env): string[] {
  // LFG_TERM_SHELL pins the shell (tests, or an owner who wants another one
  // in the browser than their login shell).
  let shell = env.LFG_TERM_SHELL?.trim() || env.SHELL?.trim();
  if (!shell || !existsSync(shell)) {
    try {
      const name = userInfo().username;
      const line = readFileSync("/etc/passwd", "utf8")
        .split("\n")
        .find((l) => l.startsWith(`${name}:`));
      shell = line?.split(":")[6]?.trim();
    } catch {}
  }
  if (!shell || !existsSync(shell)) shell = existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh";
  // A login shell, as tmux started it: profile files run, PATH is complete.
  return [shell, "-l"];
}

function clampDim(n: unknown, fallback: number): number {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) && v >= 1 ? Math.min(500, v) : fallback;
}

/** Foreground program of a shell's terminal, from /proc. Linux only. */
function foregroundProgram(pid: number | null): string | null {
  if (!pid || process.platform !== "linux") return null;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // Field 2 (comm) may contain spaces and parens; the rest follows the last ')'.
    const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const tpgid = Number(rest[5]);
    const target = tpgid > 0 ? tpgid : pid;
    return readFileSync(`/proc/${target}/comm`, "utf8").trim() || null;
  } catch {
    return null;
  }
}

export class TermHost {
  private shells = new Map<string, Shell>();
  private readonly opts: TermHostOptions;

  constructor(opts: TermHostOptions = {}) {
    this.opts = opts;
  }

  get size(): number {
    return this.shells.size;
  }

  private info(shell: Shell): TermShellInfo {
    return {
      id: shell.id,
      cwd: shell.cwd,
      title: shell.title,
      program: foregroundProgram(shell.pty.pid),
      createdAt: shell.createdAt,
      cols: shell.cols,
      rows: shell.rows,
      clients: shell.clients.size,
    };
  }

  private async create(id: string, cwd: string, cols: number, rows: number): Promise<Shell> {
    const max = this.opts.maxShells ?? 32;
    if (this.shells.size >= max) {
      throw new Error(`too many terminals open (${max}); close one first`);
    }
    const ghostty = await loadGhostty();
    // Another attach may have created it while the engine loaded.
    const raced = this.shells.get(id);
    if (raced) return raced;
    const dir = cwd && existsSync(cwd) ? cwd : homedir();
    const env: Record<string, string | undefined> = {
      ...(this.opts.env ?? process.env),
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      LFG_TERMINAL_ID: id,
    };
    // Nothing here runs inside tmux any more; a stale TMUX makes tools that
    // check it (editors, prompts, `claude`) misdetect the terminal.
    delete env.TMUX;
    delete env.TMUX_PANE;
    const pty = new PtyBridge(this.opts.shell ?? defaultShell(env as NodeJS.ProcessEnv), {
      cols,
      rows,
      cwd: dir,
      env,
    });
    const vt = ghostty.createTerminal(cols, rows, { scrollbackLimit: this.opts.scrollback ?? 5000 });
    const shell: Shell = {
      id,
      cwd: dir,
      createdAt: Date.now(),
      pty,
      vt,
      cols,
      rows,
      title: null,
      clients: new Set(),
      tail: new Uint8Array(0),
      decoder: new TextDecoder(),
      oscCarry: "",
    };
    this.shells.set(id, shell);
    pty.onData((chunk) => this.output(shell, chunk));
    pty.onExit(() => this.exited(shell));
    this.opts.log?.(`shell ${id} started in ${dir} (pid ${pty.pid})`);
    return shell;
  }

  private output(shell: Shell, chunk: Uint8Array) {
    shell.vt.write(chunk);
    // Queries such as cursor-position or device-attributes are answered here,
    // once, by the screen that saw every byte. Browsers drop their own
    // answers, so a TUI gets exactly one reply even with no browser attached.
    for (let reply = shell.vt.readResponse(); reply; reply = shell.vt.readResponse()) {
      shell.pty.write(reply);
    }
    if (chunk.length >= TAIL_BYTES) {
      shell.tail = chunk.slice(chunk.length - TAIL_BYTES);
    } else {
      const keep = Math.min(shell.tail.length, TAIL_BYTES - chunk.length);
      const next = new Uint8Array(keep + chunk.length);
      next.set(shell.tail.subarray(shell.tail.length - keep));
      next.set(chunk, keep);
      shell.tail = next;
    }
    this.trackTitle(shell, chunk);
    for (const client of shell.clients) client.sendData(chunk);
  }

  private trackTitle(shell: Shell, chunk: Uint8Array) {
    const text = shell.oscCarry + shell.decoder.decode(chunk, { stream: true });
    const lastOsc = text.lastIndexOf("\x1b]");
    let title: string | null = null;
    TITLE_RE.lastIndex = 0;
    for (let m = TITLE_RE.exec(text); m; m = TITLE_RE.exec(text)) {
      if (m[1] === "0" || m[1] === "2") title = m[2];
    }
    // Keep an unterminated OSC for the next chunk, bounded so junk cannot grow it.
    const open = lastOsc >= 0 && !/\x07|\x1b\\/.test(text.slice(lastOsc + 2));
    shell.oscCarry = open ? text.slice(lastOsc).slice(0, 512) : "";
    if (title !== null && title !== shell.title) {
      shell.title = title.slice(0, 200);
      for (const client of shell.clients) {
        client.sendMessage({ op: "title", id: shell.id, title: shell.title });
      }
    }
  }

  private exited(shell: Shell) {
    if (this.shells.get(shell.id) !== shell) return;
    this.shells.delete(shell.id);
    const code = shell.pty.exitCode;
    this.opts.log?.(`shell ${shell.id} exited (${code})`);
    for (const client of shell.clients) {
      client.sendMessage({ op: "exit", id: shell.id, code });
      client.end();
    }
    shell.clients.clear();
    try {
      shell.vt.free();
    } catch {}
    if (this.shells.size === 0) this.opts.onEmpty?.();
  }

  /**
   * Attach a viewer. Creates the shell when needed (unless `create` is false),
   * sizes it to the viewer, then sends the snapshot before any live output.
   * Returns null when the shell does not exist and was not created.
   */
  async attach(
    client: TermClient,
    req: { id: string; cwd: string; cols: number; rows: number; create?: boolean },
  ): Promise<string | null> {
    const cols = clampDim(req.cols, 80);
    const rows = clampDim(req.rows, 24);
    let shell = this.shells.get(req.id);
    let created = false;
    if (!shell) {
      if (req.create === false) return null;
      shell = await this.create(req.id, req.cwd, cols, rows);
      created = true;
    }
    // The newest viewer decides the size, as with `tmux attach`. Resizing
    // before the snapshot means the restored screen already has the viewer's
    // geometry; the app's own repaint for the new size follows as live output.
    this.applySize(shell, cols, rows);
    client.sendMessage({
      op: "attached",
      shell: { ...this.info(shell), clients: shell.clients.size + 1 },
      created,
      version: TERM_PROTOCOL_VERSION,
    });
    const snapshot = serializeScreen(shell.vt, { title: shell.title });
    client.sendData(new TextEncoder().encode(snapshot));
    shell.clients.add(client);
    return shell.id;
  }

  detach(client: TermClient, id: string) {
    this.shells.get(id)?.clients.delete(client);
  }

  input(id: string, data: Uint8Array) {
    this.shells.get(id)?.pty.write(data);
  }

  resize(id: string, cols: number, rows: number) {
    const shell = this.shells.get(id);
    if (shell) this.applySize(shell, clampDim(cols, shell.cols), clampDim(rows, shell.rows));
  }

  private applySize(shell: Shell, cols: number, rows: number) {
    if (cols === shell.cols && rows === shell.rows) return;
    shell.cols = cols;
    shell.rows = rows;
    shell.vt.resize(cols, rows);
    shell.pty.resize(cols, rows);
  }

  list(prefix?: string): TermShellInfo[] {
    const out: TermShellInfo[] = [];
    for (const shell of this.shells.values()) {
      if (!prefix || shell.id === prefix || shell.id.startsWith(`${prefix}-`)) out.push(this.info(shell));
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  kill(id: string): boolean {
    const shell = this.shells.get(id);
    if (!shell) return false;
    // Hang up like a closed terminal window, then report it at once: the
    // bridge stops watching for exit after an explicit close.
    shell.pty.close();
    this.exited(shell);
    return true;
  }

  /** Type a command into a shell, creating it first when needed. */
  async run(id: string, cwd: string, command: string, interrupt = false): Promise<boolean> {
    let shell = this.shells.get(id);
    const created = !shell;
    shell ??= await this.create(id, cwd, 80, 24);
    if (interrupt) shell.pty.write("\x03");
    shell.pty.write(`${command}\r`);
    return created;
  }

  scan(id: string, lines = 200): { plain: string; escaped: string; width: number } | null {
    const shell = this.shells.get(id);
    if (!shell) return null;
    return {
      plain: screenText(shell.vt, lines),
      escaped: new TextDecoder().decode(shell.tail),
      width: shell.cols,
    };
  }

  /** Hang up every shell. Used when the host itself is told to stop. */
  closeAll() {
    for (const id of [...this.shells.keys()]) this.kill(id);
  }
}
