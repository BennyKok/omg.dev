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
      codesign: false,
      createDmg: true,
      notarize: false,
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
    generatePatch: false,
  },
} satisfies ElectrobunConfig;
