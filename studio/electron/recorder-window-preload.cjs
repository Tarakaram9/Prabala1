// ─────────────────────────────────────────────────────────────────────────────
// Prabala Studio – Recorder Window Preload
// Injected into the recording BrowserWindow.  Bridges DOM events → main process
// via ipcRenderer.send so the main process can forward steps to the renderer.
// ─────────────────────────────────────────────────────────────────────────────

const { contextBridge, ipcRenderer } = require('electron');

// Expose the step callback so INTERCEPT_SCRIPT can call window.__prabalaSendStep
contextBridge.exposeInMainWorld('__prabalaSendStep', function(type, locator, value) {
  ipcRenderer.send('recorder:raw-step', { type, locator, value });
});
