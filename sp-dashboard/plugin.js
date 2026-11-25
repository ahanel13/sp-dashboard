// 1. Register a button in the main app header to open your UI
// PluginAPI.registerHeaderButton({
//   label: 'Date Range Reporter',
//   icon: 'bar_chart',
//   onClick: () => {
//     // This command renders your index.html inside the main view iframe
//     PluginAPI.showIndexHtmlAsView();
//   },
// });

// Must match the "id" field in manifest.json.template.
const PLUGIN_ID = 'sp-dashboard';

// Super Productivity loads every plugin's view via `iframe.srcdoc` (no `src` URL),
// and marks the iframe's owner with `data-plugin-id`. Since the iframe carries
// `allow-same-origin`, we can read `frameElement` off the sender's Window to find
// the exact DOM element that sent a message and check its owning plugin id --
// this is what actually distinguishes our iframe from any other installed
// plugin's, unlike matching on `src` (which is always empty under `srcdoc`).
function isOwnPluginWindow(win) {
  if (!win) return false;
  try {
    const el = win.frameElement;
    return !!el && el.getAttribute('data-plugin-id') === PLUGIN_ID;
  } catch (e) {
    return false;
  }
}

// The dashboard iframe is sandboxed and typically cannot start a file download itself.
// It posts the generated image here; we save it from the (unsandboxed) host context,
// which uses the app's normal download flow (defaults to the user's Downloads folder).
window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'SP_DASHBOARD_DOWNLOAD' || !data.blob) return;
  if (!isOwnPluginWindow(event.source)) return;
  try {
    const url = URL.createObjectURL(data.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = data.filename || 'dashboard.png';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    console.error("[sp-dashboard plugin] download failed", e);
  }
});

// Tell the dashboard the host's state changed, at most every so often.
//
// The ACTION hook fires for every Redux action in the app, and a running timer
// dispatches one every second. Each message makes the dashboard reread every
// task, the archive included, so forwarding them one for one meant a full
// reread per second for as long as a timer ran.
//
// Trailing debounce: one message once the actions stop for QUIET_MS. It must
// be longer than the timer's 1 s tick, or every tick counts as "stopped" and
// goes through. A timer never stops, so MAX_WAIT_MS caps the wait and the view
// still catches up while one runs. Nothing is fetched or sent while the
// dashboard is closed.
const QUIET_MS = 1500;
const MAX_WAIT_MS = 5000;
let notifyTimer = null;
let firstPendingAt = 0;

function dashboardFrames() {
  return document.querySelectorAll(`iframe[data-plugin-id="${PLUGIN_ID}"]`);
}

async function notifyDashboard() {
  notifyTimer = null;
  firstPendingAt = 0;
  const iframes = dashboardFrames();
  if (!iframes.length) return;

  // Fetch tags from host context (more API access than the sandboxed iframe)
  let tags = [];
  try {
    const getTagsFn = PluginAPI.getTags || PluginAPI.getAllTags;
    if (getTagsFn) {
      tags = (await getTagsFn.call(PluginAPI)) || [];
    }
  } catch (e) {
    console.warn("[sp-dashboard plugin] could not fetch tags:", e);
  }

  iframes.forEach((iframe) => {
    if (iframe.contentWindow) {
      iframe.contentWindow.postMessage({
        type: 'SP_STATE_CHANGED',
        tags
      }, '*');
    }
  });
}

function scheduleNotify() {
  if (!dashboardFrames().length) return;
  const now = Date.now();
  if (!firstPendingAt) firstPendingAt = now;
  if (notifyTimer) clearTimeout(notifyTimer);
  const wait = Math.max(0, Math.min(QUIET_MS, firstPendingAt + MAX_WAIT_MS - now));
  notifyTimer = setTimeout(notifyDashboard, wait);
}

// The hook receives `{ action }`; the action itself isn't needed, only that
// something changed.
PluginAPI.registerHook(PluginAPI.Hooks.ACTION, scheduleNotify);
