# SPECTER — Implementation Audit & Improvement Checklist

Fresh audit against the **actual current code on disk** (verified via `grep`/`git status`, not
memory) and the **README's stated idea**, since a lot has changed hands in this repo across the
session — including a full revert that took several previously-fixed, live-verified issues back
out. Where something regressed, it's called out explicitly so it isn't silently lost again.

---

## ⚠️ Read this first: three fixes were implemented, live-verified working, then reverted

Earlier in this project's history, the items below were built, tested against the running app
(not just read from code), and confirmed working — then a `git checkout`/reset to an earlier
commit removed all of it because it had never been committed. They are genuinely **not in the
code right now**. Re-confirmed via `grep` on 2026-09-23:

- [x] ~~**The server-hang bug is back.**~~ **Resolved (2026-09-23, GitHub Issue #2 reopened by
  `pratham27-pro` — regression, not a new bug):** `ghostcommit.ts` now uses a bounded Database URL
  regex (`{1,100}` instead of unbounded `+`), skips any commit-diff line over 1,500 characters,
  caps per-file patches at 60KB and 1,000 lines, and yields to the Node event loop via
  `setTimeout(resolve, 0)` every 80 lines. Four independent layers, not just the regex fix alone,
  since the earlier version of this fix regressed once already — see the top note above this list
  for why nothing here should be assumed permanent until it's committed.
