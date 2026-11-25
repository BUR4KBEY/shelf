// Bundles the self-hosted server into dist/server.js, one file with no node_modules: `bun selfhost/build.ts`.
// Run `pnpm run build` first; src/dashboard.ts imports the dashboard it writes. Loads files as wrangler's module rules do.
import { readdir } from "node:fs/promises";

const migrations = new URL("../migrations/", import.meta.url);

const result = await Bun.build({
  entrypoints: [new URL("server.ts", import.meta.url).pathname],
  outdir: new URL("dist/", import.meta.url).pathname,
  target: "bun",
  plugins: [
    {
      name: "wrangler-modules",
      setup(build) {
        // .html and .svg as text, .woff2 as an ArrayBuffer (wrangler.jsonc `rules`). In a namespace of their own, as Bun bundles an imported .html page otherwise.
        build.onResolve({ filter: /\.(html|svg)$/ }, ({ path, importer }) => ({ path: new URL(path, `file://${importer}`).pathname, namespace: "text" }));
        build.onLoad({ filter: /.*/, namespace: "text" }, async ({ path }) => ({ contents: `export default ${JSON.stringify(await Bun.file(path).text())}`, loader: "js" }));
        build.onLoad({ filter: /\.woff2$/ }, async ({ path }) => ({
          contents: `export default Uint8Array.fromBase64(${JSON.stringify((await Bun.file(path).bytes()).toBase64())}).buffer`,
          loader: "js",
        }));
        // The SQL in migrations/, oldest first, as wrangler applies it.
        build.onResolve({ filter: /^shelf:migrations$/ }, () => ({ path: "migrations", namespace: "shelf" }));
        build.onLoad({ filter: /.*/, namespace: "shelf" }, async () => {
          const names = (await readdir(migrations)).filter((n) => n.endsWith(".sql")).sort();
          const sql = await Promise.all(names.map((n) => Bun.file(new URL(n, migrations)).text()));
          return { contents: `export default ${JSON.stringify(sql)}`, loader: "js" };
        });
      },
    },
  ],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
