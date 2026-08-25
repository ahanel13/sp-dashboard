// 1. Register a button in the main app header to open your UI
// PluginAPI.registerHeaderButton({
//   label: 'Date Range Reporter',
//   icon: 'bar_chart',
//   onClick: () => {
//     // This command renders your index.html inside the main view iframe
//     PluginAPI.showIndexHtmlAsView();
//   },
// });

console.log("[sp-dashboard plugin] Date Range Reporter plugin loaded!");

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
    console.log("[sp-dashboard plugin] saved download", data.filename);
  } catch (e) {
    console.error("[sp-dashboard plugin] download failed", e);
  }
});

// ==========================================================
// MENU ICON (Settings > Appearance > Menu icon)
// Super Productivity draws a plugin's sidebar row from the SVG in its
// manifest and offers no API for changing it afterwards, so the user's
// choice is applied by replacing the rendered node. Two things make that
// safe rather than a blind DOM hack:
//   - the row carries `data-plugin-id`, so we only ever touch our own;
//   - the node we replace is `div.plugin-svg-icon`, the host's own
//     container for a plugin-supplied icon, not app chrome.
// The original children are stashed before the first swap, so picking
// "Dashboard (default)" restores the manifest icon exactly.
//
// The setting itself is written by the dashboard iframe. Its localStorage
// is this window's localStorage (the iframe is `srcdoc` + allow-same-origin),
// so the icon can be applied at startup, before the dashboard has ever been
// opened. Live changes arrive as SP_DASHBOARD_SET_MENU_ICON.
//
// KEEP IN SYNC with MENU_ICONS in index.html, which draws the pickers from
// the same geometry.
// ==========================================================
const SETTINGS_KEY = 'sp-dashboard-settings';
const DEFAULT_ICON_ID = 'default';

const MENU_ICONS = [
  { id: 'default', label: 'Dashboard (default)', shapes: [
    { t: 'rect', x: 3, y: 4, width: 18, height: 18, rx: 2 },
    { t: 'line', x1: 8, y1: 2, x2: 8, y2: 6 },
    { t: 'line', x1: 16, y1: 2, x2: 16, y2: 6 },
    { t: 'line', x1: 3, y1: 10, x2: 21, y2: 10 },
    { t: 'path', d: 'M6 19l4-3l4 2l4-5' }] },
  { id: 'bars', label: 'Bar chart', shapes: [
    { t: 'rect', x: 4, y: 12, width: 4, height: 8 },
    { t: 'rect', x: 10, y: 7, width: 4, height: 13 },
    { t: 'rect', x: 16, y: 3, width: 4, height: 17 },
    { t: 'line', x1: 3, y1: 21, x2: 21, y2: 21 }] },
  { id: 'pie', label: 'Pie chart', shapes: [
    { t: 'circle', cx: 12, cy: 12, r: 9 },
    { t: 'path', d: 'M12 12L12 3A9 9 0 0 1 21 12Z' }] },
  { id: 'activity', label: 'Activity', shapes: [
    { t: 'polyline', points: '3 12 7 12 10 4 14 20 17 12 21 12' }] },
  { id: 'calendar', label: 'Calendar', shapes: [
    { t: 'rect', x: 3, y: 4, width: 18, height: 18, rx: 2 },
    { t: 'line', x1: 8, y1: 2, x2: 8, y2: 6 },
    { t: 'line', x1: 16, y1: 2, x2: 16, y2: 6 },
    { t: 'line', x1: 3, y1: 10, x2: 21, y2: 10 }] },
  { id: 'clock', label: 'Clock', shapes: [
    { t: 'circle', cx: 12, cy: 12, r: 9 },
    { t: 'polyline', points: '12 7 12 12 16 14' }] },
  { id: 'target', label: 'Target', shapes: [
    { t: 'circle', cx: 12, cy: 12, r: 9 },
    { t: 'circle', cx: 12, cy: 12, r: 5 },
    { t: 'circle', cx: 12, cy: 12, r: 1.5, fill: 'currentColor' }] },
  { id: 'grid', label: 'Grid', shapes: [
    { t: 'rect', x: 3, y: 3, width: 7, height: 7, rx: 1 },
    { t: 'rect', x: 14, y: 3, width: 7, height: 7, rx: 1 },
    { t: 'rect', x: 14, y: 14, width: 7, height: 7, rx: 1 },
    { t: 'rect', x: 3, y: 14, width: 7, height: 7, rx: 1 }] },
  { id: 'trend', label: 'Trending up', shapes: [
    { t: 'polyline', points: '3 17 9 11 13 15 21 7' },
    { t: 'polyline', points: '15 7 21 7 21 13' }] },
  { id: 'gauge', label: 'Gauge', shapes: [
    { t: 'path', d: 'M4 19a9 9 0 1 1 16 0' },
    { t: 'line', x1: 12, y1: 19, x2: 16, y2: 12 },
    { t: 'circle', cx: 12, cy: 19, r: 1.5, fill: 'currentColor' }] }
];

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_TAGS = ['rect', 'circle', 'line', 'path', 'polyline', 'polygon'];
const ICON_ATTRS = ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
                    'width', 'height', 'd', 'points'];

