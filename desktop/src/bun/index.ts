import { BrowserWindow } from "electrobun/main";
import { runtimeOrigin, waitForRuntime } from "./runtime";

const origin = runtimeOrigin();

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

async function connectToRuntime(): Promise<void> {
  const ready = await waitForRuntime(origin);
  if (!ready) return;
  mainWindow.webview.loadURL(origin);
}

void connectToRuntime();
void mainWindow;
