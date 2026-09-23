# SPECTER — Improvement Report (Live-Verified)

Re-checked with the app **actually running** against your real `.env` (GitHub token, Supabase,
OpenRouter key all present) — not just static code reading. This update adds two critical issues
found only by running a real scan, and confirms everything from the first pass. No source files
were modified; only this report was edited.

---

## 🔴 CRITICAL — fix these first

- **Your current `.env` cannot work with this code as-is (confirmed live).**
  The code (`src/lib/supabase.ts`) reads `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
  `SUPABASE_SERVICE_ROLE_KEY`. Your `.env` instead has `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and
  `SUPABASE_SECRET_KEY` — Supabase's newer key-naming scheme. Result: every API route crashes
  with `Error: supabaseKey is required.` I reproduced this exact error live via `curl`.
  → **Fix:** either rename the two keys in `.env` to match the old names the code expects, or
  update `src/lib/supabase.ts` to read the new names. (`SUPABASE_JWKS_URL` in your `.env` is also
  unused by any file in the codebase — dead config, safe to ignore/remove.)

- **A single real scan can hang the ENTIRE server — confirmed, not theoretical.**
  After fixing the key names above, I ran a live scan against `github.com/lodash/lodash` (a
  completely ordinary, popular repo — no malicious content). The server:
  - Pegged a CPU core at ~100% continuously for 8+ minutes (measured: +57s of CPU time per 30s
    of wall time)
  - Stopped responding to **every** request — not just the scan, but the plain homepage (`GET /`)
    and an unrelated `/api/explain` call both timed out completely
  - Never recovered; I had to kill the process

  **Why:** the only CPU-heavy, fully synchronous code in this codebase is the regex + Shannon-
  entropy scanning in `ghostcommit.ts` (11 patterns × every added line × 30 commit diffs) and the
  credential regexes in `envtrace.ts`. None of it yields to the Node event loop mid-file, so on a
  large/active repo with sizeable diffs, this can block the single-threaded server indefinitely —
  taking down every other in-flight request with it. Some of the regexes (e.g. the Database URL
  pattern `[^\s"'<>]+:[^\s"'<>]+@[^\s"'<>]+` in `ghostcommit.ts`) also have the classic shape for
  catastrophic backtracking on pathological input like a long minified/bundled line in history.
  → **This is a real availability bug, not a performance nitpick** — right now, anyone scanning a
  moderately large public repo can make the app unusable for every other concurrent user.
  → **Fix:** move scanning work off the request thread (a queue/worker), add per-file size caps
  before regex-scanning, and/or chunk the entropy/regex passes with periodic `setImmediate`
  yields so the event loop isn't starved.

- **`npm run build` and every API route crash on a fresh clone with no `.env.local` at all**
  (separate from the naming issue above). `src/lib/supabase.ts` calls `createClient()` at
  **module import time** with non-null assertions. Confirmed: `POST /api/scan/start`,
  `/run`, and `/status` all return raw 500 stack traces; `next build` fails outright at
  "Collecting page data." I verified the build *does* succeed once *any* well-formed placeholder
  URL is present — so this is purely a "crashes instead of degrading gracefully" problem.
  → **Fix:** instantiate the Supabase client lazily inside each function, wrapped in a try/catch
  that returns a clean error instead of letting the import throw.

- **`npm audit`: 11 vulnerabilities, 1 critical** (in the pinned `next` version range) —
  includes unauthenticated RCE on Windows-hosted servers and via the AVIF image-optimization
  path, plus SSRF via `rewrites()`. Also flagged: `brace-expansion`, `browserslist`, `postcss`,
  `js-yaml`, `nanoid`, `dompurify`, `fflate`. Run `npm audit fix`. Notable irony for a
  security-scanning product to ship with a critical framework CVE.

---

## 🟠 Confirmed bugs in the running app

- **Attack-path particles don't reach the vulnerable node they're supposed to.**
  `DepGraph.tsx:27,33` adds a random Y-axis offset to each node's position; `AttackPaths.tsx:22-34`
  computes the *same* nodes' positions but always uses `y=0`. The two files independently
  duplicate the position math and disagree — the red particle stream (meant to visually flow from
  a vulnerable package to the repo core) never actually lines up with that package's glowing
  sphere. → Compute positions once, share via a prop/hook.

- **The results sidebar fully remounts on every unrelated re-render.**
  `src/app/scan/[scanId]/page.tsx:61` — `SidebarContent` is defined *inside* `ScanPage`'s body, so
  it's a new component identity every render. Dragging the mobile sheet, resizing the window, or
  any store update forces React to unmount/remount the whole sidebar: entrance animations replay,
  and `FindingsList`'s expanded-finding state resets. Flagged by ESLint's
  `react-hooks/static-components` rule. → Move it to a top-level component.

- **`Math.random()` called during render** (`DepGraph.tsx:27,33`) — flagged by
  `react-hooks/purity`; same lines as the position-mismatch bug above, worth fixing together.

- **28 ESLint errors, 9 warnings total** (`npm run lint`) — beyond the two above: a
  `setState`-in-effect smell in `ThreatFlash.tsx:10`, 5× `no-explicit-any` (`depchain.ts` ×4,
  `report.ts` ×1), and half a dozen unused imports/vars across `ScannerBadges.tsx`,
  `apibleed.ts`, `envtrace.ts`, `layerscan.ts`, `scanStore.ts`.

