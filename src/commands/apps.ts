import { createCloudAccount, loadCloudCredentials, saveCloudCredentials, type CloudAccount } from "../cloud-account.ts";
import { CloudAppsError, type CloudAppsClient } from "../../packages/cloud/src/apps.ts";
import { createRuntimeAppsClient, deployFolder } from "../cloud-apps.ts";

export type AppsCliDependencies = {
  cwd?: () => string;
  env?: NodeJS.ProcessEnv;
  output?: (line: string) => void;
  error?: (line: string) => void;
  now?: () => number;
  openUrl?: (url: string) => Promise<void>;
  listen?: (handler: (req: Request) => Promise<Response>) => Promise<{ origin: string; stop: () => void }>;
  sleep?: (ms: number) => Promise<void>;
  account?: CloudAccount;
  client?: CloudAppsClient;
};

function write(writer: ((line: string) => void) | undefined, fallback: typeof console.log, line: string) {
  (writer ?? fallback)(line);
}

function flag(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  return argv[index + 1];
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function positional(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i]!;
    if (part === "--") {
      out.push(...argv.slice(i + 1));
      break;
    }
    if (part.startsWith("--")) {
      if (part.includes("=")) continue;
      if (part === "--wait" || part === "--no-wait" || part === "--generate-icon") continue;
      i += 1;
      continue;
    }
    out.push(part);
  }
  return out;
}

async function listenLoopback(
  handler: (req: Request) => Promise<Response>,
): Promise<{ origin: string; stop: () => void }> {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: handler,
  });
  return {
    origin: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  };
}

export async function cmdApps(argv: string[], dependencies: AppsCliDependencies = {}): Promise<number> {
  const out = (line: string) => write(dependencies.output, console.log, line);
  const err = (line: string) => write(dependencies.error, console.error, line);
  const env = dependencies.env ?? process.env;
  const cwd = (dependencies.cwd ?? process.cwd)();
  const [verb, ...rest] = argv;
  const account = dependencies.account ?? createCloudAccount();
  const client =
    dependencies.client ?? createRuntimeAppsClient({ getAccessToken: () => account.getAccessToken() });

  try {
    if (verb === "login") {
      if (account.status().inherited) {
        out("This Computer already uses the owner's Cloud account.");
        return 0;
      }
      const apiKey = flag(rest, "--api-key") ?? env.OMG_API_KEY?.trim();
      if (apiKey) {
        saveCloudCredentials({ token: apiKey, kind: "api-key" });
        out("Signed in with an API key.");
        return 0;
      }
      const listenFn = dependencies.listen ?? listenLoopback;
      const pending = listenFn(async (req) => {
        const url = new URL(req.url);
        const handled = await account.handleRequest(req, url);
        return handled ?? new Response("not found", { status: 404 });
      });
      const { origin, stop } = await pending;
      try {
        const started = await account.handleRequest(
          new Request(`${origin}/api/cloud/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          }),
          new URL(`${origin}/api/cloud/login`),
        );
        const body = (await started?.json()) as { authorizeUrl?: string };
        if (!body?.authorizeUrl) {
          err("Could not start Cloud sign-in.");
          return 1;
        }
        out(body.authorizeUrl);
        out("Open that URL, then return here.");
        await dependencies.openUrl?.(body.authorizeUrl);
        const deadline = (dependencies.now ?? Date.now)() + 10 * 60 * 1000;
        while ((dependencies.now ?? Date.now)() < deadline) {
          if (loadCloudCredentials()) {
            out("Signed in to omg Cloud.");
            return 0;
          }
          await (dependencies.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))))(500);
        }
        err("Sign-in timed out.");
        return 1;
      } finally {
        stop();
      }
    }

    if (verb === "logout") {
      const { clearCloudCredentials } = await import("../cloud-account.ts");
      clearCloudCredentials();
      out("Signed out of omg Cloud.");
      return 0;
    }

    if (verb === "whoami") {
      const me = await client.whoami();
      out(me.email || me.name || me.userId);
      return 0;
    }

    if (verb === "apps") {
      const apps = await client.listApps();
      if (apps.length === 0) {
        out("No apps.");
        return 0;
      }
      for (const app of apps) {
        out(`${app.slug}\t${app.name}${app.dashboardUrl ? `\t${app.dashboardUrl}` : ""}`);
      }
      return 0;
    }

    if (verb === "visibility") {
      const args = positional(rest);
      const slug = args[0];
      const value = args[1] ?? flag(rest, "--set");
      if (!slug) {
        err("Usage: omg visibility <slug> [public|omg-users]");
        return 1;
      }
      if (value) {
        const updated = await client.setVisibility(slug, value);
        out(updated.visibility);
        return 0;
      }
      const current = await client.getVisibility(slug);
      out(current.visibility);
      return 0;
    }

    if (verb === "env") {
      const args = positional(rest);
      const sub = args[0];
      const slug = args[1];
      if (!sub || !slug) {
        err("Usage: omg env list|pull|set|rm|import <slug> ...");
        return 1;
      }
      if (sub === "list") {
        const listed = await client.listEnv(slug, flag(rest, "--project-id"));
        out(JSON.stringify(listed.vars ?? listed, null, 2));
        return 0;
      }
      if (sub === "pull") {
        const pulled = await client.pullEnv(slug, flag(rest, "--project-id"));
        for (const [key, value] of Object.entries(pulled.env ?? {})) out(`${key}=${value}`);
        return 0;
      }
      if (sub === "set") {
        const assignment = args[2];
        const eq = assignment?.indexOf("=") ?? -1;
        if (!assignment || eq < 1) {
          err("Usage: omg env set <slug> KEY=VALUE");
          return 1;
        }
        await client.setEnv({ slug, vars: { [assignment.slice(0, eq)]: assignment.slice(eq + 1) } });
        out("ok");
        return 0;
      }
      if (sub === "rm") {
        const key = args[2];
        if (!key) {
          err("Usage: omg env rm <slug> KEY");
          return 1;
        }
        await client.removeEnv({ slug, keys: [key] });
        out("ok");
        return 0;
      }
      if (sub === "import") {
        const file = args[2];
        const { readFileSync } = await import("node:fs");
        const contents = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
        await client.importEnv({ slug, contents });
        out("ok");
        return 0;
      }
      err(`Unknown env command: ${sub}`);
      return 1;
    }

    if (verb === "deploy" || verb === "create") {
      const args = positional(rest);
      const name = flag(rest, "--name") ?? (verb === "create" ? args[0] : undefined);
      const wait = !hasFlag(rest, "--no-wait");
      const result = await deployFolder(client, {
        cwd,
        name,
        generateIcon: hasFlag(rest, "--generate-icon"),
        wait,
        sleep: dependencies.sleep,
        now: dependencies.now,
        onStatus: (status) => {
          const phase = status.phase ?? status.status;
          if (phase) out(String(phase));
        },
      });
      out(result.url);
      return 0;
    }

    if (verb === "dev" || verb === "link") {
      err(`\`${verb}\` is retired. Deploy with \`omg deploy\`, or work in a Computer session.`);
      return 1;
    }

    err(`Unknown command: ${verb}`);
    return 1;
  } catch (error) {
    const message = error instanceof CloudAppsError || error instanceof Error ? error.message : String(error);
    err(message);
    return 1;
  }
}

