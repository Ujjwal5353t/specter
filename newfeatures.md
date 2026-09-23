# SPECTER — New Feature Ideas Checklist

Brainstormed against the actual current codebase (`src/lib/scanners/`, `src/components/Scene/`,
`src/lib/ai.ts`, `src/app/`) — every feasibility score and file list below reflects real,
already-existing state/data/components, not generic SaaS boilerplate. Nothing in this file is
implemented yet; it's a planning checklist.

**Key discovery driving several of the "free" items below:** `depchain.ts`'s `getNpmDeps()`
already fetches the *full* npm registry metadata response for every package and only reads
`data.dependencies` before discarding the rest. That same response also contains `license`,
`maintainers`, and `time.modified` — data already paid for on every scan, currently thrown away.

---

## 🌟 If you only build three things

- [ ] **License + maintainer surfacing in `depchain.ts`** — the data is already fetched on every
  scan and currently discarded.
- [ ] **Keyboard shortcuts** — almost pure wiring against state (`filter`, `layoutMode`,
  `focusCount`) that already exists in `SpectreScene.tsx`/`HUDControls.tsx`.
- [ ] **Markdown badge generator** — the only idea in this doc with genuine organic-growth
  potential, and it's a self-contained new route touching nothing else.

---

## 1. 🌐 3D Spatial Telemetry & "Iron Man HUD"

- [ ] **Blast-Radius Isolation ("X-Ray Slice")** — *Feasibility: 7/10*
  - **Pitch:** Click a vulnerable node, everything NOT on the root→node attack path fades to
    near-invisible wireframe — the blast radius becomes the only thing you can see.
  - **UX:** Click any red/amber sphere in `DepGraph.tsx` → non-path nodes drop to ~8% opacity over
    ~400ms, path edges stay lit, everything else goes ghost.
  - **Files:** `DepGraph.tsx` only. `useScanStore().selectedNode` and `edges: DepEdge[]` already
    exist; needs one BFS-from-root helper plus conditional opacity in `DepSphere`.

- [ ] **Attack Path Time Scrubber** — *Feasibility: 6/10*
  - **Pitch:** Drag a timeline slider and watch secrets appear/disappear across the last 30
    commits in chronological order — "replay the leak."
  - **UX:** A scrubber under `CommitTimeline.tsx`; dragging highlights the active commit's spike
    and dims the rest.
  - **Files:** `SecretFinding.date`/`commit_sha` already exist per finding, just isn't sorted/
    scrubbed. New scrubber component + sort-by-date in `CommitTimeline.tsx`.

- [ ] **One-Shot "Radiation Pulse" on scan completion** — *Feasibility: 8/10*
  - **Pitch:** A single expanding ring shockwaves out from the core sphere the instant results
    land — the 3D complement to the existing 2D `ThreatFlash`.
  - **UX:** Purely ambient, no interaction needed.
  - **Files:** `RepoNode.tsx` already tracks `isReady`; just needs a one-shot mesh triggered on
    the false→true transition. Smallest, safest win in this category.

- [ ] **Reticle Lock-On** — *Feasibility: 6/10*
  - **Pitch:** Hovering a node snaps an animated HUD crosshair to it with a brief "ACQUIRING
    TARGET" readout before the label resolves — `GimbalReticle.tsx`'s bigger, more aggressive
    sibling.
  - **Files:** `DepGraph.tsx` already has `hoveredId` state; needs `camera.project()` math to
    place an HTML overlay over a 3D point (standard r3f pattern, not novel).

---

## 2. ⚡ AI "Actionable Remediation" (`src/lib/ai.ts`)

- [ ] **1-Click Terminal Hotfix** — *Feasibility: 8/10*
  - **Pitch:** Every AI item gets a real, pasteable shell command, not just prose.
  - **UX:** A `[COPY FIX]` button on each `AIPanel.tsx` item — reuses the exact `CopyButton`
    component already built in `FindingsList.tsx`.
  - **Files:** One new field in the prompt's JSON schema (`terminal_fix`), one new
    `AIExplanation.items[].terminal_fix?` type, wire the existing copy component. No new infra.

- [ ] **Simulated Breach Impact Brief** — *Feasibility: 9/10*
  - **Pitch:** "If this ships: an attacker chaining this CORS wildcard with the unauthenticated
    `/api/admin` write endpoint gets full account takeover within one request."
  - **Files:** Pure prompt engineering on the already-existing `explainFindings()` call. Add one
    field, no plumbing at all.

- [ ] **AI Confidence Disclaimer Chip** — *Feasibility: 10/10*
  - **Pitch:** A quiet "AI-generated — verify before running" chip on `AIPanel.tsx`, since
    `parseAIResponse()`'s silent fallback can truncate on malformed JSON right now with no visible
    signal.
  - **Files:** One line of UI, zero backend change. Closes a real trust gap.

---

## 3. 🛡️ Scanner Superchargers (no new heavy deps)

- [ ] **License field — already fetched, currently discarded** — *Feasibility: 9/10*
  - **Pitch:** Flag GPL/AGPL copyleft dependencies for commercial repos.
  - **Files:** `getNpmDeps()` in `depchain.ts` already has `data.license` in the same JSON it
    already fetches and caches; it's just never read. Add one field to the cache entry, one to
    `DepNode`.

