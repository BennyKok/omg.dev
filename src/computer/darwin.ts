// Native macOS support for the Computer.
//
// Linux streams an X11 stack through x11vnc. macOS has no such stack, so the
// darwin backend is one helper binary that captures the main display with
// ScreenCaptureKit, injects CGEvent input and serves RFB on the same loopback
// port. It is compiled from source on first use; Xcode Command Line Tools
// provide swiftc. Everything above the RFB port (RfbBridge, noVNC, the kiosk
// crop, the clipboard API) is platform independent and unchanged.

import { existsSync, mkdirSync, renameSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

export const isDarwin = process.platform === "darwin";

export const HELPER_NAME = "omg-computer-mac";

export function helperSource(): string {
  return join(import.meta.dir, "darwin", `${HELPER_NAME}.swift`);
}

export function helperBinary(dir: string): string {
  return join(dir, "bin", HELPER_NAME);
}

function onPath(bin: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir && existsSync(join(dir, bin))) return join(dir, bin);
  }
  return null;
}

/** The Chrome binary on macOS, or null. The app bundle is the only real path. */
export function darwinChromePath(): string | null {
  const home = process.env.HOME ?? "";
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    join(home, "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return onPath("google-chrome") ?? onPath("chromium");
}

export interface DarwinDeps {
  ok: boolean;
  missing: string[];
  hint: string;
}

export function darwinDeps(dir: string): DarwinDeps {
  const missing: string[] = [];
  const hints: string[] = [];
  if (!darwinChromePath()) {
    missing.push("Google Chrome");
    hints.push("Install Google Chrome from https://www.google.com/chrome/");
  }
  if (!existsSync(helperBinary(dir)) && !onPath("swiftc")) {
    missing.push("Xcode Command Line Tools");
    hints.push("Install the macOS command line tools: xcode-select --install");
  }
  return { ok: missing.length === 0, missing, hint: hints.join("\n") };
}

let building: Promise<string> | null = null;

function stale(source: string, binary: string): boolean {
  if (!existsSync(binary)) return true;
  try {
    return statSync(source).mtimeMs > statSync(binary).mtimeMs;
  } catch {
    return true;
  }
}

/** Compile the helper once, when it is missing or its source is newer. */
export function ensureDarwinHelper(dir: string): Promise<string> {
  building ??= build(dir).finally(() => {
    building = null;
  });
  return building;
}

async function build(dir: string): Promise<string> {
  const explicit = process.env.OMG_COMPUTER_MAC_BIN?.trim();
  const binary = explicit || helperBinary(dir);
  const source = helperSource();
  if (!existsSync(source)) throw new Error(`the macOS Computer helper is missing at ${source}`);
  if (explicit && existsSync(explicit) && !stale(source, explicit)) return explicit;
  if (!stale(source, binary)) return binary;
  const swiftc = onPath("swiftc");
  if (!swiftc) {
    throw new Error("Xcode Command Line Tools are required to build the macOS Computer helper. Install them with: xcode-select --install");
  }

  mkdirSync(join(dir, "bin"), { recursive: true });
  const temporary = `${binary}.${process.pid}.tmp`;
  const proc = Bun.spawn(
    [
      swiftc, "-O", "-o", temporary, source,
      "-framework", "Cocoa",
      "-framework", "ScreenCaptureKit",
      "-framework", "CoreGraphics",
      "-framework", "CoreMedia",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    try { unlinkSync(temporary); } catch {}
    const detail = (stderr || stdout).trim().split("\n").slice(0, 8).join("\n");
    throw new Error(`cannot build the macOS Computer helper:\n${detail}`);
  }
  renameSync(temporary, binary);
  return binary;
}

export interface DarwinReady {
  width: number;
  height: number;
  screenWidth: number;
  screenHeight: number;
  accessible: boolean;
}
