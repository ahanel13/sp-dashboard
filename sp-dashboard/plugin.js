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

// We listen to the global Redux ACTION hook.
// Whenever the user adds a task, tracks time, or changes a project, this fires.
PluginAPI.registerHook(PluginAPI.Hooks.ACTION, async (action) => {
  console.log("[sp-dashboard plugin] ACTION hook triggered", action.type);
  const iframes = document.querySelectorAll('iframe');
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
    if (iframe.src && iframe.src.includes('index.html')) {
      console.log("[sp-dashboard plugin] sending SP_STATE_CHANGED to", iframe.src);
      iframe.contentWindow.postMessage({
        type: 'SP_STATE_CHANGED',
        tags
      }, '*');
    }
  });
});
