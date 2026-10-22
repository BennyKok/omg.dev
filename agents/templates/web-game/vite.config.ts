import vibes from "@omg-dev/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { GAME } from "./src/app/about";
import { theme } from "./src/ui/theme";

export default defineConfig({
  plugins: [
    react(),
    gameSeo(),
    // omg.dev publishing: the install manifest (name, theme colour and the
    // icons in public/icons/), analytics, and the install bar on phones. The
    // soft install pop-up is off so it cannot open over a running game; the
    // install bar below the game stays.
    vibes({ pwa: { autoPrompt: false, themeColor: theme.background, backgroundColor: theme.background } }),
  ],
  server: {
    host: "0.0.0.0",
    port: 5174,
    strictPort: true,
    allowedHosts: true,
    cors: true,
    hmr: { overlay: false },
  },
  preview: { host: "0.0.0.0", port: 4173 },
});

/**
 * The page head for search engines and link previews, from src/app/about.ts:
 * title, description, Open Graph and Twitter tags, the share image, and
 * VideoGame and FAQPage structured data. It replaces <!-- game:seo --> in
 * index.html. Edit about.ts, not this function.
 */
function gameSeo(): Plugin {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const abs = (path: string) => (GAME.siteUrl ? new URL(path, GAME.siteUrl).toString() : path);
  return {
    name: "game-seo",
    transformIndexHtml(html) {
      const image = abs(GAME.shareImage);
      const data = [
        {
          "@context": "https://schema.org",
          "@type": "VideoGame",
          name: GAME.name,
          description: GAME.description,
          genre: GAME.genre,
          gamePlatform: ["Web browser", "Mobile web browser"],
          applicationCategory: "Game",
          operatingSystem: "Any",
          playMode: "SinglePlayer",
          isAccessibleForFree: true,
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
          image,
          ...(GAME.siteUrl ? { url: GAME.siteUrl } : {}),
        },
        {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: GAME.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
        },
      ];
      const tags = [
        `<meta name="description" content="${esc(GAME.description)}" />`,
        `<meta property="og:type" content="website" />`,
        `<meta property="og:title" content="${esc(GAME.title)}" />`,
        `<meta property="og:description" content="${esc(GAME.description)}" />`,
        `<meta property="og:image" content="${esc(image)}" />`,
        `<meta property="og:image:width" content="1200" />`,
        `<meta property="og:image:height" content="630" />`,
        ...(GAME.siteUrl ? [`<meta property="og:url" content="${esc(GAME.siteUrl)}" />`, `<link rel="canonical" href="${esc(GAME.siteUrl)}" />`] : []),
        `<meta name="twitter:card" content="summary_large_image" />`,
        `<meta name="twitter:title" content="${esc(GAME.title)}" />`,
        `<meta name="twitter:description" content="${esc(GAME.description)}" />`,
        `<meta name="twitter:image" content="${esc(image)}" />`,
        ...data.map((d) => `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, "\\u003c")}</script>`),
      ];
      return html
        .replace(/<title>[^<]*<\/title>/, `<title>${esc(GAME.title)}</title>`)
        .replace("<!-- game:seo -->", tags.join("\n    "));
    },
  };
}
