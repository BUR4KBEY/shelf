import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { buildInfo } from "./build-info.ts";

const NONCE = "__NONCE__"; // the Worker swaps this for a per-request nonce

/** Emits the single-file build as dashboard.html and puts the nonce placeholder on every <script> tag. */
function workerPage(): Plugin {
  return {
    name: "shelf-worker-page",
    enforce: "post",
    // order "post" like vite-plugin-singlefile, and listed after it, so this sees the inlined page.
    generateBundle: { order: "post", handler(_, bundle) {
      const page = bundle["index.html"];
      if (page?.type !== "asset" || typeof page.source !== "string") throw new Error("expected index.html in the bundle");
      if (Object.keys(bundle).length !== 1) throw new Error(`not a single file: ${Object.keys(bundle).join(", ")}`);
      if (page.source.includes(NONCE)) throw new Error(`the bundle already contains ${NONCE}`);
      // Inlined code can contain "<script" in strings, so only the first one after each real </script> is a tag.
      const parts = page.source.split("</script>");
      const source = parts.map((part, i) => (i < parts.length - 1 ? part.replace("<script", `<script nonce="${NONCE}"`) : part)).join("</script>");
      if (source.split(NONCE).length !== parts.length) throw new Error("a <script> tag is missing its nonce");
      delete bundle["index.html"];
      this.emitFile({ type: "asset", fileName: "dashboard.html", source });
    } },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  plugins: [react(), tailwindcss(), viteSingleFile(), workerPage()],
  define: { __BUILD__: JSON.stringify(buildInfo()) },
  // The page is written into the Worker's source dir, which holds other files: never empty it.
  build: { outDir: "../src", emptyOutDir: false, target: "es2023" },
});
