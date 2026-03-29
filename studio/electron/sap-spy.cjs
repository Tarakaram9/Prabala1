// ─────────────────────────────────────────────────────────────────────────────
// Prabala SAP GUI Spy
//
// Connects to a running SAP GUI session via the COM Scripting API (winax),
// traverses the UI component tree, and presents an interactive element picker
// in a Playwright browser window. Click any element to capture its SAP field ID.
//
// Requirements (Windows only):
//   - SAP GUI 7.x or later with Scripting enabled
//     (Options → Accessibility → Enable Scripting)
//   - winax npm package: npm install --prefix . winax
//     (Requires Visual C++ Build Tools on Windows)
//
// Args: (none — connects automatically to the first active SAP session)
//
// stdout: { "locator": "...", "tag": "...", "text": "..." }
//         { "__error": "..." }
//         { "__done": true }
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const playwright = require('playwright');
const path = require('path');

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// ── SAP component tree traversal ─────────────────────────────────────────────

function collectSapComponents(component, depth, maxDepth, acc) {
  if (!component || depth > maxDepth) return;
  try {
    const id      = String(component.Id      || '');
    const type    = String(component.Type    || 'GuiComponent');
    const text    = String(component.Text    || component.Tooltip || '');
    const tooltip = String(component.Tooltip || '');
    if (id) {
      acc.push({ id, type, text: text || tooltip, depth });
    }
    let count = 0;
    try { count = component.Children ? component.Children.Count : 0; } catch { /* no children */ }
    for (let i = 0; i < count; i++) {
      try {
        const child = component.Children.Item(i);
        collectSapComponents(child, depth + 1, maxDepth, acc);
      } catch { /* skip inaccessible children */ }
    }
  } catch { /* skip inaccessible component */ }
}

// ── Picker HTML ───────────────────────────────────────────────────────────────

