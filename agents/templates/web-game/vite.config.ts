import vibes from "@omg-dev/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    // omg.dev publishing: install manifest from public/icons/, analytics, and
    // the install bar on phones. The soft install pop-up is off so it cannot
    // open over a running game; the install bar below the game stays.
    vibes({ pwa: { autoPrompt: false } }),
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    cors: true,
    hmr: { overlay: false },
  },
  preview: { host: "0.0.0.0", port: 4173 },
});
