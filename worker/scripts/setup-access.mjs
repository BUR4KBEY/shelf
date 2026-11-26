// Puts Cloudflare Access in front of the shelf dashboard: one allow-policy for the given emails,
// one self-hosted app for <domain>/dashboard. Safe to rerun: both are found by name and updated.
// Then stores the app's audience tag as the Worker's ACCESS_AUD secret: the Worker trusts only this app's sign-ins,
// so another Access app covering the same host can't hand out the dashboard.
//
//   CLOUDFLARE_API_TOKEN=... pnpm run setup:access -- --domain shelf.example.com --email you@example.com
//
// The token needs "Access: Apps and Policies → Edit" and "Workers Scripts → Edit". Set CLOUDFLARE_ACCOUNT_ID if it
// can see more than one account. --worker names the Worker if it isn't "shelf".
import { parseArgs } from "node:util";

const { values: args } = parseArgs({ options: { domain: { type: "string" }, email: { type: "string", multiple: true }, worker: { type: "string", default: "shelf" } } });
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token || !args.domain || !args.email?.length) {
  console.error("usage: CLOUDFLARE_API_TOKEN=... pnpm run setup:access -- --domain <host> --email <you@example.com> [--email ...]");
  process.exit(2);
}
const domain = args.domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

async function cf(method, path, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.success) {
    // Access endpoints put the reason in `error` (e.g. "auth.forbidden"), the rest of the API in `message`.
    const errors = (data.errors ?? []).map((e) => `${e.code}: ${e.message ?? e.error}`).join("; ") || `HTTP ${res.status}`;
    throw new Error(`${method} ${path} failed: ${errors}`);
  }
  return data.result;
}

let account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!account) {
  const accounts = await cf("GET", "/accounts");
  if (accounts.length !== 1) throw new Error(`token sees ${accounts.length} accounts; set CLOUDFLARE_ACCOUNT_ID`);
  account = accounts[0].id;
}
const base = `/accounts/${account}/access`;

const policyName = `shelf dashboard: ${domain}`;
const policyBody = { name: policyName, decision: "allow", include: args.email.map((email) => ({ email: { email } })) };
const existingPolicy = (await cf("GET", `${base}/policies?per_page=1000`)).find((p) => p.name === policyName);
const policy = existingPolicy
  ? await cf("PUT", `${base}/policies/${existingPolicy.id}`, policyBody)
  : await cf("POST", `${base}/policies`, policyBody);

const appName = `shelf dashboard (${domain})`;
const appBody = {
  name: appName,
  type: "self_hosted",
  domain: `${domain}/dashboard`,
  // The bare path and everything under it; a trailing /* alone would not cover /dashboard itself.
  destinations: [
    { type: "public", uri: `${domain}/dashboard` },
    { type: "public", uri: `${domain}/dashboard/*` },
  ],
  session_duration: "720h",
  app_launcher_visible: false,
  policies: [{ id: policy.id, precedence: 1 }],
};
let app;
try {
  const existingApp = (await cf("GET", `${base}/apps?per_page=1000`)).find((a) => a.name === appName);
  app = existingApp ? await cf("PUT", `${base}/apps/${existingApp.id}`, appBody) : await cf("POST", `${base}/apps`, appBody);
} catch (e) {
  console.error(String(e.message));
  console.error("If Zero Trust was never set up on this account, open dash.cloudflare.com → Zero Trust once, pick a team name and the Free plan, then rerun.");
  process.exit(1);
}

console.log(`${existingPolicy ? "updated" : "created"} policy "${policyName}" allowing ${args.email.join(", ")}`);
console.log(`app "${appName}" protects https://${domain}/dashboard (aud ${app.aud})`);

try {
  await cf("PUT", `/accounts/${account}/workers/scripts/${args.worker}/secrets`, { name: "ACCESS_AUD", text: app.aud, type: "secret_text" });
} catch (e) {
  console.error(String(e.message));
  console.error(`Couldn't store the audience on the Worker "${args.worker}": deploy it first (pnpm run deploy), check the token can edit Workers, then rerun.`);
  console.error(`Or set it by hand: echo ${app.aud} | pnpm exec wrangler secret put ACCESS_AUD`);
  process.exit(1);
}
console.log(`stored the aud as the Worker "${args.worker}"'s ACCESS_AUD secret: the dashboard trusts only this app`);