---

## 🟡 Reliability / UX gaps

- **Refreshing `/scan/[id]` or opening a shared link shows a blank page** — `ScanResult` lives
  only in the in-memory Zustand store, never re-fetched by `scanId` on mount. Confirmed live
  (`GET /scan/anything` → 200, empty). Already noted in your own `flow.txt`. → On mount, if
  `scanId` is in the URL but the store is empty, call `/api/scan/[id]/status` once to rehydrate.

- **A stuck scan spins forever with no timeout.** `scan/start/route.ts` fires the trigger to
  `/run` with only a 3s abort signal and swallows failures into a `console.error`; the frontend's
  polling `setInterval` has no max-attempts/timeout. Combine with the hang bug above and a user
  can be staring at the radar loader indefinitely with zero feedback.

- **Private/nonexistent repos silently score as "clean" (~0)** instead of failing — documented
  in your own `test.txt` §A6. For a security tool, "we couldn't scan this" should never look
  identical to "this is safe." → Check repo accessibility up front and mark the scan `'failed'`.

- **In-memory rate limiter isn't real on serverless** (`rateLimit.ts`) — resets per cold
  start/instance, so "5 scans/hour" isn't reliably enforced on Vercel.

- **`INTERNAL_SECRET` falls back to the public string `"specter-internal"`** if unset in
  production — since that fallback is visible in the open-source repo, forgetting to set it means
  effectively no protection on the internal trigger route.

- **AI-explanation failures are invisible.** `ai.ts` never checks `res.ok` on the
  OpenRouter/Gemini fetch before parsing — a rate-limited/invalid-key response silently degrades
  into a low-quality fallback instead of a visible error. (Side note from live testing: the
  default `openrouter/free` auto-router can pick a heavy reasoning model that spends tokens on
  hidden chain-of-thought before its answer — worth capping `max_tokens` more generously or
  pinning a non-reasoning free model, though I couldn't get a clean before/after comparison since
  the server hang above interrupted this specific test.)

- **Supabase read errors aren't distinguished from "no data yet"** — several `.single()` calls
  (e.g. `status/route.ts`) discard the `error` and only check `data`.

- **No automated tests anywhere** — your own `test.txt` says so directly. For regex/entropy-based
  detection logic, this means regressions in the 11 secret patterns or the Dockerfile parser would
  ship silently.

- **6-hour global cache, no manual re-scan** — if a repo owner fixes a vuln, every user sees the
  stale score for up to 6 hours with no way to force a fresh scan.

- **DepChain reads npm registry metadata, not a lockfile** — version drift is possible; npm-only
  (confirmed: `depchain.ts` only ever reads `package.json`), so non-JS repos get 0 dependency nodes.

- **Silent per-scan file caps** — GhostCommit: latest 30 commits only. APIBleed: 35 files.
  EnvTrace: 25 source files. None of this is surfaced in the UI on a large monorepo.

---

## 🟢 Visual / polish

*(Chrome extension still isn't connected this session, so these remain code-reading-based, not
screenshot-verified — worth a quick visual pass with the two no-key-needed demo buttons.)*

- **No Content-Security-Policy header** — the other five common security headers are already set
  in `next.config.ts`; CSP is the one gap, notable for a security-branded product.
- **Default Next.js/Vercel scaffold icons still in `public/`** (`next.svg`, `vercel.svg`,
  `globe.svg`, `window.svg`, `file.svg`) — confirmed via grep, none are referenced anywhere in
  `src/`. Cheap cleanup.
- **`ScannerBadges.tsx` computes a full label ("DepChain") but only ever renders the 3-letter
  abbreviation** ("DEP") — confirmed by ESLint's unused-var warning. First-time users see
  `DEP/GST/LYR/API/ENV` with no tooltip explaining them.
- **Very low-contrast micro-text by design** (7–9px labels on muted tokens over a near-black
  background) — worth a WCAG contrast pass, especially since `test.txt` explicitly plans for
  projector presentations.
- **No adaptive quality for the 3D scene** — Bloom, 3000 stars, and 64-segment spheres always
  render at full fidelity regardless of device; `test.txt` itself warns to "run plugged in."
- **Minor dev-environment hygiene:** a stray, essentially-empty `package-lock.json` exists one
  level up at `C:\Users\vanshika grover\SPECTER\package-lock.json` (not inside `specter/`),
  which makes Turbopack print a "multiple lockfiles / ambiguous workspace root" warning on every
  dev-server start. Safe to delete if nothing depends on it.

---

## Priority order

1. **Fix the `.env` key names** (or update `supabase.ts` to read the new ones) — nothing else
   works until this is right.
2. **Fix the scan-time server hang** — this is a real availability problem, not polish; anyone
   can trigger it by scanning an ordinary repo.
3. **Make the Supabase client instantiate lazily** so missing/bad config degrades instead of
   crashing the whole app and blocking `next build`.
4. **`npm audit fix`** for the critical Next.js CVE cluster.
5. Fix the two confirmed 3D/UI bugs (attack-path alignment, sidebar remount) — both hit the app's
   main selling point and main interaction.
6. Everything in the Reliability/UX and Polish sections — genuinely worth doing, lower urgency.

No files other than this report were changed; no existing source file was modified. The temporary
`.env.local` I created to verify the key-naming fix (and the dev server it enabled) were removed
after testing.
