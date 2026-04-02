// ─────────────────────────────────────────────────────────────────────────────
// Prabala Recorder — Background Service Worker (minimal)
//
// The heavy lifting is now done by content.js via HTTP polling.
// This background script is kept only to seed the default studio origin on
// first install, so content.js has a starting point.
// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  // Seed with localhost:3000 (dev default). The content.js on the Studio page
  // will overwrite this with the actual origin once the user opens Studio.
  chrome.storage.local.get('studioOrigin', (result) => {
    if (!result.studioOrigin) {
      chrome.storage.local.set({ studioOrigin: 'http://localhost:3000' });
    }
  });
});

//
// Connects to the Prabala Studio WebSocket server.
// When the Studio sends a "recorder:inject" message, this worker injects the
// recording script into the relevant browser tab — providing the same seamless
// recording experience as the Electron app, but in any browser.
//
// INSTALL: Load the /extension folder as an unpacked extension in
//   chrome://extensions  (enable Developer mode first)
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// Studio server origin.  In dev it's localhost:3000; in production it's the
// same host as the Studio web page the user is viewing.  We check both:
// 1. The URL stored in chrome.storage (set when the Studio page loads and
//    detects this extension via the "extension:hello" handshake).
// 2. Fallback: localhost:3000 for local dev.
const DEFAULT_STUDIO_ORIGIN = 'http://localhost:3000';

let ws = null;
let studioOrigin = DEFAULT_STUDIO_ORIGIN;
let reconnectTimer = null;
let connected = false;

// ── Restore persisted studio origin ──────────────────────────────────────────
chrome.storage.local.get(['studioOrigin'], (result) => {
  if (result.studioOrigin) studioOrigin = result.studioOrigin;
  connect();
});

// ── WebSocket connection ──────────────────────────────────────────────────────
function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  const wsProto = studioOrigin.startsWith('https') ? 'wss' : 'ws';
  const wsUrl = studioOrigin.replace(/^https?/, wsProto) + '/prabala-ws';

  try {
    ws = new WebSocket(wsUrl);
  } catch (e) {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    connected = true;
    clearTimeout(reconnectTimer);
    // Announce ourselves so the Studio can show "Extension connected" status
    ws.send(JSON.stringify({ type: 'extension:hello', payload: { version: '1.0.0' } }));
  };

  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }

    if (msg.type === 'recorder:inject') {
      // Studio started a recording session — inject the script into the target tab
      injectRecordingScript(msg.payload);
    }
  };

  ws.onclose = () => {
    connected = false;
    ws = null;
    scheduleReconnect();
  };

  ws.onerror = () => {
    ws && ws.close();
  };
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, 4000);
}

// ── Script injection ──────────────────────────────────────────────────────────
async function injectRecordingScript({ url, scriptSrc }) {
  // Wait up to 8 s for a tab with a URL that starts with the target URL to
  // become active and fully loaded (handles slow-loading apps).
  const tabId = await findOrWaitForTab(url, 8000);
  if (tabId == null) {
    console.warn('[PrabalaRec] No matching tab found for', url);
    return;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',          // run in the page's own JS context (not isolated)
      func: (src) => {
        // Inject a <script> tag — avoids any eval restrictions, works with all CSPs
        // that allow the studio server origin (or *, since it's localhost in dev).
        const s = document.createElement('script');
        s.src = src + '?t=' + Date.now();
        document.head.appendChild(s);
      },
      args: [scriptSrc],
    });
  } catch (err) {
    console.error('[PrabalaRec] Failed to inject recording script:', err);
  }
}

// ── Tab finder ────────────────────────────────────────────────────────────────
// Returns the tabId of the first tab whose URL starts with `targetUrl`.
// If none is found immediately, polls until `timeoutMs` then returns null.
function findOrWaitForTab(targetUrl, timeoutMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;

    async function check() {
      // Match on prefix so /login?redirect=... matches /login
      const tabs = await chrome.tabs.query({});
      const match = tabs.find(t => t.url && t.url.startsWith(targetUrl.split('?')[0]));
      if (match) {
        // Wait until the tab is fully loaded
        if (match.status === 'complete') {
          resolve(match.id);
        } else {
          // Poll for load complete
          waitForTabLoad(match.id, deadline - Date.now()).then(resolve);
        }
        return;
      }
      if (Date.now() > deadline) { resolve(null); return; }
      setTimeout(check, 300);
    }

    check();
  });
}

function waitForTabLoad(tabId, remainingMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + remainingMs;
    function check() {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) { resolve(null); return; }
        if (tab.status === 'complete') { resolve(tabId); return; }
        if (Date.now() > deadline) { resolve(tabId); return; } // inject anyway
        setTimeout(check, 200);
      });
    }
    check();
  });
}

// ── Listen for messages from Studio pages (content-script channel) ───────────
// When the user opens a Studio page, it can update the studioOrigin so that
// the extension connects to the right WS even in production (non-localhost).
chrome.runtime.onMessageExternal && chrome.runtime.onMessageExternal.addListener(
  (msg, _sender, sendResponse) => {
    if (msg && msg.type === 'prabala:setOrigin' && msg.origin) {
      studioOrigin = msg.origin;
      chrome.storage.local.set({ studioOrigin: msg.origin });
      // Reconnect to new origin
      if (ws) ws.close();
      else connect();
      sendResponse({ ok: true });
    }
  }
);

// Start initial connection
connect();
