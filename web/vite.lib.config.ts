import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import prefixSelector from "postcss-prefix-selector";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const HOST_SHARED_EXTERNALS = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "react-dom/client",
  "react-dom/server",
  "@tanstack/react-router",
  "cnfast",
  "class-variance-authority",
  "vaul",
  "@base-ui/react",
] as const;

function isHostSharedExternal(id: string): boolean {
  return HOST_SHARED_EXTERNALS.some((pkg) => id === pkg || id.startsWith(`${pkg}/`));
}

/**
 * Module-graph size report for the prebuilt embed bundle.
 * Enable with ANALYZE=1. Writes dist-lib/module-report.json and prints
 * per-package rendered byte totals (minified, not gzip) so we can decide
 * what to externalize without string-diffing the output.
 */
function moduleReportPlugin(): Plugin {
  return {
    name: "lfg-module-report",
    apply: "build",
    generateBundle(_options, bundle) {
      const modules: { id: string; renderedLength: number; originalLength: number }[] = [];
      let bundleBytes = 0;
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        bundleBytes += output.code.length;
        for (const [id, mod] of Object.entries(output.modules)) {
          modules.push({
            id,
            renderedLength: mod.renderedLength,
            originalLength: mod.originalLength,
          });
        }
      }
      modules.sort((a, b) => b.renderedLength - a.renderedLength);

      const packages = new Map<string, { rendered: number; original: number; files: number }>();
      const packageOf = (id: string): string => {
        const norm = id.replaceAll("\\", "/");
        const nm = norm.lastIndexOf("/node_modules/");
        if (nm === -1) return "(app)";
        const rest = norm.slice(nm + "/node_modules/".length);
        if (rest.startsWith("@")) {
          const [scope, name] = rest.split("/");
          return `${scope}/${name}`;
        }
        return rest.split("/")[0] ?? "(unknown)";
      };
      for (const mod of modules) {
        const pkg = packageOf(mod.id);
        const cur = packages.get(pkg) ?? { rendered: 0, original: 0, files: 0 };
        cur.rendered += mod.renderedLength;
        cur.original += mod.originalLength;
        cur.files += 1;
        packages.set(pkg, cur);
      }
      const packageRows = [...packages.entries()]
        .map(([name, stats]) => ({ name, ...stats }))
        .sort((a, b) => b.rendered - a.rendered);

      const report = {
        bundleBytes,
        bundleGzipBytes: gzipSync(
          Object.values(bundle)
            .filter((o) => o.type === "chunk")
            .map((o) => (o.type === "chunk" ? o.code : ""))
            .join(""),
        ).length,
        packages: packageRows,
        modules: modules.slice(0, 200),
      };
      const outPath = path.resolve(dirname, "dist-lib/module-report.json");
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
      console.log(`\nLFG lib bundle: ${bundleBytes.toLocaleString()} raw / ${report.bundleGzipBytes.toLocaleString()} gzip`);
      console.log("Top packages by rendered minified bytes:");
      for (const row of packageRows.slice(0, 30)) {
        console.log(
          `  ${String(row.rendered).padStart(10)}  ${row.name}  (${row.files} files)`,
        );
      }
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    ...(process.env.ANALYZE === "1" ? [moduleReportPlugin()] : []),
  ],
  css: {
    postcss: {
      plugins: [
        prefixSelector({
          prefix: "html[data-lfg-app-surface]",
          transform(prefix, selector, prefixedSelector) {
            if (selector === ":root" || selector === "html") return prefix;
            if (selector.startsWith("html")) {
              return selector.replace(/^html/, prefix);
            }
            if (selector === ".dark") return `${prefix}.dark`;
            if (selector.startsWith(".dark ")) {
              return `${prefix}.dark${selector.slice(".dark".length)}`;
            }
            return prefixedSelector;
          },
        }),
      ],
    },
  },
  build: {
    outDir: "dist-lib",
    sourcemap: false,
    lib: {
      entry: path.resolve(dirname, "src/embedded.tsx"),
      formats: ["es"],
      fileName: "index",
      cssFileName: "styles",
    },
    rollupOptions: {
      // Host-shared libraries. React was already external; the rest are
      // libraries app.omg.dev (BennyKok/vibes apps/web) also ships on the
      // eager path. Leaving them inlined duplicates tens to hundreds of KB
      // on every first visit. Externalizing only works when the host
      // provides a compatible copy — see the per-package notes below.
      //
      // Externalize:
      //   react*                     — already done; host pin ^19.2.4
      //   @tanstack/react-router     — both 1.170.18. LFG mounts its OWN
      //                                isolated memory router in
      //                                OmgAppSurface (createOmgRouter +
      //                                createMemoryHistory). Sharing the
      //                                MODULE is the safe pattern; two
      //                                library copies would be worse.
      //                                Nested RouterProviders keep
      //                                instances isolated via context.
      //   cnfast                     — both 0.0.8 exactly
      //   class-variance-authority   — both 0.7.1
      //   vaul                       — both 1.1.2. Pulls @radix-ui/* with
      //                                it; those drop out of this graph
      //                                once vaul is external.
      //   @base-ui/react             — the largest single duplicate here.
      //                                Externalizing this REQUIRES the host
      //                                to move first, and the trap is that
      //                                both repos DECLARED ^1.3.0 while the
      //                                LOCKS diverged: LFG resolved 1.6.0,
      //                                the host 1.3.0. Comparing declared
      //                                ranges makes this look aligned when
      //                                it is not — check the lockfile.
      //                                Since the host's copy wins once this
      //                                is external, the host must be >= what
      //                                we compile against or every dialog
      //                                and menu breaks at runtime. Both now
      //                                declare ^1.6.0 (BennyKok/vibes
      //                                apps/web), which also collapses the
      //                                nested "@omg-dev/app/@base-ui/react"
      //                                resolution in the host lockfile onto
      //                                one copy — without that dedup this
      //                                change saves nothing.
      //
      // Deliberately NOT external:
      //   tailwind-merge             — lazy via streamdown, not a host
      //                                dep (host uses cnfast)
      //   lucide-react / sonner / …  — same version, follow-up, not
      //                                required to land this cut
      //   shadcn src/components/ui/* — source-copied, not a package
      external: isHostSharedExternal,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
});
