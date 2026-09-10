# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test                  # Run tests once (Vitest + JSDOM)
npm run test:watch        # Run tests in watch mode
npm run test:coverage     # Generate v8 coverage report
npm run check:syntax      # Validate JS syntax via Acorn (extracts <script> from index.html)
npm run build:min         # Minify HTML/CSS/JS into build/sp-dashboard/
npm run screenshot        # Regenerate assets/ screenshots via Puppeteer
make build                # Full plugin build → sp-dashboard.zip
make release-check        # Verify prerequisites before releasing (clean state, tag, gh CLI)
make release              # Tag, push, create GitHub release (requires clean git state + gh CLI)
make clean                # Remove generated files
```

To run a single test: `npx vitest run --reporter=verbose tests/index.test.js -t "test name pattern"`

The `gh` CLI lives at **`/home/anthony/bin/gh`**, which is not on `PATH` in a non-login shell —
invoke it by full path (`/home/anthony/bin/gh pr view 16`) or `gh` will come back "command not
found" and PR-scoped work will silently fall back to the local working tree.

## Architecture

This is a **Super Productivity plugin** — a sandboxed iframe widget. All UI logic must live in `sp-dashboard/index.html` as a self-contained file (embedded CSS + JS, no external runtime dependencies).

### Two-file plugin model

- **`sp-dashboard/plugin.js`** — runs in the host app context. Registers an ACTION Redux hook with `PluginAPI.addEventListener`, then fires a `postMessage` to the iframe on every state change. This is the only bridge between the host app and the UI.
- **`sp-dashboard/index.html`** — runs in an isolated iframe. Receives `SP_STATE_CHANGED` messages and pulls fresh data via `PluginAPI.getTasks()` / `getArchivedTasks()` / `getAllProjects()`. All rendering, state, and logic lives here.

Available PluginAPI methods (beyond data fetching): `showSnack({ msg, ico })` for toast notifications, `getStorage()` / `setStorage(data)` for persistence (declared in manifest but currently unused).

### Data flow inside index.html

```
postMessage → loadData() → PluginAPI calls → cachedTasks / cachedProjects
  → processData(tasks, projects, dateRange) → metrics object
    → updateDashboardUI()   (stat cards)
    → updateBarChart()      (weekly time, CSS flex bars)
    → updatePieChart()      (project breakdown, CSS conic-gradient)
    → renderTable()         (detailed entries, sortable)
