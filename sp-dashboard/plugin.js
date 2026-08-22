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
