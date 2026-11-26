import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // ACCESS_AUD is a secret in production (scripts/setup-access.mjs); here it matches the test's ctx.access.
      miniflare: { bindings: { TEST_MIGRATIONS: await readD1Migrations("./migrations"), ACCESS_AUD: "local-dev" } },
    }),
  ],
  // selfhost/ has its own tests, for Bun (`bun test selfhost`).
  test: { setupFiles: ["./test/setup.ts"], include: ["test/**/*.spec.ts"] },
}));
