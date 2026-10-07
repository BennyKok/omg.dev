import { existsSync, readFileSync } from "node:fs";
import type { ElectrobunConfig } from "electrobun";

function appVersion(): string {
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version?: unknown };
  if (typeof manifest.version !== "string" || !manifest.version.trim()) {
    throw new Error("The root package.json does not contain an omg.dev version.");
  }
  return manifest.version;
}

export default {
  app: {
    name: "omg.dev",
    identifier: "dev.omg.desktop",
    version: appVersion(),
    description: "Run and manage parallel coding agents on your own computer.",
  },
  build: {
    mainProcess: "bun",
    bun: {
      entrypoint: "src/bun/index.ts",
      minify: true,
      sourcemap: false,
    },
    copy: {
      ...(existsSync(new URL("./embedded-runtime.tar.gz", import.meta.url))
        ? {
            "embedded-runtime.tar.gz": "embedded-runtime.tar.gz",
            "embedded-runtime.tar.gz.sha256": "embedded-runtime.tar.gz.sha256",
          }
        : {}),
    },
    mac: {
      // CI sets these from repository secrets (see desktop-package.yml).
      // Local builds without them stay unsigned.
      codesign: Boolean(process.env.ELECTROBUN_DEVELOPER_ID),
      createDmg: true,
      notarize: Boolean(
        process.env.ELECTROBUN_DEVELOPER_ID && process.env.ELECTROBUN_APPLEAPIKEYPATH,
      ),
      bundleCEF: false,
      defaultRenderer: "native",
    },
    linux: {
      bundleCEF: false,
      defaultRenderer: "native",
    },
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  release: {
    // The desktop-package workflow publishes update.json and the app archive
    // to this rolling release. Installed apps poll it (src/bun/auto-update.ts).
    baseUrl: "https://github.com/BennyKok/omg.dev/releases/download/desktop-preview",
    generatePatch: false,
  },
} satisfies ElectrobunConfig;
