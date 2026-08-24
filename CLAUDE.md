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

### Settings

All user configuration lives in **one** `localStorage` key, `sp-dashboard-settings`, holding a
JSON blob with a `schemaVersion`. Nothing else in `index.html` touches `localStorage`.

```
DEFAULT_SETTINGS          → the complete key list; also the type contract
readStoredSettings()      → parse + migrate legacy keys + coerce against defaults
getSetting(key)           → the only read path
setSetting(key, value)    → write + persist + applySettings()
rememberSetting(key, val) → record a dashboard control's last value (no re-render)
applySettings()           → applyAppearance + restartLiveUpdate + processData + re-render panel
```

- A stored value whose type doesn't match its default is replaced by the default (`coerceSetting`),
  and unknown keys are dropped. A hand-edited blob can't wedge the UI.
- The nine pre-settings keys (`sp-dashboard-date-preset`, `-pie-dim`, …) are folded in once on
  first load via `LEGACY_KEY_MAP`, then deleted.
- **Remember vs pin**: controls in Settings › Defaults have a `*Mode` / `*Pinned` / `*Last` triple,
  resolved by `resolveDefault()`. `remember` replays `*Last`; `pin` always uses `*Pinned`.
- The modal UI is **generated from `SETTINGS_SECTIONS`**, not written as markup. Adding a setting is
  one entry in `DEFAULT_SETTINGS`, one row in `SETTINGS_SECTIONS`, and one `getSetting()` read at the
  point of use — no HTML edit. Control types: `select`, `seg`, `radio`, `checks`, `toggle`, `days`,
  `chips`, `number`, `text`, `swatches`.
- Settings deliberately live in a modal, **not** a fourth tab: the tab bar feeds Share / Print /
  Copy-image, and settings must never appear in an exported report.

### Debug logging

Every diagnostic goes through `debugLog()` / `debugWarn()`, gated on the `debugLogging` setting and
**off by default**. Do not add a bare `console.log` — the per-task diagnostics fire once per task per
refresh. Genuine error paths still use `console.warn` / `console.error` unconditionally.

### Mock data fallback

If `PluginAPI` is unavailable (standalone file:// development), a 500ms timeout injects mock data so the full UI renders without the host app.

### Charts

No charting library. Bar chart uses CSS flexbox with `height` set as a percentage of max value; it automatically buckets data when the date range exceeds 30 days. Pie/donut chart uses a single `<div>` with `conic-gradient` computed from cumulative percentages.

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
