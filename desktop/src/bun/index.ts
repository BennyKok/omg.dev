import Electrobun, { BrowserWindow } from "electrobun/main";
import {
  ensureRuntime,
  launchEmbeddedRuntime,
  stopOwnedRuntime,
  type OwnedRuntimeProcess,
  type RuntimeConnection,
} from "./runtime";

const mainWindow = new BrowserWindow({
  title: "omg.dev",
  url: "views://mainview/index.html",
  frame: {
    width: 1440,
    height: 960,
  },
  sandbox: true,
  spellCheck: true,
});

let connection: RuntimeConnection | undefined;
let startingProcess: OwnedRuntimeProcess | undefined;

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
    mainWindow.webview.loadURL(connection.origin);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  }
}

void connectToRuntime();
void mainWindow;
