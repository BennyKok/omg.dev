import Electrobun, { BrowserWindow } from "electrobun/main";
import {
  ensureRuntime,
  launchEmbeddedRuntime,
  stopOwnedRuntime,
  type OwnedRuntimeProcess,
  type RuntimeConnection,
} from "./runtime";

let mainWindow: BrowserWindow | undefined;
let connection: RuntimeConnection | undefined;
let startingProcess: OwnedRuntimeProcess | undefined;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function createHiddenWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: "omg.dev",
    url: null,
    frame: {
      width: 1440,
      height: 960,
    },
    hidden: true,
    activate: false,
    sandbox: true,
    spellCheck: true,
  });
  let revealed = false;
  window.webview.on("dom-ready", () => {
    if (revealed) return;
    revealed = true;
    window.show();
  });
  return window;
}

function showStartupError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const window = createHiddenWindow();
  window.webview.loadHTML(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="dark" />
    <title>omg.dev could not start</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0c0c0d; color: #f4f4f5; font: 16px/1.5 system-ui, sans-serif; }
      main { width: min(560px, calc(100vw - 64px)); }
      h1 { margin: 0 0 12px; font-size: 28px; }
      p { margin: 0; color: #a1a1aa; }
      code { display: block; margin-top: 24px; padding: 16px; overflow-wrap: anywhere; border: 1px solid #27272a; border-radius: 10px; background: #18181b; color: #e4e4e7; }
    </style>
  </head>
  <body>
    <main>
      <h1>omg.dev could not start</h1>
      <p>The local runtime did not become ready.</p>
      <code>${escapeHtml(message)}</code>
    </main>
  </body>
</html>`);
  mainWindow = window;
}

function stopRuntime(): void {
  stopOwnedRuntime(connection);
  if (startingProcess) {
    try {
      startingProcess.kill("SIGTERM");
    } catch {
      // It is already stopped.
    }
  }
  connection = undefined;
  startingProcess = undefined;
}

Electrobun.events.on("before-quit", stopRuntime);
process.on("exit", stopRuntime);

async function connectToRuntime(): Promise<void> {
  try {
    connection = await ensureRuntime({
      launch: async (port) => await launchEmbeddedRuntime(port),
      onLaunch: (child) => {
        startingProcess = child;
      },
    });
    startingProcess = undefined;
    const window = createHiddenWindow();
    window.webview.loadURL(connection.origin);
    mainWindow = window;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    showStartupError(error);
  }
}

void connectToRuntime();