- [ ] **Maintainer / bus-factor signal — same free data** — *Feasibility: 8/10*
  - **Pitch:** Flag single-maintainer, recently-stale packages — literally the event-stream
    attack shape the whole product is themed around, using data already in hand.
  - **Files:** `data.maintainers.length` and `data.time.modified` are in the exact same discarded
    registry response in `depchain.ts`. Type + UI plumbing only.

- [ ] **CISA KEV (Known Exploited Vulnerabilities) flag** — *Feasibility: 7/10*
  - **Pitch:** A 🔥 "ACTIVELY EXPLOITED" badge on any CVE that's on CISA's public, free, stable
    JSON feed of vulnerabilities confirmed exploited in the wild — stronger urgency signal than
    CVSS alone.
  - **Files:** One new fetch to a stable public endpoint; needs `OSVVuln`'s currently-uncaptured
    `aliases` array (where the real CVE ID lives) added to the type in `depchain.ts`.

- [ ] **npm Typosquat Detector** — *Feasibility: 5/10*
  - **Pitch:** Flag `lodahs` next to `lodash` — edit-distance-1 matches against a small bundled
    list of top packages.
  - **Files:** A bundled static JSON (a few KB, respects "no heavy deps") plus a ~15-line
    Levenshtein function. Genuinely new, not surfaced-for-free like the two above.

- [ ] **Entropy Heatmap for GhostCommit** — *Feasibility: 9/10*
  - **Pitch:** A literal color-gradient heatmap strip (cool blue → hot red as entropy rises)
    alongside the existing bar-height-by-entropy visualization.
  - **Files:** `SecretFinding.entropy` is already computed and returned; pure color-mapping
    function applied to already-computed data in `CommitTimeline.tsx`.

---

## 4. 🚀 Viral Shareability

- [ ] **Markdown Badge Generator** — *Feasibility: 7/10* — the highest-ROI idea in this doc
  - **Pitch:** `[![Specter Grade: A](...)](...)` for READMEs — this is literally how
    Codecov/Snyk/CI badges spread organically across GitHub.
  - **Files:** New `src/app/api/badge/[scanId]/route.ts` returning a template-string SVG
    (`image/svg+xml`, no image library needed — same trick shields.io uses). Score/repo data
    already sits in `scans`.

- [ ] **Dynamic OpenGraph Preview Cards** — *Feasibility: 6/10*
  - **Pitch:** Sharing a `/scan/[scanId]` link on X/Discord shows a real score card, not a blank
    link preview.
  - **Files:** Next.js ships `next/og`'s `ImageResponse` specifically for this
    (`opengraph-image.tsx` file convention, zero new dependency, framework auto-wires the `<meta>`
    tag).

- [ ] **"Roast My Repo" tweet card** — *Feasibility: 8/10*
  - **Pitch:** Auto-generated, tweet-length savage one-liner from the AI summary, pre-filled into
    a `twitter.com/intent/tweet` link.
  - **Files:** Reuses `AIExplanation.summary` almost verbatim; the share mechanic is a plain URL,
    no backend at all.

- [ ] **Side-by-Side Repo Comparison** — *Feasibility: 4/10*
  - **Pitch:** `axios` vs `got` — two cores, two `ThreatGauge`s, split screen.
  - **Honest callout:** the one idea here that needs real architecture work — `scanStore.ts`
    currently models exactly one `scanResult`. Highest differentiation vs. Snyk/Dependabot (which
    are strictly single-repo), but don't start here.

---

## 5. ⌨️ Keyboard Mastery — recommended to build first as a category

`SpectreScene.tsx` already owns `filter`/`layoutMode`/`focusCount` state, and `HUDControls.tsx`
already has buttons calling `setFilter`/`onFocusCore` for everything below. A keyboard layer is
mostly wiring one `keydown` listener to setters that already exist:

- [ ] `[V]` cycle to vulnerable-only filter — calls the exact `onFilterChange('vulnerable')` the
  button already calls. *Feasibility: 10/10.*
- [ ] `[F]` Focus Core — calls the exact existing `onFocusCore` prop. *Feasibility: 10/10.*
- [ ] `[C]` copy shareable link — `navigator.clipboard.writeText(location.href)`.
  *Feasibility: 10/10.*
- [ ] `[?]` HUD-styled shortcut cheat-sheet overlay (Linear/Superhuman-style).
  *Feasibility: 9/10* — pure UI.
- [ ] `[Space]` freeze orbit — needs one new boolean in `scanStore.ts` (orbit-pause is currently
  implicitly tied to `selectedNode`, which isn't quite the same thing). *Feasibility: 8/10.*
- [ ] `[/]` fuzzy node search — the one genuinely new UI piece (no text search over
  `DepNode.name` exists yet), but the data's already client-side. *Feasibility: 5/10.*

---

## Feasibility legend

`10/10` = wiring only, zero new logic · `7–9/10` = small, self-contained addition, no new infra ·
`4–6/10` = genuinely new component/data source, still scoped · `<4/10` = real architecture work,
plan separately.