// Nodes are built with createElementNS and only whitelisted attributes are
// copied across, so nothing that arrives here can turn into markup or an
// event handler -- the shapes are geometry or they are dropped.
function buildIconSvg(shapes) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  (Array.isArray(shapes) ? shapes : []).forEach((shape) => {
    if (!shape || ICON_TAGS.indexOf(shape.t) === -1) return;
    const node = document.createElementNS(SVG_NS, shape.t);
    // The host stylesheet forces `fill: currentColor` onto the <svg>; a child
    // without its own fill would inherit it and render as a solid blob.
    const filled = shape.fill === 'currentColor';
    node.setAttribute('fill', filled ? 'currentColor' : 'none');
    if (filled) node.setAttribute('stroke', 'none');
    ICON_ATTRS.forEach((attr) => {
      if (shape[attr] !== undefined) node.setAttribute(attr, String(shape[attr]));
    });
    svg.appendChild(node);
  });
  return svg;
}

function findMenuIcon(id) {
  return MENU_ICONS.find((i) => i.id === id) || MENU_ICONS[0];
}

// The iframe owns the settings blob; we only ever read it, and only this key.
function readStoredIconId() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_ICON_ID;
    const parsed = JSON.parse(raw);
    const id = parsed && parsed.menuIcon;
    return typeof id === 'string' && MENU_ICONS.some((i) => i.id === id)
      ? id
      : DEFAULT_ICON_ID;
  } catch (e) {
    return DEFAULT_ICON_ID;
  }
}

let currentIconId = readStoredIconId();
let currentIconShapes = findMenuIcon(currentIconId).shapes;
const originalIconNodes = new WeakMap();

function applyMenuIcon() {
  const hosts = document.querySelectorAll(
    'nav-item[data-plugin-id="' + PLUGIN_ID + '"] .plugin-svg-icon'
  );
  hosts.forEach((host) => {
    // Already showing this icon -- nothing to do. This is what keeps the
    // MutationObserver below from turning every nav repaint into DOM work.
    if (host.dataset.spDashboardIcon === currentIconId) return;
    // Nothing has been swapped on this node and the manifest icon is what we
    // want anyway, so leave the host's own DOM untouched. Anyone who never
    // opens this setting keeps exactly the markup the app rendered.
    if (currentIconId === DEFAULT_ICON_ID && !originalIconNodes.has(host)) return;
    if (!originalIconNodes.has(host)) {
      originalIconNodes.set(host, Array.from(host.childNodes, (n) => n.cloneNode(true)));
    }
    if (currentIconId === DEFAULT_ICON_ID) {
      host.replaceChildren(...originalIconNodes.get(host).map((n) => n.cloneNode(true)));
    } else {
      host.replaceChildren(buildIconSvg(currentIconShapes));
    }
    host.dataset.spDashboardIcon = currentIconId;
  });
}

// Angular recreates the sidebar row whenever the nav re-renders (collapse,
// route change, a project being added), which throws our node away. Re-apply
// after the fact rather than fighting change detection. Coalesced into one
// pass per frame so a busy app doesn't pay for it.
let iconPassQueued = false;
function scheduleMenuIcon() {
  if (iconPassQueued) return;
  iconPassQueued = true;
  const run = () => {
    iconPassQueued = false;
    applyMenuIcon();
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 0);
}

try {
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.addedNodes.length || record.removedNodes.length) {
        scheduleMenuIcon();
        return;
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
} catch (e) {
  console.warn("[sp-dashboard plugin] could not watch the sidebar for re-renders", e);
}

scheduleMenuIcon();

// Live updates from Settings > Appearance. Same ownership check as the
// download bridge: only our own iframe may retarget our own row.
window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'SP_DASHBOARD_SET_MENU_ICON') return;
  if (!isOwnPluginWindow(event.source)) return;
  const id = typeof data.iconId === 'string' ? data.iconId : DEFAULT_ICON_ID;
  currentIconId = MENU_ICONS.some((i) => i.id === id) ? id : DEFAULT_ICON_ID;
  currentIconShapes = Array.isArray(data.shapes)
    ? data.shapes
    : findMenuIcon(currentIconId).shapes;
  applyMenuIcon();
});

// We listen to the global Redux ACTION hook.
// Whenever the user adds a task, tracks time, or changes a project, this fires.
PluginAPI.registerHook(PluginAPI.Hooks.ACTION, async (action) => {
  console.log("[sp-dashboard plugin] ACTION hook triggered", action.type);
  const iframes = document.querySelectorAll(`iframe[data-plugin-id="${PLUGIN_ID}"]`);
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
      console.log("[sp-dashboard plugin] sending SP_STATE_CHANGED to dashboard iframe");
      iframe.contentWindow.postMessage({
        type: 'SP_STATE_CHANGED',
        tags
      }, '*');
    }
  });
});