- [x] ~~**Supabase client crashes on missing config again.**~~ **Resolved (2026-09-24, GitHub
  Issue #3, `pratham27-pro`):** `src/lib/supabase.ts` now wraps each client in a Proxy that defers
  `createClient()` — and the env-var validation that goes with it — until the first actual
  property access (e.g. `.from(...)`), not module import time. A missing/misconfigured var now
  throws a descriptive `[Supabase Configuration Error] Missing environment variable(s): ...`
  message instead of an unhandled `TypeError`, and only when that specific client is actually
  used. Live-verified two ways: `next build` succeeds with all five Supabase env vars blanked out
  (previously failed outright at "Collecting page data"), and a real scan against the dev server
  with valid config still completes normally end-to-end.
- [ ] **`npm audit` is back to 11 vulnerabilities, 1 critical.** `next` is pinned at `16.2.9`
  again (was patched to `16.3.6`). `npm audit fix` resolves this with no breaking changes — it's
  a same-range patch bump, not a major version jump.

Also lost in the same revert, lower urgency: the manual "rescan" button (cache bypass), the
private/nonexistent-repo accessibility check (repos you can't access silently score ~0 again
instead of failing), the AI-explanation failure UI, Supabase read-error/no-data distinction, the
rate-limiter memory-leak fix, `INTERNAL_SECRET` fail-closed behavior, DepChain's
`package-lock.json` support, adaptive 3D quality, the scanner-cap tooltips, the CSP header, the
removed scaffold icons (they're back), the muted-text contrast improvement, and the 18-test
Vitest suite (deleted entirely — `src/lib/scanners/*.test.ts` no longer exist).

**What's still standing** (was committed, survived): the full landing-page/3D-scene/results-page
redesign, the shared `computeNodePositions()` fix for the attack-path alignment bug, the
`ScanSidebar` remount fix, the refresh-blank-page hydration fix, and the Supabase key-*naming*
fallback (just not the lazy-instantiation wrapper around it).

---

## 📋 README vs. actual implementation — the gaps in "the entire idea"

The README's "Key Features" section advertises things that either don't exist in this repo at all,
or don't match what's actually implemented. Cross-checked against every source file, not assumed:

- [ ] **"Automated Monitoring" via n8n → Telegram/Slack is not implemented anywhere in this repo.**
  This is listed as a headline "Key Feature" in the README ("Integrated with n8n... Receive
  real-time alerts directly in your Telegram or Slack"), but `grep -rn "n8n|telegram|webhook" src/`
  returns nothing except an unrelated Slack-*token-detection* regex in `ghostcommit.ts` (that's
  GhostCommit finding a leaked Slack token in someone's *code* — not this app sending anything to
  Slack). There's no webhook endpoint, no n8n config, no Telegram bot integration, no settings UI
  for it. `flow.txt` §7 and §10 both admit this outright ("n8n/Telegram workflow lives outside
  this repo") — so this is a known, documented gap, but it's still presented to a first-time
  reader as a working feature of the product.
- [ ] **No authentication exists, despite the README's tech stack claiming "Supabase (Database +
  Auth)."** Confirmed via `grep` — no signin/signup/session/login code anywhere. Every scan is
  fully anonymous; Supabase is used purely as a data store. If this was aspirational (e.g., saved
  scan history per user, per-account rate limits instead of per-IP), it's worth either building or
  removing "+ Auth" from the README so it doesn't over-promise.
- [ ] **README's own setup instructions use the *old* Supabase key names**
  (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) — a new contributor following the
  README literally with a freshly-created Supabase project (which now issues
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`/`SUPABASE_SECRET_KEY` by default) would only work because
  of the fallback in `supabase.ts`, which the README never explains. Minor, but worth a one-line
  README update so the docs and code agree.
- [ ] **README's `git clone` command points to `pratham27-pro/specter.git`**, but this repo's
  actual `origin` remote is `VanshikaaZ/specter.git`. Cosmetic, but confusing for anyone copy-pasting
  the setup steps from the README of what's presumably a fork.
- [x] Everything else the README claims as a "Key Feature" or in "The Intelligence Engine" table
  is genuinely implemented: all 5 scanners (DepChain, GhostCommit, LayerScan, APIBleed, EnvTrace),
  the immersive 3D HUD, AI-native analysis via OpenRouter/Gemini, and PDF export.

---

## 🔴 Critical

- [x] ~~**Server hang on real scans**~~ — Fixed: bounded regex quantifiers, per-file patch caps
  (60KB / 1,000 lines), a 1,500-char line-length guard, and periodic event-loop yields in
  `ghostcommit.ts` (see the top section for full detail).
- [x] ~~**Supabase crashes the app on missing/misconfigured env vars**~~ — Fixed: lazy Proxy
  instantiation in `src/lib/supabase.ts`, descriptive error only on first actual use, live-verified
  via a clean `next build` with all Supabase env vars unset (see the top section for full detail).
- [ ] **`npm audit fix`** — 11 vulnerabilities, 1 critical, in the pinned `next@16.2.9`.

## 🟠 Confirmed bugs

- [x] ~~Attack-path particles don't reach the vulnerable node~~ — fixed, `computeNodePositions()`
  shared between `DepGraph.tsx`/`AttackPaths.tsx`. Still present after the revert.
- [x] ~~Results sidebar remounts on every re-render~~ — fixed, `ScanSidebar` is a module-level
  component in `src/app/scan/[scanId]/page.tsx`. Still present.
- [ ] Run `npm run lint` again before your next change and treat it as a baseline — it was clean
  (0 errors/warnings) at the point of the last revert, but hasn't been re-verified against
  whatever's changed since.

## 🟡 Reliability / UX gaps

- [x] ~~Refresh `/scan/[id]` shows a blank page~~ — fixed, hydration-on-mount effect in
  `scan/[scanId]/page.tsx` (`hydrateRef`). Still present.
- [ ] **Private/nonexistent repos silently score ~0** instead of failing — the repo-accessibility
  check (`octokit.repos.get` before running scanners) was built and live-verified, then lost in
  the revert. Not currently in `run/route.ts`.
- [ ] **A stuck scan spins forever** — no poll timeout in `scanStore.ts` anymore.
- [ ] **In-memory rate limiter has an unbounded memory leak** — every unique IP that ever hits
  `/api/scan/start` stays in the `Map` forever; the cleanup sweep was lost in the revert. (True
  distributed rate-limiting across serverless instances is a separate, bigger gap — needs
  Redis/Supabase-backed shared state that was never wired up in any version of this code.)
- [ ] **`INTERNAL_SECRET` falls back to the public default string** `"specter-internal"` if unset
  in production — no fail-closed behavior currently.
- [ ] **AI-explanation failures are invisible** — `ai.ts` doesn't check `res.ok` before parsing,
  and the frontend's `.catch(() => {})` swallows the error silently again.
- [ ] **Supabase read errors aren't distinguished from "no data yet"** — the `PGRST116` check
  across the three API routes was lost in the revert.
- [ ] **No automated tests** — the 18-test Vitest suite (entropy function, all 11 secret regexes,
  the Dockerfile parser, a ReDoS regression test) was deleted along with the revert; `vitest` isn't
  even in `package.json` anymore.
- [ ] **6-hour global cache, no manual re-scan** — the `force` flag + "↻ RESCAN" button are gone.
- [ ] **DepChain still reads npm registry ranges, not `package-lock.json`** — version-drift fix
  reverted; npm-ecosystem-only remains a real (larger, unfixed-in-any-version) limitation.
- [ ] **Silent per-scan file caps** (GhostCommit 30 commits, APIBleed 35 files, EnvTrace 25 files)
  — the scanner-badge tooltips explaining these were lost in the revert.

## 🟢 Visual / polish

- [ ] **No Content-Security-Policy header** — added, then lost in the revert; the other five
  common security headers in `next.config.ts` are still present and fine.
- [ ] **Default Next.js/Vercel scaffold icons are back in `public/`** (`next.svg`, `vercel.svg`,
  `globe.svg`, `window.svg`, `file.svg`) — still unreferenced anywhere in `src/`.
- [x] ~~`ScannerBadges` only shows a 3-letter abbreviation with no explanation~~ — partially fixed:
  the badges do have a `title={label}` tooltip (survived the revert) showing the full scanner
  name, but the more detailed "what does this scanner actually cover" tooltip text (e.g.
  "GhostCommit — latest 30 commits only") was lost.
- [ ] **Low-contrast micro-text** — the redesign left `--muted` at a modest `#3a4d6c` (~2.2:1
  contrast against the void background), better than the original `#2a3d5c` but short of the
  further `#5b7699` (~4.15:1) improvement that was built and then lost.
- [ ] **No adaptive quality for the 3D scene** — the `useDeviceTier` hook (disables
  Bloom/antialiasing, halves star count on low-end hardware) no longer exists in `src/lib/`.

---

## Suggested order if you want these re-applied

1. The server-hang fix (top section) — this is a real, exploitable availability bug, not
   polish. Highest leverage of anything in this document.
2. Lazy Supabase client + `npm audit fix` — both quick, both already proven safe (no breaking
   changes) the first time.
3. Everything else in 🟡/🟢 — genuinely worth doing, all previously built and working, just needs
   re-applying (and this time, committing).

Every item marked `[ ]` above that mentions "was lost in the revert" is not speculative — each one
was independently implemented and live-tested (via `curl` against the running dev server) earlier
in this project's history, so re-applying them is low-risk, not exploratory work.
