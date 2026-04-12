// ─────────────────────────────────────────────────────────────────────────────
// Prabala Studio – Spy Window Preload
// Injected into the spy BrowserWindow.
// Exposes window.__prabalaSendLocator so the injected SPY_UI script can send
// the captured locator back to the main process via IPC.
// ─────────────────────────────────────────────────────────────────────────────

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__prabalaSendLocator', function(locator, tag, text) {
  ipcRenderer.send('spy:capture', { locator, tag, text });
});
