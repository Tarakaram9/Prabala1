// ─────────────────────────────────────────────────────────────────────────────
// Prabala Recorder — Content Script
//
// Runs on every page (document_idle). Two responsibilities:
//
// 1. If THIS page is the Prabala Studio page (detected via meta tag), save its
//    origin to chrome.storage so other pages know where to call home.
//
// 2. On any other page, ask the Studio server "should I inject the recorder
//    script on this URL?". If yes, inject it as a <script> tag.
//
// This approach has NO dependency on a long-lived WebSocket or a persistent
// background service worker — both of which are unreliable in MV3.
// ─────────────────────────────────────────────────────────────────────────────

(async function () {
  'use strict';

  // ── 1. Detect if we are on the Prabala Studio page ───────────────────────
  const studioMeta = document.querySelector('meta[name="prabala-studio-origin"]');
  if (studioMeta) {
    // Save this origin so content scripts on other tabs can make requests to it
    await chrome.storage.local.set({ studioOrigin: location.origin });
    // postMessage crosses the content-script isolation boundary into the page's
    // JS context — CustomEvent/dispatchEvent does NOT (isolated world).
    window.postMessage({ type: 'prabala-extension-ready', version: '1.2.0' }, location.origin);
    return; // nothing more to do on the Studio page itself
  }

  // ── 2. Skip chrome:// and extension pages ────────────────────────────────
  if (location.protocol === 'chrome:' || location.protocol === 'chrome-extension:') return;

  // ── 3. Determine where to ask for the pending recording ──────────────────
  const stored = await chrome.storage.local.get('studioOrigin');
  // Build a list of candidates: saved origin first, then localhost defaults
  const candidates = [...new Set([
    stored.studioOrigin,
    'http://localhost:3000',
    'http://localhost:5173',
  ].filter(Boolean))];

  // ── 4. Poll /api/recorder/pending for this URL ───────────────────────────
  for (const origin of candidates) {
    try {
      const r = await fetch(
        `${origin}/api/recorder/pending?url=${encodeURIComponent(location.href)}`,
        { method: 'GET', credentials: 'omit' }
      );
      if (!r.ok) continue;
      const data = await r.json();
      if (data.inject && data.scriptSrc) {
        // ── 5. Inject the recording script into the page ─────────────────
        const s = document.createElement('script');
        s.src = data.scriptSrc + '?t=' + Date.now();
        (document.head || document.documentElement).appendChild(s);
      }
      // Stop trying other origins once we got a valid response (even inject:false)
      break;
    } catch {
      // Server not available on this origin — try next candidate
    }
  }
})();
