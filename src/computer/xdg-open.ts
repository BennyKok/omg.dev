import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { PATHS } from "../config.ts";

/**
 * A box with no desktop opener (a server, or the shared Computer desktop) has
 * no xdg-open. Tools that open a browser (`gh auth login --web` and the like)
 * get this shim, which opens the page in the Computer's desktop browser.
 */
export const XDG_OPEN_SHIM_DIR = join(PATHS.root, "agents", "bin");

export function systemHasXdgOpen(path = process.env.PATH ?? ""): boolean {
  return path.split(delimiter).some((dir) => dir && dir !== XDG_OPEN_SHIM_DIR && existsSync(join(dir, "xdg-open")));
}

/**
 * Put the shim on PATH for this process and every child it starts, but only
 * when the system has no xdg-open. A laptop keeps its own.
 */
export function installXdgOpenShim(env: NodeJS.ProcessEnv = process.env, port?: number): boolean {
  if (port) env.OMG_COMPUTER_API ??= `http://127.0.0.1:${port}`;
  const path = env.PATH ?? "";
  if (path.split(delimiter).includes(XDG_OPEN_SHIM_DIR)) return true;
  if (systemHasXdgOpen(path) || !existsSync(join(XDG_OPEN_SHIM_DIR, "xdg-open"))) return false;
  env.PATH = path ? `${XDG_OPEN_SHIM_DIR}${delimiter}${path}` : XDG_OPEN_SHIM_DIR;
  return true;
}
