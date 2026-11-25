// The preview, as a static site for GitHub Pages: `pnpm run build:preview` writes it to preview/dist.
// Two builds: the dashboard with the preview banner (app.html), then the service worker that runs src/ (sw.js).
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** What wrangler's module rules do for src/: .woff2 as an ArrayBuffer, .svg as text. */
function wranglerModules(): Plugin {
  return {
    name: "shelf-preview-wrangler-modules",
    enforce: "pre",
    async resolveId(id, importer) {
      // src/dashboard.ts imports the production dashboard; the service worker serves app.html instead.
      if (id === "./dashboard.html") return "\0empty-dashboard";
      if (/\.(woff2|svg)$/.test(id)) return `${(await this.resolve(id, importer, { skipSelf: true }))!.id}?wrangler`;
    },
    async load(id) {
      if (id === "\0empty-dashboard") return "export default ''";
      if (!id.endsWith("?wrangler")) return;
      const file = id.slice(0, -"?wrangler".length);
      const bytes = await readFile(file);
      return file.endsWith(".svg")
        ? `export default ${JSON.stringify(bytes.toString("utf8"))}`
        : `export default Uint8Array.from(atob(${JSON.stringify(bytes.toString("base64"))}), (c) => c.charCodeAt(0)).buffer`;
    },
  };
}

export default defineConfig(({ mode }) =>
  mode === "sw"
    ? {
        root: here("."),
        publicDir: false,
        plugins: [wranglerModules()],
        resolve: { conditions: ["browser"] },
        build: {
          outDir: here("dist"),
          emptyOutDir: false,
          target: "es2023",
          rollupOptions: { input: here("sw.ts"), output: { format: "iife", entryFileNames: "sw.js", assetFileNames: "[name]-[hash][extname]" } },
        },
      }
    : {
        root: here("dashboard"),
        publicDir: here("public"),
        resolve: { alias: { "@": here("../dashboard/src") } },
        plugins: [react(), tailwindcss(), viteSingleFile()],
        build: { outDir: here("dist"), emptyOutDir: true, target: "es2023", rollupOptions: { input: here("dashboard/app.html") } },
      },
);
