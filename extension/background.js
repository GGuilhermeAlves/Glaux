// Glaux — background (service worker on Chromium, event page on Firefox):
// forwards keyboard shortcuts to the active tab.
const api = globalThis.browser ?? globalThis.chrome;

api.commands.onCommand.addListener(async (command) => {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;
  const type = command === 'toggle-compare' ? 'toggleCompare' : 'toggleMain';
  api.tabs.sendMessage(tab.id, { type }).catch(() => {});
});