```

`processData()` is the core aggregation function. It deduplicates active + archived tasks (Map by ID, active takes precedence), filters by date range, and computes: time spent, completion counts, overdue/late flags, per-day breakdowns, and per-project summaries.

### Two aggregation passes, one set of rules

`buildTaskContext(tasks, projects, tags)` owns everything that decides **what counts** —
exclusions, `minEntryMs`, the subtask double-counting rule, `projectNameOf` / `tagNamesOf`. Both
`processData()` and the heatmap run off it, and `processData` stashes the context it built in
`latestTaskContext` so the heatmap renders from exactly the same tasks rather than re-reading the
caches (they diverge whenever `processData` is called with an explicit task list).

If either pass re-implemented a filtering rule, the heatmap would quietly disagree with the stat
card six inches above it. A test asserts `buildHeatmapSeries({dim:'total', metric:'time'})` equals
`processData(...).totalTimeSpent` over the same range. Do not remove it.

### Settings

All user configuration lives in **one** `localStorage` key, `sp-dashboard-settings`, holding a
JSON blob with a `schemaVersion`. Nothing else in `index.html` touches `localStorage`.

```
DEFAULT_SETTINGS          → the complete key list; also the type contract
SETTING_OPTIONS           → legal values + labels for every enumerated setting
SETTING_RANGES / _ITEMS   → bounds for free-form numbers; legal array members
readStoredSettings()      → parse + migrate legacy keys + coerce against defaults
getSetting(key)           → the only read path
setSetting(key, value)    → write + persist + applySettings()
rememberSetting(key, val) → record a dashboard control's last value (no re-render)
applySettings()           → applyAppearance + restartLiveUpdate + processData + re-render panel
```

**Adding a setting** — all four steps, in this order:

1. A key in `DEFAULT_SETTINGS` (this is the type contract).
2. If it is enumerated, its values in `SETTING_OPTIONS`; if it is a free-form number, its bounds in
   `SETTING_RANGES`; if it is an array, its legal members in `SETTING_ITEMS`.
3. A row in `SETTINGS_SECTIONS` whose control references `SETTING_OPTIONS.<key>` — never an inline
   option list, or the UI and the validator will drift.
4. A `getSetting()` read at the point of use. No HTML edit; the modal is generated.

Control types: `select`, `seg`, `radio`, `checks`, `toggle`, `days`, `chips`, `number`, `text`,
`swatches`.

**Validation is not optional.** `coerceSetting` checks the *value*, not just its type: an enumerated
setting must name one of its options, a number is clamped, array members are filtered, and unknown
keys are dropped. Skipping step 2 leaves a setting that accepts anything a JSON file contains —
which is how a bad `tabPinned` used to throw inside `switchTab()` during init and take the whole
dashboard down with it. A test walks every control in `SETTINGS_SECTIONS` and imports each of its
options, so a setting wired up without step 2 will fail the suite.

Prefer allowlists throughout: name what is permitted rather than what is forbidden. The guards here
all follow that shape, including the CSV export, which leaves a cell bare only when it opens with a
letter or digit rather than stripping a known-bad set of formula characters.

- The nine pre-settings keys (`sp-dashboard-date-preset`, `-pie-dim`, …) are folded in once on
  first load via `LEGACY_KEY_MAP`, then deleted.
- **Remember vs pin**: controls in Settings › Defaults have a `*Mode` / `*Pinned` / `*Last` triple,
  resolved by `resolveDefault()`. `remember` replays `*Last`; `pin` always uses `*Pinned`. The
  `*Last` keys are validated too — several of them reach the same code paths as their `*Pinned` twin.
- Settings deliberately live in a modal, **not** a tab: the tab bar feeds Share / Print /
  Copy-image, and settings must never appear in an exported report.

**Adding a tab** touches more than `TAB_IDS`: `getActiveViewNode()` carries a *second* hardcoded
list (miss it and every export silently reports the Dashboard), plus `tabPinned` in
`SETTING_OPTIONS`, `tabLast` in `SETTING_LAST_VALUES`, a branch in `buildCsvSummary` and
`buildTextSummary`, and the `@media print` rules.

### Untrusted input

Three things arriving from outside are treated as hostile, and each has regression tests:

- **Imported settings files** — see validation above.
- **`postMessage` into the iframe** — only `window.parent` is accepted, mirroring the sender check
  `plugin.js` performs in the other direction (`isOwnPluginWindow`). Anything sharing the host page,
  including another installed plugin, can otherwise reach this frame. Incoming tags are rebuilt into
  a clean list rather than assigned wholesale.
- **Task, project and tag names** — host data that may contain markup. Anything data-derived reaching
  `innerHTML` goes through `escapeHtml()`; prefer `textContent` where possible.

### Debug logging

Every diagnostic goes through `debugLog()` / `debugWarn()`, gated on the `debugLogging` setting and
**off by default**. Do not add a bare `console.log` — the per-task diagnostics fire once per task per
refresh. Genuine error paths still use `console.warn` / `console.error` unconditionally.

### Mock data fallback

If `PluginAPI` is unavailable (standalone file:// development), a 500ms timeout injects mock data so the full UI renders without the host app. Two layers: a handful of hand-written tasks in the 2026-02-17 – 02-22 window that the dashboard/list/drilldown screenshots are built around, and a deterministically generated ~11 months of history behind them so the heatmap has something to draw. The generated history skips that window and finishes every task it opens, so it cannot move the numbers the other screenshots assert.

### Charts

No charting library. Bar chart uses CSS flexbox with `height` set as a percentage of max value; it automatically buckets data when the date range exceeds 30 days. Pie/donut chart is an SVG whose slices are `stroke-dasharray` arcs on one circle — it used to be a `conic-gradient` background, and was rewritten because print engines drop backgrounds.

### Heatmap

A fourth tab. Three grid shapes over one engine:

```
buildHeatmapSeries(ctx, {dim, metric, from, to, maxRows, rowSort})
  → renderCalendarHeatmap()   dim 'total'  — weeks × weekdays
  → renderMatrixHeatmap()     otherwise    — entities × day buckets
