# SPECTER // Supply Chain Threat Intelligence

**"The ghosts in your codebase. Made visible."**

**[Live Demo: specter-seven.vercel.app](https://specter-seven.vercel.app/)** |
**[YouTube Video Demo](https://youtu.be/yFcc3rzBGe4)** |
**[Project Presentation (PPT)](https://docs.google.com/presentation/d/1akkN0q_k67gA_h6EymnjD1QTG1c0lWJw/edit?usp=sharing&ouid=100969165397374107651&rtpof=true&sd=true)**

Specter is not another static security dashboard. It is an immersive, 3D threat intelligence platform that maps your repository's attack surface in real-time. By visualizing dependency trees, commit history, and runtime environments as spatial nodes, Specter reveals the "ghosts"—malicious code, secrets, and insecure configurations—that standard scanners miss.

---

## 👁 The Intelligence Engine

Specter runs 5 specialized scanners in parallel to generate a holistic threat score (0–100) for any GitHub repository:

| Scanner         | Intelligence Focus                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------- |
| **DepChain**    | Maps the dependency tree & surfaces transitive CVEs using OSV.dev telemetry.                       |
| **GhostCommit** | Analyzes commit history for high-entropy strings, secrets, and malicious injection patterns.       |
| **LayerScan**   | Parses Dockerfile instructions to detect root-user escalation, unpinned images, and secret baking. |
| **APIBleed**    | Maps public API surfaces to identify unauthenticated write-endpoints and missing rate limits.      |
| **EnvTrace**    | Traces source code for hardcoded credentials and detects insecure environment file commits.        |

### How the threat score works

The score is a transparent, additive model, not a statistical one. Four buckets each have a cap, so no single category can saturate the score on its own, and the caps sum to 100:

| Bucket           | Formula (`calcThreatScore`)                                              | Cap | Why                                                                                                            |
| ---------------- | ------------------------------------------------------------------------ | --- | -------------------------------------------------------------------------------------------------------------- |
| **Infra**        | `Σ severity weight` over EnvTrace + LayerScan findings                   | 40  | Largest bucket: misconfiguration is the most common way a repo is compromised, and it is cheap to fix.          |
| **Dependencies** | `8 × vulnerable packages + 4 × packages with a supply-chain risk signal` | 30  | A known-vulnerable package is a confirmed weakness; a heuristic risk signal is only a warning, so it weighs half. |
| **Secrets**      | `10 × secrets found in recent commits`                                   | 20  | A leaked secret is exploitable immediately, but two or three already means "rotate everything".                 |
| **Code / API**   | `5 × unauthenticated write endpoints`                                    | 10  | Heuristic route detection has the highest false-positive rate, so it gets the smallest share.                   |

Severity weights: critical 15, high 8, medium 4, low 1, info 0. Each step roughly doubles, so one critical outweighs a high and a medium together, lows are near-noise, and informational findings never move the score. Bands: 0-9 nominal, 10-39 elevated, 40-69 high, 70+ critical.

A package that is both vulnerable and carries a risk signal counts in both dependency terms (8 + 4), since those are independent problems.

**Worked example: why 73 and not 60.** Every point traces back to a finding:

| Bucket       | Repo B                                           | Repo A (B + two findings)                          |
| ------------ | ------------------------------------------------ | -------------------------------------------------- |
| Infra        | 1 critical + 1 high + 2 low = 15 + 8 + 1 + 1 = **25** | + 1 more high finding → **33**                     |
| Dependencies | 2 vulnerable + 1 risky = 16 + 4 = **20**         | **20**                                             |
| Secrets      | 1 secret = **10**                                | **10**                                             |
| Code / API   | 1 unauthenticated write endpoint = **5**         | + 1 more endpoint → **10** (bucket now at its cap) |
| **Total**    | **60**                                           | **73**                                             |

Repo A is 13 points worse because of one extra high-severity infra finding (+8) and one extra open write endpoint (+5). A third open endpoint would add nothing, because the Code / API bucket is capped at 10. Fixing the extra high finding in Repo A would drop it to 65, which is still in the high band. The per-bucket breakdown is also shown on the scan page's threat gauge.

The weights and caps are hand-chosen ordinal judgements (confirmed and exploitable beats heuristic), not derived from CVSS aggregation or a benchmark. Read the score as a triage ranking and use the per-finding severities for the actual decisions. A scanner that fails contributes 0 rather than failing the scan.

### Measured accuracy

The composite score has no ground truth, but two of the scanners that feed it do, and they are benchmarked with `npm run benchmark` against the same code a real scan runs. Full per-case results: [`scripts/benchmark/RESULTS.md`](scripts/benchmark/RESULTS.md).

**DepChain (known CVEs).** 12 npm packages pinned to a version with a known advisory (including event-stream 3.3.6, ua-parser-js 0.7.29, node-ipc 10.1.1, minimist 1.2.5, lodash 4.17.20) and to the release that fixed it:

| Metric | Result |
| --- | --- |
| Known advisory detected on the vulnerable version | 12/12 (100%) |
| Same advisory reported on the patched version | 0/12 |
| Advisories reported that OSV.dev does not list for that version | 0 |
| Agreement with OSV.dev across all 24 versions (81 advisories) | 24/24 exact |

This shows DepChain reports exactly what OSV.dev knows, with nothing missed or invented. It cannot flag a compromise OSV hasn't catalogued yet, so it would not have caught event-stream on day zero.

**GhostCommit (secrets in commit history).** A labelled corpus of 25 planted fake secrets and 59 clean lines, 15 of which are deliberately secret-looking (hashes, public keys, placeholders):

| Metric | Result |
| --- | --- |
| Recall, all planted secrets | 21/25 (84%) |
| Recall, vendor-format keys (AWS, GitHub, Stripe, Slack, JWT, private keys…) | 19/20 (95%) |
| Recall, unstructured secrets (passwords, hex tokens) | 2/5 (40%) |
| False positives on ordinary code | 0/44 |
| False positives on secret-looking non-secrets | 10/15 |
| Precision | 21/31 (68%) |

Known weak spots: human-chosen passwords and pure-hex secrets (hex never exceeds the 4.5-bit entropy threshold), and integrity hashes, public keys and `.env.example` placeholders get flagged. Treat GhostCommit as a high-recall first pass for vendor keys, not a complete secret audit.

---

## 🚀 Key Features

- **Immersive 3D HUD:** Powered by `react-three-fiber`. Dependency graphs, attack paths, and secret timelines are rendered in a 3D tactical space, allowing you to spatially understand how an attacker moves through your application.
- **AI-Native Analysis:** Powered by Gemini/OpenRouter, Specter doesn't just list CVEs. It provides an "Intelligence Brief" that translates complex vulnerability data into actionable remediation steps and real-world impact scenarios.
- **Continuous Monitoring:** Point a GitHub push webhook at Specter and every push to the default branch triggers a fresh scan (bypassing the 6h cache). If the new threat score is higher than the last one, a Telegram alert lands with the score delta, the commit that caused it, and the top critical/high findings. Repos you don't own can be watched on a schedule via a cron endpoint instead.
- **Exportable Intel:** Generates high-fidelity PDF intelligence reports containing your vulnerability surface area and top remediation priorities, ready for audit or team review.

---

## 🛠 Tech Stack

Specter is built with a high-performance stack designed for real-time telemetry:

- **Frontend:** Next.js 16 (App Router), Tailwind CSS, Framer Motion (for UI orchestration), and `three.js` / `react-three-fiber` (for the 3D HUD).
- **Intelligence:** OpenRouter (AI analysis), OSV.dev (vulnerability database), and GitHub REST API (telemetry).
- **Backend & Sync:** Supabase (Database), GitHub webhooks + Telegram Bot API (monitoring & alerts).

---

## 🚀 Setup & Installation

1. **Clone the repository:**

```bash
git clone https://github.com/pratham27-pro/specter.git
cd specter

```

1. **Install dependencies:**

```bash
npm install

```

1. **Configure Environment Variables:**
   Create a `.env.local` file at the root:

```env
GITHUB_TOKEN=your_github_token
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
SUPABASE_SECRET_KEY=your_supabase_secret_key
OPENROUTER_API_KEY=your_key
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Optional: continuous monitoring (see below)
GITHUB_WEBHOOK_SECRET=a_random_string
TELEGRAM_BOT_TOKEN=from_botfather
TELEGRAM_CHAT_ID=your_chat_id
CRON_SECRET=a_random_string
MONITORED_REPOS=owner/repo,owner/other-repo

```

1. **(Optional) Set up monitoring:**
   - **Telegram:** create a bot with [@BotFather](https://t.me/BotFather), message it once, then read your chat id from `https://api.telegram.org/bot<token>/getUpdates`.
   - **Push webhook (repos you own):** Repo → Settings → Webhooks → Add webhook. Payload URL `https://<your-app>/api/webhooks/github`, content type `application/json`, secret = `GITHUB_WEBHOOK_SECRET`, "Just the push event".
   - **Scheduled rescans (any public repo):** hit `GET /api/monitor/cron` with `Authorization: Bearer $CRON_SECRET` from Vercel Cron or any external scheduler; it rescans every repo in `MONITORED_REPOS`.

   The first monitored scan of a repo sends a "now monitoring" baseline message; after that you only get alerted when the score goes up.

1. **Launch the System:**

```bash
npm run dev

```

---

## 🛡 Security Philosophy

Specter follows a "Cold Industrial Intelligence" design. We believe that security data is high-density and high-impact; it should not be hidden behind rounded corners, excessive gradients, or generic SaaS aesthetics. By prioritizing spatial data, mono-spacing, and immediate visual hierarchy, Specter provides security teams with the clarity required to stop supply chain attacks before they materialise.
