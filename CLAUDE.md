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
- Settings deliberately live in a modal, **not** a fourth tab: the tab bar feeds Share / Print /
  Copy-image, and settings must never appear in an exported report.

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