function buildSapPickerHTML(elements) {
  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Prabala SAP Spy</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:monospace;font-size:12px;background:#0f0f15;color:#c4b5fd;min-height:100vh}
#banner{position:sticky;top:0;z-index:100;background:#14532d;color:#bbf7d0;font:600 13px system-ui;
  padding:10px 18px;border-bottom:1px solid #16a34a;display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.badge{background:#16a34a;border-radius:12px;padding:2px 10px;font-size:11px;color:#fff}
.hint{font-size:11px;font-weight:400;color:#86efac}
#search{padding:8px 12px;border-bottom:1px solid #2d2d3d;position:sticky;top:49px;z-index:99;background:#0f0f15}
#search input{width:100%;background:#1c1917;border:1px solid #15803d;color:#e2e8f0;border-radius:6px;
  padding:5px 10px;font:12px monospace;outline:none}
#search input:focus{border-color:#22c55e}
#tree{padding:8px 6px}
.row{padding:3px 6px;border-radius:4px;cursor:pointer;border:1px solid transparent;margin-bottom:1px}
.row:hover{background:rgba(22,163,74,.15);border-color:#15803d}
.r-id{color:#6ee7b7;word-break:break-all;font-weight:bold}
.r-type{color:#a78bfa;font-size:10px}
.r-text{color:#fbbf24;font-size:11px}
.captured-row{background:#14532d!important;border-color:#22c55e!important}
#empty{color:#64748b;padding:24px;text-align:center;display:none}
</style>
</head>
<body>
<div id="banner">
  <span>🔮 Prabala Spy</span>
  <span class="badge">SAP</span>
  <span class="hint">Click any element to capture its SAP field ID</span>
</div>
<div id="search"><input id="q" placeholder="Filter by field ID, type, or text…" /></div>
<div id="tree">Loading SAP elements…</div>
<p id="empty">No elements match your filter.</p>
<script>
const elements = ${JSON.stringify(elements)};

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderRows(filter) {
  const treeEl  = document.getElementById('tree');
  const emptyEl = document.getElementById('empty');
  const q = (filter || '').toLowerCase();
  const filtered = q
    ? elements.filter(function(r) {
        return r.id.toLowerCase().includes(q) ||
               r.type.toLowerCase().includes(q) ||
               r.text.toLowerCase().includes(q);
      })
    : elements;

  if (filtered.length === 0) { treeEl.innerHTML = ''; emptyEl.style.display = ''; return; }
  emptyEl.style.display = 'none';

  treeEl.innerHTML = filtered.map(function(r, i) {
    return '<div class="row" data-i="' + i + '" style="margin-left:' + (Math.min(r.depth, 6) * 14) + 'px">' +
      '<div class="r-id">' + esc(r.id) + '</div>' +
      '<div class="r-type">' + esc(r.type) + (r.text ? ' — ' + esc(r.text.slice(0, 60)) : '') + '</div>' +
    '</div>';
  }).join('');

  treeEl.querySelectorAll('.row').forEach(function(el, i) {
    el.addEventListener('click', function() {
      const r = filtered[i];
      document.querySelectorAll('.row').forEach(function(e) { e.classList.remove('captured-row'); });
      el.classList.add('captured-row');
      el.innerHTML = '<strong style="color:#4ade80">✅ Captured: ' + esc(r.id) + ' — you can close this window</strong>';
      fetch('https://prabala.spy/capture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locator: r.id, tag: r.type.toLowerCase().replace(/^gui/, ''), text: r.text }),
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
  // Step 1: Platform check
  if (process.platform !== 'win32') {
    const msg =
      'SAP Spy requires Windows with SAP GUI installed.\n' +
      'On macOS/Linux, use SAP GUI Script Recording to capture field IDs:\n' +
      'Tools → Script Recording and Playback → Record.';
    process.stderr.write('[SapSpy] ' + msg.replace(/\n/g, ' | ') + '\n');
    emit({ __error: msg });
    emit({ __done: true });
    return;
  }

  // Step 2: Load winax
  let winax;
  try {
    // Try local node_modules first, then global
    const localWinax = path.resolve(__dirname, '..', '..', 'node_modules', 'winax');
    winax = require(localWinax);
  } catch {
    try { winax = require('winax'); } catch {
      const msg =
        'winax package not found.\n' +
        'Install it inside the project: npm install --prefix . winax\n' +
        '(Requires Visual C++ Build Tools on Windows)';
      process.stderr.write('[SapSpy] ' + msg.replace(/\n/g, ' | ') + '\n');
      emit({ __error: msg });
      emit({ __done: true });
      return;
    }
  }

  // Step 3: Connect to SAP GUI via COM
  let elements = [];
  try {
    const rotWrapper = new winax.Object('SapROTWrapper');
    const utils = rotWrapper.GetROTEntry('SAPGUI');
    if (!utils) throw new Error('SAPGUI entry not found in the Running Object Table. Make sure SAP GUI is open.');

    const engine = utils.GetScriptingEngine();
    if (!engine) throw new Error('Could not get SAP Scripting Engine. Enable Scripting in SAP GUI Options → Accessibility.');

    const connCount = engine.Children ? engine.Children.Count : 0;
    if (connCount === 0) throw new Error('No SAP connections open. Open SAP Logon and connect to a system first.');

    const connection = engine.Children.Item(0);
    const sessCount = connection.Children ? connection.Children.Count : 0;
    if (sessCount === 0) throw new Error('No SAP sessions in connection. Open a session in SAP GUI first.');

    const session = connection.Children.Item(0);
    collectSapComponents(session, 0, 10, elements);
  } catch (err) {
    const msg = `SAP connection failed: ${err.message}`;
    process.stderr.write('[SapSpy] ' + msg + '\n');
    emit({ __error: msg });
    emit({ __done: true });
    return;
  }

  if (elements.length === 0) {
    emit({ __error: 'SAP session returned no UI elements. Make sure a transaction screen is active in SAP GUI.' });
    emit({ __done: true });
    return;
  }

  // Step 4: Open Playwright picker window
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
      } catch { /* ignore */ }
    }
    await route.fulfill({ status: 200, body: 'ok' });
  });

  const page = await context.newPage();
  await page.setContent(buildSapPickerHTML(elements), { waitUntil: 'domcontentloaded' });

  const exitClean = function() {
    browser.close().catch(function() {}).finally(function() { emit({ __done: true }); process.exit(0); });
  };

  browser.on('disconnected', function() { emit({ __done: true }); process.exit(0); });
  process.on('SIGTERM', exitClean);
  process.on('SIGINT', exitClean);
}

run().catch(function(err) {
  process.stderr.write('[SapSpy] fatal: ' + String(err) + '\n');
  emit({ __error: String(err.message || err) });
  emit({ __done: true });
  process.exit(1);
});
