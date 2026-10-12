import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { isDesktopEmbeddedRuntime } from "../desktop-parent";
import { IosSetupStore } from "./setup-state";
import { listUsbIosDevices } from "./devices";
import { iosSigningAccount, IosSigningCloud } from "./cloud";
import { macSigningVault } from "./keychain";
import type { CloudAccount } from "../cloud-account";
import { AppleLoginError } from "./apple-login";

export type IosSetupRouteOptions = {
  root: string;
  runtimeRoot: string;
  platform?: string;
  desktop?: boolean;
  devices?: typeof listUsbIosDevices;
  launch?: (action: "login" | "prepare") => Promise<void>;
  cloudAccount?: CloudAccount;
};

function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }

export async function openIosSetupTerminal(action: "login" | "prepare", options: IosSetupRouteOptions): Promise<void> {
  const command = `env OMG_IOS_SETUP_DIR=${shellQuote(options.root)} ${shellQuote(process.execPath)} run ${shellQuote(join(options.runtimeRoot, "src/ios-testing/setup-cli.ts"))} ${action}`;
  // LaunchServices opens a local command file without AppleScript automation
  // permissions. The file contains paths only. Expo reads credentials in its
  // native TTY, and the script removes itself before starting the worker.
  await mkdir(options.root, { recursive: true, mode: 0o700 });
  const file = join(options.root, `setup-${randomUUID()}.command`);
  await writeFile(file, `#!/bin/sh\nrm -- "$0"\nexec ${command}\n`, { mode: 0o700 });
  const child = Bun.spawn(["/usr/bin/open", "-a", "Terminal", file], {
    stdout: "ignore", stderr: "ignore",
  });
  const timeout = setTimeout(() => child.kill(), 15_000);
  try {
    if (await child.exited !== 0) { await rm(file, { force: true }); throw new Error("The Mac could not open Terminal. Try again."); }
  } finally { clearTimeout(timeout); }
}

export function iosSetupRoutes(options: IosSetupRouteOptions) {
  const store = new IosSetupStore(options.root);
  const cloud = options.cloudAccount ?? iosSigningAccount(options.root);
  const supported = (options.platform ?? process.platform) === "darwin" && (options.desktop ?? isDesktopEmbeddedRuntime());
  const response = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  return async (req: Request, peerAddress: string | null): Promise<Response | null> => {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/ios-testing")) return null;
    if (!supported) return response({ supported: false }, req.method === "GET" ? 200 : 404);
    // The hosted Computer, tunnels, and arbitrary web origins must not start
    // native Apple setup or see local device/account metadata.
    if (!peerAddress || !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peerAddress)
      || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      || (req.headers.get("Origin") && req.headers.get("Origin") !== url.origin)) return response({ error: "Open iOS setup in the Mac app." }, 403);
    if (req.method === "GET" && url.pathname === "/api/ios-testing") {
      const state = store.read();
      const busy = store.busy();
      try {
        const account = cloud.status();
        return response({ supported: true, busy, ...state, access: { signedIn: account.signedIn, email: account.email }, phase: !busy && ["signing-in", "preparing"].includes(state.phase) ? "error" : state.phase });
      } catch {
        return response({ supported: true, busy, ...state, access: { signedIn: false, email: null }, error: "Allow omg.dev to use the login Keychain, then try again." });
      }
    }
    if (req.method === "GET" && ["/api/ios-testing/cloud/session", "/api/ios-testing/cloud/callback"].includes(url.pathname)) return cloud.handleRequest(req, url);
    if (req.method === "GET" && url.pathname === "/api/ios-testing/apps") {
      try { return response({ apps: await new IosSigningCloud(cloud, macSigningVault(), store).apps() }); }
      catch { return response({ error: "Allow iOS signing access to load your apps." }, 401); }
    }
    if (req.method !== "POST" || req.headers.get("Origin") !== url.origin
      || req.headers.get("Content-Type")?.split(";")[0] !== "application/json") return response({ error: "Invalid local setup request." }, 403);
    const chunks: Uint8Array[] = [];
    const reader = req.body?.getReader();
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 8192) { await reader.cancel(); return response({ error: "Setup request is too large." }, 413); }
          chunks.push(chunk.value);
        }
      } finally { reader.releaseLock(); }
    }
    const text = Buffer.concat(chunks).toString("utf8");
    let input: Record<string, unknown>;
    try { input = JSON.parse(text); } catch { return response({ error: "Invalid setup request." }, 400); }
    if (!input || typeof input !== "object" || Array.isArray(input)) return response({ error: "Invalid setup request." }, 400);
    if (store.busy()) return response({ error: "iOS setup is already running on this Mac." }, 409);
    try {
      if (["/api/ios-testing/cloud/login", "/api/ios-testing/cloud/logout"].includes(url.pathname)) {
        if (Object.keys(input).some((key) => key !== "returnTo")) return response({ error: "Invalid setup request." }, 400);
        return cloud.handleRequest(new Request(req.url, { method: req.method, headers: req.headers, body: text }), url);
      }
      if (url.pathname === "/api/ios-testing/upload") {
        if (Object.keys(input).some((key) => !["appId", "prepareNew"].includes(key)) || typeof input.appId !== "string"
          || input.prepareNew !== undefined && typeof input.prepareNew !== "boolean") return response({ error: "Select your app before saving." }, 400);
        return store.withLock(async () => {
          try { return response(await new IosSigningCloud(cloud, macSigningVault(), store).upload(input.appId as string, input.prepareNew === true)); }
          catch (error) {
            const message = error instanceof AppleLoginError ? error.message : "The signing upload could not finish. Your prepared upload was kept.";
            store.write({ ...store.read(), error: message });
            return response({ error: message }, 409);
          }
        });
      }
      if (url.pathname === "/api/ios-testing/devices") {
        if (Object.keys(input).length) return response({ error: "Invalid setup request." }, 400);
        return response({ devices: await (options.devices ?? listUsbIosDevices)() });
      }
      if (url.pathname === "/api/ios-testing/select-devices") {
        if (Object.keys(input).length !== 1 || !Array.isArray(input.deviceIds) || !input.deviceIds.length
          || input.deviceIds.length > 100 || !input.deviceIds.every((id) => typeof id === "string" && /^[A-Za-z0-9-]{1,128}$/.test(id))) return response({ error: "Select a connected iPhone." }, 400);
        const connected = await (options.devices ?? listUsbIosDevices)();
        const requested = new Set(input.deviceIds as string[]);
        const selected = connected.filter((device) => requested.has(device.udid));
        if (selected.length !== requested.size) return response({ error: "A selected iPhone is no longer connected." }, 409);
        store.write({ ...store.read(), devices: selected });
        return response({ saved: true });
      }
      if (url.pathname === "/api/ios-testing/login" || url.pathname === "/api/ios-testing/prepare") {
        if (Object.keys(input).length) return response({ error: "Invalid setup request." }, 400);
        const action = url.pathname.endsWith("/login") ? "login" : "prepare";
        const state = store.read();
        if (action === "prepare" && (!state.connection || !state.devices.length)) return response({ error: "Connect Apple and select your iPhone first." }, 409);
        await (options.launch ?? ((next) => openIosSetupTerminal(next, options)))(action);
        return response({ started: true }, 202);
      }
      return response({ error: "Unknown setup action." }, 404);
    } catch {
      return response({ error: "The Mac could not finish this step. Check your iPhone connection and Terminal permission." }, 503);
    }
  };
}
