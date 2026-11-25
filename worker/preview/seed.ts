// The preview's sample data: what a shelf looks like after a year of agents, CI and a person using it.
// Times are relative to now, so the charts and heatmaps are always full.
import { hashPassword } from "../src/auth";
import { docId, randomId, sha256Hex } from "../src/util";
import { store } from "./shims";

const DAY = 86_400_000;

// A fixed seed: every visitor starts with the same shelf.
let seedState = 7;
function rand() {
  seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

type Upload = [key: string | null, at: number];

/** One upload on a day `daysAgo` back, at a local hour from `hours`; never in the future. */
function at(key: string | null, daysAgo: number, [from, span]: [number, number]): Upload {
  const d = new Date(Date.now() - daysAgo * DAY);
  d.setHours(from + Math.floor(rand() * span), Math.floor(rand() * 60), Math.floor(rand() * 60));
  return [key, Math.min(d.getTime(), Date.now() - (5 + rand() * 50) * 60_000)];
}

/** On each of the last `days` days (weekdays only if asked), an upload with chance `p`. */
const daily = (key: string, p: number, days: number, hours: [number, number], weekdays = false): Upload[] =>
  Array.from({ length: days }, (_, i) => i)
    .filter((i) => rand() < p && !(weekdays && [0, 6].includes(new Date(Date.now() - i * DAY).getDay())))
    .map((i) => at(key, i, hours));

/** `count` uploads on random days between `from` and `to` days ago. */
const some = (key: string | null, count: number, from: number, to: number, hours: [number, number]): Upload[] =>
  Array.from({ length: count }, () => at(key, to + Math.floor(rand() * (from - to)), hours));

type SeedDoc = {
  title: string;
  space?: string;
  slug?: string;
  password?: string;
  favorite?: boolean;
  expiresIn?: number;
  messages: string[];
  uploads: Upload[];
  /** The files of version `n`. */
  files: (n: number) => Record<string, string>;
};

const LAPTOP = "k_laptopclaude";
const CI = "k_githubaction";
const DESKTOP = "k_desktopcodex";
const RESEARCH = "k_researchagnt";
const OLD = "k_oldthinkpad1";
const GONE = "k_deletedkey01"; // a key that was deleted; its uploads stay

const API_CSS = `body{font:16px/1.6 system-ui,sans-serif;max-width:46rem;margin:3rem auto;padding:0 1.25rem;color:#1d1b2e}
nav a{margin-right:1rem}code{background:#f1f0f7;padding:.1em .35em;border-radius:4px}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e4e2ef;padding:.45rem;text-align:left}
.tag{display:inline-block;background:#e9e6ff;color:#4b3fcf;border-radius:999px;padding:0 .6rem;font-size:.85em}
@media (prefers-color-scheme:dark){body{background:#15141f;color:#ecebf5}code{background:#25233a}td,th{border-color:#2f2d45}}`;

const apiPage = (n: number, title: string, body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Acme API</title><link rel="stylesheet" href="style.css"></head>
<body><nav><a href="./">Overview</a><a href="endpoints">Endpoints</a></nav>
<h1>${title} <span class="tag">v2.${n}</span></h1>${body}
<p><small>Built by CI from <code>main</code>, build ${1000 + n * 7}.</small></p></body></html>`;

function bars(n: number) {
  const weeks = Array.from({ length: 12 }, (_, i) => Math.round(40 + 30 * Math.sin((n + i) / 3) + 20 * ((n * 7 + i * 13) % 5) / 5 + i * 2));
  const max = Math.max(...weeks);
  return weeks
    .map((v, i) => `<rect x="${i * 34 + 6}" y="${190 - (v / max) * 170}" width="24" height="${(v / max) * 170}" rx="4" fill="#6c5ce7" opacity="${0.45 + i / 22}"/>`)
    .join("");
}

const DOCS: SeedDoc[] = [
  {
    title: "Acme API reference",
    messages: ["docs: regenerate from openapi.yaml", "docs: add pagination examples", "docs: document rate limits", "docs: new /v2/invoices endpoint", "docs: fix typos"],
    uploads: daily(CI, 0.55, 300, [9, 9], true),
    files: (n) => ({
      "index.html": apiPage(n, "Acme API", `<p>The Acme API lets you create customers, send invoices and receive webhooks. Every request needs a bearer token.</p>
<pre><code>curl https://api.acme.dev/v2/customers -H "Authorization: Bearer $ACME_KEY"</code></pre>
<p>Responses are JSON. Lists are paginated with <code>?cursor=</code>; ${50 + (n % 4) * 25} items per page.</p>`),
      "endpoints.html": apiPage(n, "Endpoints", `<table><tr><th>Method</th><th>Path</th><th>What it does</th></tr>
<tr><td>GET</td><td><code>/v2/customers</code></td><td>Lists customers, newest first</td></tr>
<tr><td>POST</td><td><code>/v2/customers</code></td><td>Creates a customer</td></tr>
<tr><td>POST</td><td><code>/v2/invoices</code></td><td>Drafts an invoice</td></tr>
<tr><td>POST</td><td><code>/v2/invoices/:id/send</code></td><td>Emails it to the customer</td></tr>
<tr><td>GET</td><td><code>/v2/events</code></td><td>Webhook events from the last ${n % 2 ? 30 : 14} days</td></tr></table>`),
      "style.css": API_CSS,
    }),
  },
  {
    title: "Weekly metrics",
    messages: ["chore: weekly metrics report"],
    uploads: Array.from({ length: 52 }, (_, w) => at(CI, w * 7 + ((new Date().getDay() + 6) % 7), [7, 1])),
    files: (n) => ({
      "metrics.html": `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Weekly metrics</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:44rem;margin:3rem auto;padding:0 1rem}.kpi{display:flex;gap:1rem}.kpi div{flex:1;border:1px solid #ddd;border-radius:12px;padding:1rem}.kpi b{display:block;font-size:1.8rem}</style></head>
<body><h1>Weekly metrics · week ${n}</h1>
<div class="kpi"><div>Signups<b>${1200 + ((n * 137) % 400)}</b></div><div>Active teams<b>${380 + n * 3}</b></div><div>Churn<b>${(1.2 + ((n * 7) % 9) / 10).toFixed(1)}%</b></div></div>
<h2>Signups, last 12 weeks</h2><svg viewBox="0 0 410 200" width="100%" role="img" aria-label="Bar chart of weekly signups">${bars(n)}</svg>
</body></html>`,
    }),
  },
  {
    title: "Q3 launch plan",
    favorite: true,
    messages: ["Draft the launch timeline", "Add the pricing section", "Tighten risks after review", "Move beta to week 3", "Add owner for each workstream", "Final pass"],
    uploads: [...daily(LAPTOP, 0.3, 45, [19, 4]), ...some(null, 2, 20, 1, [10, 6])],
    files: (n) => ({
      "q3-launch-plan.md": `# Q3 launch plan

**Goal:** ship Teams to every paying customer by the end of the quarter, with no more than 1% of workspaces on the old plan.

## Timeline

| Week | Milestone | Owner |
| --- | --- | --- |
| 1 | Feature freeze | Mia |
| ${n > 3 ? 3 : 2} | Private beta, 40 teams | Jonas |
| 6 | Public beta | Priya |
| 9 | General availability | Mia |

## Workstreams

- **Billing:** per-seat prices, prorated upgrades, invoices for annual plans.
- **Onboarding:** invite flow, a sample workspace, and a checklist on first login.
- **Docs:** a Teams guide and migration notes for admins.${n > 2 ? "\n- **Support:** two macros per common question, and a status page entry for each beta week." : ""}

## Risks

1. Proration bugs at month boundaries. *Mitigation:* run last year's invoices through the new code.
2. Admins missing the migration email. *Mitigation:* an in-app banner for 30 days.

> Revision ${n}. Comments welcome until Friday.
`,
    }),
  },
  {
    title: "Architecture overview",
    messages: ["First sketch", "Split the queue out of the API", "Add the read replica", "Label the edges"],
    uploads: some(DESKTOP, 4, 150, 10, [10, 8]),
    files: (n) => ({
      "architecture.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 300" font-family="system-ui,sans-serif" font-size="14">
<rect width="640" height="300" fill="#fbfaff"/>
<g fill="#ece9ff" stroke="#6c5ce7" stroke-width="2"><rect x="30" y="120" width="120" height="56" rx="10"/><rect x="250" y="60" width="140" height="56" rx="10"/><rect x="250" y="190" width="140" height="56" rx="10"/><rect x="480" y="120" width="130" height="56" rx="10"/></g>
<g text-anchor="middle" fill="#2b2650"><text x="90" y="153">Browser</text><text x="320" y="93">API</text><text x="320" y="223">${n > 1 ? "Queue + workers" : "Workers"}</text><text x="545" y="153">${n > 2 ? "Postgres + replica" : "Postgres"}</text></g>
<g stroke="#6c5ce7" stroke-width="2" fill="none"><path d="M150 140 L250 92"/><path d="M390 92 L480 140"/><path d="M320 116 L320 190"/><path d="M390 218 L480 160"/></g>
${n > 3 ? '<g fill="#6c5ce7" font-size="12"><text x="170" y="105">HTTPS</text><text x="420" y="105">SQL</text><text x="328" y="160">jobs</text></g>' : ""}
</svg>`,
    }),
  },
  {
    title: "Release notes",
    messages: ["chore(release): notes for the new version", "Reword the highlights"],
    uploads: [...some(CI, 15, 120, 0, [14, 4]), ...some(LAPTOP, 6, 100, 2, [20, 3])],
    files: (n) => ({
      "release-notes.md": `# Release notes

${Array.from({ length: Math.min(n, 6) }, (_, i) => {
        const v = n - i;
        return `## 4.${v}.0

- ${["Faster search across every workspace", "Invoices can be sent in 9 more currencies", "Dark mode for the mobile app", "Webhooks retry for up to 3 days", "Bulk-archive old projects", "SSO with any SAML provider"][v % 6]}.
- ${["Fixed a crash when pasting large tables", "Exports keep their column order", "Fewer emails for muted threads"][v % 3]}.`;
      }).join("\n\n")}
`,
    }),
  },
  {
    title: "Investor update, October",
    slug: "investor-update",
    password: "preview",
    messages: ["First draft", "Add the revenue chart numbers", "Cut the hiring section", "Ready to send"],
    uploads: [...some(LAPTOP, 3, 30, 4, [21, 2]), ...some(null, 1, 3, 1, [9, 3])],
    files: (n) => ({
      "investor-update.md": `# Investor update, October

Hi all,

October was our best month yet: **$${(182 + n * 4).toFixed(0)}k MRR** (+11% month over month), and net revenue retention above 120% for the third month in a row.

## Highlights

- Signed our largest customer so far, a 900-seat logistics company.
- Teams entered private beta with 40 companies.
- Burn is down 18% after moving our infrastructure.

## Asks

- Intros to finance leads at companies with 200 to 2,000 people.
- Feedback on our pricing page draft.

Thanks for the support,
Mia
`,
    }),
  },
  {
    title: "Interview notes, staff engineer",
    expiresIn: 4 * DAY,
    messages: ["Notes from the loop", "Add the hiring committee summary"],
    uploads: some(DESKTOP, 2, 3, 0, [11, 6]),
    files: (n) => ({
      "interview-notes.md": `# Interview notes: staff engineer

*These notes expire in a few days.*

**System design:** strong. Proposed a queue between the API and billing, then argued herself out of it for our volume.

**Coding:** solid, tested as she went, explained trade-offs without being asked.

**Values:** clear about what she wants from a team; asked good questions about on-call.
${n > 1 ? "\n## Committee\n\nUnanimous yes. Offer at level 6." : ""}`,
    }),
  },
  {
    title: "Onboarding checklist",
    favorite: true,
    messages: ["", "Add the security training", "Update the laptop setup link"],
    uploads: some(null, 3, 200, 5, [9, 8]),
    files: (n) => ({
      "onboarding.md": `# Onboarding checklist

Welcome! Work through this in your first week. Ask in #new-joiners if anything is unclear.

## Day 1

- [ ] Get your laptop and set it up with the setup script
- [ ] Join Slack, GitHub and the calendar
- [ ] Lunch with your buddy

## Week 1

- [ ] Ship a small change to production
- [ ] Read the architecture overview
- [ ] Shadow a support shift${n > 1 ? "\n- [ ] Finish the security training (45 minutes)" : ""}
`,
    }),
  },
  {
    title: "Competitor research",
    space: "clients",
    messages: ["Add pricing for three more competitors", "Summarise the feature matrix", "New launch from Globex", "Update positioning notes", "Weekly refresh"],
    uploads: daily(RESEARCH, 0.35, 90, [0, 24]),
    files: (n) => ({
      "competitors.md": `# Competitor research

Refresh ${n}. Collected by the research agent from public pricing pages and changelogs.

| Company | Entry price | Seats included | Notable this week |
| --- | --- | --- | --- |
| Globex | $${12 + (n % 3)}/seat | 3 | ${n % 2 ? "Launched an AI assistant" : "Raised prices on the team plan"} |
| Initech | $9/seat | 5 | Dropped the free plan |
| Umbrella | $${20 + (n % 5)}/seat | 1 | SOC 2 Type II report published |

## Takeaways

- Nobody bundles invoicing with the team plan yet.
- Globex is moving upmarket; their new pricing page talks about "enterprises" eleven times.
`,
    }),
  },
  {
    title: "Pricing page draft",
    space: "clients",
    messages: ["First layout", "Three tiers instead of four", "Annual toggle", "Copy pass", "Highlight the Team plan"],
    uploads: some(RESEARCH, 8, 40, 1, [10, 10]),
    files: (n) => ({
      "index.html": `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pricing</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;background:#f7f6fb;color:#1d1b2e}main{max-width:60rem;margin:3rem auto;padding:0 1rem;text-align:center}
.tiers{display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:1rem;margin-top:2rem}.tier{background:#fff;border-radius:16px;padding:1.5rem;box-shadow:0 1px 3px #0001}
.tier.hot{outline:2px solid #6c5ce7}.price{font-size:2.2rem;font-weight:700}button{background:#6c5ce7;color:#fff;border:0;border-radius:10px;padding:.6rem 1.2rem;font:inherit;cursor:pointer}</style></head>
<body><main><h1>Simple pricing that grows with you</h1><p>Every plan includes unlimited projects and invoices.</p>
<p><label><input type="checkbox" id="annual"> Pay yearly, get two months free</label></p>
<div class="tiers">
<div class="tier"><h2>Starter</h2><div class="price" data-m="9">$9</div><p>For freelancers</p><button>Start free</button></div>
<div class="tier${n > 4 ? " hot" : ""}"><h2>Team</h2><div class="price" data-m="19">$19</div><p>Per seat, for growing teams</p><button>Start free</button></div>
<div class="tier"><h2>Business</h2><div class="price" data-m="39">$39</div><p>SSO, audit log and priority support</p><button>Talk to us</button></div>
</div></main>
<script>document.getElementById("annual").onchange=(e)=>document.querySelectorAll(".price").forEach((p)=>p.textContent="$"+(e.target.checked?Math.round(p.dataset.m*10/12):p.dataset.m));</script>
</body></html>`,
    }),
  },
  {
    title: "Sprint retro notes",
    messages: ["Retro notes", "Add action items"],
    uploads: some(OLD, 4, 330, 60, [16, 2]),
    files: (n) => ({
      "retro.md": `# Sprint retro

**Went well:** the new deploy pipeline, pairing on the billing bug.

**Didn't:** too many meetings on Thursdays; flaky end-to-end tests.
${n > 1 ? "\n## Actions\n\n- Move the planning meeting to Monday.\n- Quarantine the three flakiest tests this week." : ""}`,
    }),
  },
  {
    title: "Brand moodboard",
    messages: ["Colours", "Add type", "Final"],
    uploads: some(GONE, 3, 260, 230, [13, 5]),
    files: (n) => ({
      "moodboard.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 240" font-family="Georgia,serif">
${["#6c5ce7", "#fd79a8", "#00b894", "#fdcb6e", "#2d3436"].slice(0, 2 + n).map((c, i) => `<rect x="${i * 120}" width="120" height="${n > 1 ? 170 : 240}" fill="${c}"/>`).join("")}
${n > 1 ? '<text x="20" y="215" font-size="34" fill="#2d3436">Aa · Calm, sure, a little playful</text>' : ""}
</svg>`,
    }),
  },
];

export async function seed(env: Env) {
  const now = Date.now();
  const db = env.DB;
  const run = (sql: string, ...params: unknown[]) => db.prepare(sql).bind(...params).run();

  await run("INSERT INTO spaces (id, name, keys_delete, keys_read_locked, created_at) VALUES ('clients', 'Client work', 0, 0, ?)", now - 120 * DAY);
  const keys: [id: string, name: string, space: string, createdDaysAgo: number, revokedDaysAgo?: number][] = [
    [LAPTOP, "MacBook · Claude Code", "default", 340],
    [CI, "GitHub Actions", "default", 320],
    [DESKTOP, "Desktop · Codex", "default", 210],
    [RESEARCH, "Research agent", "clients", 110],
    [OLD, "Old ThinkPad", "default", 365, 45],
  ];
  for (const [id, name, space, created, revoked] of keys) {
    await run(
      "INSERT INTO api_keys (id, name, hash, created_at, space_id, revoked_at) VALUES (?, ?, ?, ?, ?, ?)",
      id,
      name,
      await sha256Hex(`sk_${randomId(43)}`), // no one holds these keys; the preview has no API to use them with
      now - created * DAY,
      space,
      revoked === undefined ? null : now - revoked * DAY,
    );
  }

  const blobs = new Map<string, Uint8Array>();
  for (const d of DOCS) {
    const uploads = d.uploads.sort((a, b) => a[1] - b[1]);
    const id = docId();
    await run(
      "INSERT INTO docs (id, slug, title, password_hash, favorite, expires_at, latest, created_at, updated_at, space_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id,
      d.slug ?? null,
      d.title,
      d.password ? await hashPassword(d.password) : null,
      d.favorite ? 1 : 0,
      d.expiresIn ? now + d.expiresIn : null,
      uploads.length,
      uploads[0][1],
      uploads.at(-1)![1],
      d.space ?? "default",
    );
    for (const [i, [key, time]] of uploads.entries()) {
      const n = i + 1;
      const files = [];
      for (const [path, text] of Object.entries(d.files(n))) {
        const bytes = new TextEncoder().encode(text);
        const sha256 = await sha256Hex(text);
        blobs.set(sha256, bytes);
        files.push({ path, sha256, size: bytes.byteLength });
      }
      // The same manifest hash push() computes.
      const manifest = await sha256Hex(files.map((f) => `${f.path}\t${f.sha256}`).sort().join("\n"));
      const message = d.messages[i % d.messages.length] || null;
      await run(
        "INSERT INTO versions (doc_id, n, manifest_hash, message, size, key_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        id,
        n,
        manifest,
        message,
        files.reduce((sum, f) => sum + f.size, 0),
        key,
        time,
      );
      for (const f of files) await run("INSERT INTO files (doc_id, n, path, sha256, size) VALUES (?, ?, ?, ?, ?)", id, n, f.path, f.sha256, f.size);
    }
  }

  for (const [id] of keys) await run("UPDATE api_keys SET last_used_at = (SELECT MAX(created_at) FROM versions WHERE key_id = ?1) WHERE id = ?1", id);
  // CI near its quota, so the analytics page has a key to warn about.
  await run("UPDATE api_keys SET quota_strategy = 'fifo', quota_bytes = (SELECT CAST(SUM(size) / 0.86 AS INTEGER) FROM versions WHERE key_id = ?1) WHERE id = ?1", CI);
  // One transaction for every blob: one each, through env.BUCKET, takes seconds.
  const uploaded = Date.now();
  await store("blobs", "readwrite", (s) => [...blobs].map(([sha, bytes]) => s.put({ bytes, uploaded }, `docs/${sha}`)).at(-1)!);
}