buildPunchcard(ctx, from, to) → renderPunchcard()  — weekday × hour
```

- **It walks entries, not the day cross-product.** `processData` is O(tasks × days), which is fine
  over a week and wasteful over a year. `buildHeatmapSeries` iterates each task's own
  `timeSpentOnDay` keys instead, and memoises on `(dataVersion, dim, metric, from, to, …)`.
- **It keeps its own range** (`heatmapSpan`, default 365 days). The header period defaults to
  *Today*, and a calendar heatmap of one day is a single square. `heatmapSpan: 0` opts back in.
  The calendar also rebuilds a dense day axis: `hideNonWorkingDays` deletes days from the metrics
  range, and a calendar with weekends removed stops lining up week to week.
- **Cells are `<rect fill="#rrggbb">` with a `<title>` child**, never `<div>` + `background-color`.
  Print engines drop backgrounds (see the pie chart), and `<title>` is a native tooltip and an
  accessible name for free. This applies to the *legend* swatches too. A `<title>` must be its
  target's *first child*, so a row label's tooltip hangs off a wrapping `<g>` — nesting it inside
  the `<text>` folds it into the label's own `textContent`.
- **Bin the values you actually paint.** A matrix column covers a week on a long span
  (`heatmapColumnStep` / `bucketRowCells`, used by both the renderer and the threshold calculation).
  Deriving thresholds from single days and then painting week totals puts ~90% of cells in the top
  bucket and flattens the grid to one colour; a test asserts no single fill exceeds 60% of the grid.
- **Ramps hang off the existing `palette` setting** (`HEATMAP_RAMPS`, light and dark authored
  separately — inverting one into the other produces mud). `isLightSurface()` measures the body's
  computed background rather than assuming. `beforeprint` flips `heatmapForceLight` and repaints;
  that is only correct because the print block names `body.force-dark` explicitly, otherwise a
  pinned dark theme wins on specificity.
- **Binning is the difference between a useful heatmap and a decorative one.** Quantile is the
  default; linear against the max collapses under a single long day. `computeBinEdges` returns
  however many edges survive de-duplication — ties are dropped rather than padded — so the ramp is
  sampled to `edges.length + 1`, not to the requested bucket count. Zero is never a colour bucket:
  a day with four minutes and a day with nothing must look different.
- **`metric: 'overdue'` is a flow, not the bar chart's stock.** It is placed once, on the task's due
  day; the bar chart carries an overdue task forward onto every day it stays open. The option label
  says so. `HEATMAP_METRIC_OPTIONS` is deliberately separate from `METRIC_OPTIONS` for this reason.
- **Habits are repeating tasks.** Super Productivity has no habit entity; `habitKeyOf` groups on
  `repeatCfgId` when the host sends it and falls back to normalised titles when it doesn't
  (`habitSource`). The field is not in the documented plugin payload, so it is feature-detected.

Tracked time is **day-granular** (`timeSpentOnDay: {'2026-02-22': ms}`). There is no hour-of-day
signal for it anywhere in the payload — the punchcard is completions only, from the `doneOn` epoch.

### Theming

All colors are CSS custom properties (`--bg`, `--text-color`, `--c-primary`, etc.). Dark mode is toggled by `.dark-theme` on `<body>` — mirroring the host app's class injection.

### Build pipeline

`make build` runs: template substitution on `manifest.json.template` (injects VERSION/DESCRIPTION) → `scripts/minify.sh` (html-minifier-terser) → zip packaging. Version is the single source of truth in `package.json`.

## Testing

Tests live in `tests/index.test.js` and use Vitest with a JSDOM environment. The test harness sets `document.documentElement.innerHTML = html`, then executes the `<script>` block via `new Function()` — this means **any function you want to test must be explicitly assigned to `window`** inside the script (e.g. `window.processData = processData`). Mock `PluginAPI` is injected via `global.PluginAPI` before each test.

## Key constraints

- Keep `index.html` self-contained — no `import` statements, no external CDN links, no `require()`.
- All user-visible strings in the UI must be sanitized before insertion into the DOM (use `textContent`, not `innerHTML`, for any data-derived content).
- Plugin permissions are declared in `manifest.json.template`; `persistDataSynced` / `loadSyncedData` are declared but currently unused.
