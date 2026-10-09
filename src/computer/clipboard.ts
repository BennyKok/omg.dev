import { desktopStatus } from "./desktop.ts";
import { existsSync } from "node:fs";

/** Hosted Computers install their missing helper once; local hosts report it. */
export function createClipboardDependency(deps: {
  installed(): boolean;
  hosted(): boolean;
  install(): Promise<void>;
}) {
  let installing: Promise<void> | null = null;
  return async () => {
    if (deps.installed()) return;
    if (!deps.hosted()) throw new Error("xclip is not installed. Install it with: sudo apt-get install -y xclip");
    installing ??= deps.install().then(() => {
      if (!deps.installed()) throw new Error("The Computer clipboard helper is still missing.");
    }).finally(() => { installing = null; });
    await installing;
  };
}

const ensureClipboardDependency = createClipboardDependency({
  installed: () => !!Bun.which("xclip"),
  hosted: () => process.platform === "linux" && existsSync("/usr/local/bin/vibes-agent"),
  async install() {
    console.info("[computer] installing missing hosted clipboard helper");
    const proc = Bun.spawn(["sudo", "-n", "apt-get", "install", "-y", "--no-install-recommends", "xclip"], {
      stdin: "ignore", stdout: "ignore", stderr: "ignore", timeout: 90_000,
      env: { ...process.env, DEBIAN_FRONTEND: "noninteractive" },
    });
    if (await proc.exited !== 0) throw new Error("The Computer could not install its clipboard helper. Try again or contact support.");
  },
});

/** Put text on the desktop's CLIPBOARD selection. xclip daemonizes to serve
 *  it until something else takes the selection, which is exactly clipboard
 *  semantics. */
export async function setDesktopClipboard(text: string, display = desktopStatus().display): Promise<void> {
  if (!display) throw new Error("the computer is not running; start it first");
  await ensureClipboardDependency();
  const proc = Bun.spawn(["xclip", "-selection", "clipboard"], {
    stdin: "pipe",
    stdout: "ignore",
    stderr: "pipe",
    env: { ...process.env, DISPLAY: display },
  });
  proc.stdin.write(text);
  proc.stdin.end();
  const exit = await proc.exited;
  if (exit !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`xclip failed (${exit}): ${stderr.trim() || "no output"}`);
  }
}

/** Read UTF-8 directly, because legacy RFB clipboard packets lose Unicode. */
export async function readDesktopClipboard(display = desktopStatus().display): Promise<string> {
  if (!display) throw new Error("the computer is not running; start it first");
  await ensureClipboardDependency();
  const proc = Bun.spawn(["xclip", "-selection", "clipboard", "-out"], {
    stdout: "pipe", stderr: "ignore", stdin: "ignore",
    env: { ...process.env, DISPLAY: display }, timeout: 5000,
  });
  const text = await new Response(proc.stdout).text();
  if (await proc.exited !== 0) return "";
  return text;
}

export async function computerClipboardRequest(req: Request, display = desktopStatus().display): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  try {
    if (req.method === "GET") return Response.json({ text: await readDesktopClipboard(display) }, { headers });
    if (req.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers });
    const body = await req.json().catch(() => null) as { text?: unknown } | null;
    if (!body || typeof body.text !== "string") return Response.json({ error: "text is required" }, { status: 400, headers });
    await setDesktopClipboard(body.text, display);
    // The detached selection owner must be serving before the viewer sends
    // Ctrl+V. A read round trip also rejects a competing clipboard change.
    if (await readDesktopClipboard(display) !== body.text) throw new Error("Computer clipboard changed before paste");
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Clipboard unavailable" }, { status: 500, headers });
  }
}
