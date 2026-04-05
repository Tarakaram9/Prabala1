// Prabala Recorder — Background Service Worker (minimal)
// All recording logic is in content.js via HTTP polling. No WebSocket here.

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get('studioOrigin', (result) => {
    if (!result.studioOrigin) {
      chrome.storage.local.set({ studioOrigin: 'http://localhost:3000' });
    }
  });
});
