// ─────────────────────────────────────────────────────────────────────────────
// Prabala Desktop / Mobile Spy
//
// Connects to a running Appium server, fetches the current app's accessibility
// tree as XML via the W3C WebDriver /source endpoint, and presents an
// interactive element picker in a Playwright browser window.
//
// Click any row to capture its locator (accessibility id / resource-id /
// automation id / xpath) — sent back via the same fetch → route mechanism
// used by the web spy.
//
// Args:  <appiumUrl>  <mode>
//   appiumUrl  defaults to http://localhost:4723
//   mode       'desktop' | 'mobile'
//
// stdout: { "locator": "...", "tag": "...", "text": "..." }
//         { "__error": "..." }
//         { "__done": true }
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const playwright = require('playwright');

const appiumUrl = (process.argv[2] || 'http://localhost:4723').replace(/\/$/, '');
const mode      = process.argv[3] || 'desktop';

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// ── Appium helpers ────────────────────────────────────────────────────────────

async function fetchJSON(url) {
  // Node 18+ ships global fetch
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Appium responded HTTP ${res.status} for ${url}`);
  return res.json();
}

async function getFirstSession() {
  let data;
  try {
    data = await fetchJSON(`${appiumUrl}/sessions`);
  } catch (err) {
    throw new Error(
      `Cannot reach Appium at ${appiumUrl}.\n` +
      `Make sure Appium is running (appium) and reachable.\nDetail: ${err.message}`
    );
  }
  const sessions = Array.isArray(data?.value) ? data.value : [];
  if (sessions.length === 0) {
    throw new Error(
      `No active Appium sessions at ${appiumUrl}.\n` +
      `Launch your app first using the Desktop.LaunchApp / Mobile.LaunchApp keyword, then open Spy.`
    );
  }
  return sessions[0].id;
}

async function getPageSource(sessionId) {
  const data = await fetchJSON(`${appiumUrl}/session/${sessionId}/source`);
  const src = String(data?.value || '');
  if (!src) throw new Error('Appium returned an empty page source. Ensure the app screen is loaded.');
  return src;
}

// ── Locator strategy (runs in browser-side JS) ────────────────────────────────

const LOCATOR_JS = /* js */`
function bestLocator(node) {
  // Accessibility id — works on iOS, Android, macOS, Windows
  const name = node.getAttribute('name') ||
               node.getAttribute('content-desc') ||
               node.getAttribute('label') ||
               node.getAttribute('accessibility-id') ||
               node.getAttribute('AccessibilityId');
  if (name) return { locator: '~' + name, strategy: 'accessibility id' };

  // Android resource-id
  const resId = node.getAttribute('resource-id');
  if (resId && resId.includes('/')) return { locator: resId, strategy: 'resource-id' };

  // Windows / macOS AutomationId
  const autoId = node.getAttribute('AutomationId') || node.getAttribute('automationId');
  if (autoId) return { locator: '~' + autoId, strategy: 'automation id' };

  // macOS mac2 identifier
  const identifier = node.getAttribute('identifier');
  if (identifier) return { locator: '~' + identifier, strategy: 'accessibility id' };

  // XPath fallback
  return { locator: buildXPath(node), strategy: 'xpath' };
}

function buildXPath(node) {
  if (!node.parentNode || node.parentNode.nodeType !== 1) return '/' + node.tagName;
  const siblings = Array.from(node.parentNode.children).filter(c => c.tagName === node.tagName);
  const idx = siblings.indexOf(node) + 1;
  return buildXPath(node.parentNode) + '/' + node.tagName +
         (siblings.length > 1 ? '[' + idx + ']' : '');
}

function collectNodes(node, depth, acc) {
  if (!node || node.nodeType !== 1) return;
  const tag = node.tagName;
  if (!tag || tag === 'parsererror') return;
  const { locator, strategy } = bestLocator(node);
  const text = node.getAttribute('text') || node.getAttribute('value') || node.getAttribute('label') || '';
  acc.push({ tag, locator, strategy, text, depth: Math.min(depth, 8) });
  Array.from(node.children).forEach(c => collectNodes(c, depth + 1, acc));
}
`;

// ── Picker HTML ───────────────────────────────────────────────────────────────

function buildPickerHTML(xmlSource, mode) {
  const title = mode === 'mobile' ? '📱 Mobile Spy' : '🖥 Desktop Spy';
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Prabala ${title}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:monospace;font-size:12px;background:#0f0f15;color:#c4b5fd;min-height:100vh}
#banner{position:sticky;top:0;z-index:100;background:#1e1b4b;color:#e9d5ff;font:600 13px system-ui;
  padding:10px 18px;border-bottom:1px solid #7c3aed;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.badge{background:#7c3aed;border-radius:12px;padding:2px 10px;font-size:11px;color:#fff}
.hint{font-size:11px;font-weight:400;color:#a5b4fc}
#search{padding:8px 12px;border-bottom:1px solid #2d2d3d;position:sticky;top:49px;z-index:99;background:#0f0f15}
#search input{width:100%;background:#1e1b4b;border:1px solid #4c1d95;color:#e2e8f0;border-radius:6px;
  padding:5px 10px;font:12px monospace;outline:none}
#search input:focus{border-color:#7c3aed}
#tree{padding:8px 6px}
.row{padding:3px 6px;border-radius:4px;cursor:pointer;border:1px solid transparent;margin-bottom:1px}
.row:hover{background:rgba(124,58,237,.2);border-color:#4c1d95}
.r-tag{color:#a78bfa;font-weight:bold;font-size:11px}
.r-strategy{color:#64748b;font-size:10px;margin-left:4px}
.r-loc{color:#6ee7b7;word-break:break-all}
.r-text{color:#fbbf24;font-size:11px}
.captured-row{background:#14532d!important;border-color:#22c55e!important}
#empty{color:#64748b;padding:24px;text-align:center;display:none}
</style>
</head>
<body>
<div id="banner">
  <span>🔮 Prabala Spy</span>
  <span class="badge">${title}</span>
  <span class="hint">Click any element to capture its locator</span>
</div>
<div id="search"><input id="q" placeholder="Filter by tag, locator, or text…" /></div>
<div id="tree">Parsing element tree…</div>
<p id="empty">No elements match your filter.</p>
<script>
${LOCATOR_JS}

const xmlRaw = ${JSON.stringify(xmlSource)};
const rows = [];

const parser = new DOMParser();
const doc = parser.parseFromString(xmlRaw, 'text/xml');
const root = doc.documentElement;
if (root && root.tagName !== 'parsererror') {
  collectNodes(root, 0, rows);
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderRows(filter) {
  const treeEl = document.getElementById('tree');
  const emptyEl = document.getElementById('empty');
  const q = (filter || '').toLowerCase();
  const filtered = q
    ? rows.filter(r =>
        r.locator.toLowerCase().includes(q) ||
        r.tag.toLowerCase().includes(q) ||
        r.text.toLowerCase().includes(q))
    : rows;

  if (filtered.length === 0) { treeEl.innerHTML = ''; emptyEl.style.display = ''; return; }
  emptyEl.style.display = 'none';

  treeEl.innerHTML = filtered.map((r, i) =>
    '<div class="row" data-i="' + i + '" style="margin-left:' + (r.depth * 14) + 'px">' +
      '<div><span class="r-tag">' + esc(r.tag) + '</span><span class="r-strategy">' + esc(r.strategy) + '</span></div>' +
      '<div class="r-loc">' + esc(r.locator) + '</div>' +
      (r.text ? '<div class="r-text">' + esc(r.text.slice(0, 80)) + '</div>' : '') +
    '</div>'
  ).join('');

  treeEl.querySelectorAll('.row').forEach(function(el, i) {
    el.addEventListener('click', function() {
      const r = filtered[i];
      document.querySelectorAll('.row').forEach(function(e) { e.classList.remove('captured-row'); });
      el.classList.add('captured-row');
      el.innerHTML = '<strong style="color:#4ade80">✅ Captured: ' + esc(r.locator) + ' — you can close this window</strong>';
      fetch('https://prabala.spy/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locator: r.locator, tag: r.tag, text: r.text }),
      }).catch(function() {});
    });
  });
}

renderRows('');
document.getElementById('q').addEventListener('input', function() { renderRows(this.value); });
</script>
</body>
</html>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  // Step 1: Connect to Appium and get session
  let sessionId;
  try {
    sessionId = await getFirstSession();
  } catch (err) {
    process.stderr.write('[DesktopSpy] ' + String(err.message) + '\n');
    emit({ __error: String(err.message) });
    emit({ __done: true });
    return;
  }

  // Step 2: Fetch page source
  let xmlSource;
  try {
    xmlSource = await getPageSource(sessionId);
  } catch (err) {
    emit({ __error: String(err.message) });
    emit({ __done: true });
    return;
  }

  // Step 3: Open interactive Playwright picker window
  const browser = await playwright.chromium.launch({
    headless: false,
    args: ['--window-size=800,940', '--window-position=60,40', '--disable-infobars'],
  });
  const context = await browser.newContext({ viewport: null, bypassCSP: true });

  let captured = false;
  await context.route('https://prabala.spy/**', async function(route) {
    if (!captured) {
      try {
        const body = JSON.parse(route.request().postData() || '{}');
        emit({ locator: body.locator || '', tag: body.tag || '', text: body.text || '' });
        captured = true;
      } catch { /* ignore parse errors */ }
    }
    await route.fulfill({ status: 200, body: 'ok' });
  });
  await context.route('http://prabala.spy/**', async function(route) {
    await route.fulfill({ status: 200, body: 'ok' });
  });

  const page = await context.newPage();
  await page.setContent(buildPickerHTML(xmlSource, mode), { waitUntil: 'domcontentloaded' });

  const exitClean = function() {
    browser.close().catch(function() {}).finally(function() { emit({ __done: true }); process.exit(0); });
  };

  browser.on('disconnected', function() { emit({ __done: true }); process.exit(0); });
  process.on('SIGTERM', exitClean);
  process.on('SIGINT', exitClean);
}

run().catch(function(err) {
  process.stderr.write('[DesktopSpy] fatal: ' + String(err) + '\n');
  emit({ __error: String(err.message || err) });
  emit({ __done: true });
  process.exit(1);
});
