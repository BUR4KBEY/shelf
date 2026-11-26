// Wrangler imports .html files as text (default module rules).
declare module "*.html" {
  const text: string;
  export default text;
}

/** ACCESS_AUD: the shelf's own Access app (a secret scripts/setup-access.mjs stores); the dashboard trusts no other. Unset until it runs. */
interface Env {
  ACCESS_AUD?: string;
}
declare namespace Cloudflare {
  interface Env {
    ACCESS_AUD?: string;
  }
}
