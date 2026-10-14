import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { thirdPartyNotices } from "./scripts/third-party-notices.mjs";

// Static build of the game for GitHub Pages (`npm run build:web` → dist-web/).
// `base: "./"` makes every asset URL relative, so the same output works at a
// domain root or under a subpath like jameskeithharwood.com/games/lakeshore-exit/.
// Runtime asset paths in game code should use `import.meta.env.BASE_URL`.
export default defineConfig({
  root: "web",
  base: "./",
  publicDir: "../public",
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  plugins: [
    tailwindcss(),
    viteReact(),
    thirdPartyNotices("Lakeshore Exit: third-party notices"),
    {
      // public/__grok is the Grok preview's install tutorial; not part of the game.
      name: "drop-grok-files",
      apply: "build",
      closeBundle() {
        rmSync(fileURLToPath(new URL("./dist-web/__grok", import.meta.url)), { recursive: true, force: true });
      },
    },
  ],
  build: {
    outDir: "../dist-web",
    emptyOutDir: true,
  },
});
