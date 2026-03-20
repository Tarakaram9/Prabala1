// ─────────────────────────────────────────────────────────────────────────────
// Prabala Studio – Element Spy  v3  (route-intercept architecture)
//
// Architecture: instead of exposeFunction CDP bindings (fragile), the injected
// page script fires a plain fetch() to the current origin + /prabala-spy-capture.
// Playwright intercepts that request via context.route() at the network level —
// no CDP binding, no race conditions, works on any page origin.
//
// stdout: { "locator": "...", "tag": "...", "text": "..." }
//         { "__done": true }  ← browser closed without a pick
// ─────────────────────────────────────────────────────────────────────────────

const playwright = require('playwright');

const startUrl = process.argv[2] || 'about:blank';

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// ── Locator strategy ─────────────────────────────────────────────────────────
const LOCATOR_STRATEGY = `
window.__prabalaGetLocator = function(el) {
  if (!el || el === document.body || el === document.documentElement) return null;
  if (el.id && !el.id.match(/^\\d/) && !el.id.match(/^[a-f0-9-]{8,}$/i)) return '#' + el.id;
  var t = el.getAttribute('data-testid') || el.getAttribute('data-cy') || el.getAttribute('data-test');
  if (t) return '[data-testid="' + t + '"]';
  var a = el.getAttribute('aria-label');
  if (a) return '[aria-label="' + a + '"]';
  var ph = el.getAttribute('placeholder');
  if (ph) return '[placeholder="' + ph + '"]';
  var nm = el.getAttribute('name');
  if (nm && ['INPUT','SELECT','TEXTAREA'].indexOf(el.tagName) !== -1)
    return '[name="' + nm + '"]';
  if (['INPUT','TEXTAREA','SELECT','OPTION'].indexOf(el.tagName) === -1) {
    var txt = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 60);
    if (txt && txt.length < 60) return 'text=' + txt;
  }
  var role = el.getAttribute('role');
  if (role) return '[role="' + role + '"]';
  var tag = el.tagName.toLowerCase();
  var cls = Array.from(el.classList)
    .filter(function(c) { return !c.match(/\\d{3,}/) && c.length < 30; })
    .slice(0, 2).join('.');
  return tag + (cls ? '.' + cls : '');
};
`;

// ── Spy UI (injected into every page) ────────────────────────────────────────
// Uses e.target directly; all cssText are FULL assignments (no +=).
// Sends locator via fetch to /prabala-spy-capture (intercepted by Playwright).
const SPY_UI = `
(function() {
  if (window.__prabalaSpyActive) return;
  window.__prabalaSpyActive = true;

  var s = document.createElement('style');
  s.textContent =
    '#__ps_ov{position:fixed!important;z-index:2147483640!important;pointer-events:none!important;' +
      'border:2.5px solid #7c3aed!important;background:rgba(124,58,237,.08)!important;border-radius:3px!important;}' +
    '#__ps_tip{position:fixed!important;z-index:2147483645!important;pointer-events:none!important;' +
      'background:#1e1b4b!important;color:#c4b5fd!important;font:12px/1.4 monospace!important;' +
      'padding:5px 10px!important;border-radius:5px!important;border:1px solid #4c1d95!important;' +
      'box-shadow:0 4px 14px rgba(0,0,0,.5)!important;max-width:360px!important;' +
      'word-break:break-all!important;white-space:pre-wrap!important;display:none!important;}' +
    '#__ps_banner{position:fixed!important;z-index:2147483645!important;pointer-events:none!important;' +
      'top:10px!important;left:50%!important;transform:translateX(-50%)!important;' +
      'background:#3b0764!important;color:#e9d5ff!important;font:600 13px system-ui!important;' +
      'padding:8px 18px!important;border-radius:20px!important;border:1px solid #7c3aed!important;}' +
    'body.__ps_on *{cursor:crosshair!important;}';
  document.head.appendChild(s);

  var ov  = document.createElement('div'); ov.id  = '__ps_ov';
  var tip = document.createElement('div'); tip.id = '__ps_tip';
  var ban = document.createElement('div'); ban.id = '__ps_banner';
  ban.textContent = '\\u{1F52E} Prabala Spy \\u2014 hover to preview, click to capture';
  document.body.appendChild(ov);
  document.body.appendChild(tip);
  document.body.appendChild(ban);
  document.body.classList.add('__ps_on');

  var skip = [ov, tip, ban];

  document.addEventListener('mousemove', function(e) {
    var el = e.target;
    if (!el || skip.indexOf(el) !== -1) return;
    var r = el.getBoundingClientRect();
    ov.style.cssText =
      'position:fixed!important;z-index:2147483640!important;pointer-events:none!important;' +
      'border:2.5px solid #7c3aed!important;background:rgba(124,58,237,.08)!important;border-radius:3px!important;' +
      'top:' + r.top + 'px!important;left:' + r.left + 'px!important;' +
      'width:' + r.width + 'px!important;height:' + r.height + 'px!important;';
    var loc = (window.__prabalaGetLocator && window.__prabalaGetLocator(el)) || el.tagName.toLowerCase();
    var tx = e.clientX + 14, ty = e.clientY + 14;
    if (tx + 370 > window.innerWidth)  tx = e.clientX - 375;
    if (ty + 70  > window.innerHeight) ty = e.clientY - 60;
    tip.style.cssText =
      'position:fixed!important;z-index:2147483645!important;pointer-events:none!important;' +
      'background:#1e1b4b!important;color:#c4b5fd!important;font:12px/1.4 monospace!important;' +
      'padding:5px 10px!important;border-radius:5px!important;border:1px solid #4c1d95!important;' +
      'max-width:360px!important;word-break:break-all!important;white-space:pre-wrap!important;' +
      'display:block!important;top:' + ty + 'px!important;left:' + tx + 'px!important;';
    tip.textContent = loc + '\\n<' + el.tagName.toLowerCase() + '>';
  }, true);

  document.addEventListener('click', function(e) {
    var el = e.target;
    if (!el || skip.indexOf(el) !== -1) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    var loc = (window.__prabalaGetLocator && window.__prabalaGetLocator(el)) || el.tagName.toLowerCase();
    var tag = el.tagName.toLowerCase();
    var txt = (el.innerText || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80);

    // ── Send via fetch — intercepted by Playwright context.route ─────────────
    // Fixed fake hostname works on any page, including about:blank
    fetch('http://prabala.spy/capture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locator: loc, tag: tag, text: txt }),
    }).catch(function() {});

    // Fallback: also try __prabalaSendLocator if available (exposeFunction)
    if (typeof window.__prabalaSendLocator === 'function') {
      window.__prabalaSendLocator(loc, tag, txt);
    }

    // Green success banner
    ban.style.cssText =
      'position:fixed!important;z-index:2147483645!important;pointer-events:none!important;' +
      'top:10px!important;left:50%!important;transform:translateX(-50%)!important;' +
      'background:#14532d!important;color:#bbf7d0!important;font:600 13px system-ui!important;' +
      'padding:8px 18px!important;border-radius:20px!important;border:1px solid #22c55e!important;';
    ban.textContent = '\\u2705 Captured \\u2014 you can close this window';
    tip.style.display = 'none';
  }, true);
})();
`;

async function run() {
  const browser = await playwright.chromium.launch({
    headless: false,
    args: [
      '--window-size=1280,820',
      '--window-position=80,80',
      '--disable-infobars',
      '--disable-web-security',  // allows fetch to any origin
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });

  const context = await browser.newContext({ viewport: null });

  // ── Primary capture mechanism: route interception ───────────────────────────
  // The injected JS calls fetch(<origin>/prabala-spy-capture).
  // Playwright intercepts it here at the network level — no CDP binding needed.
  let captured = false;
  // Uses a fixed fake hostname so it works even on about:blank pages
  await context.route('http://prabala.spy/**', async (route) => {
    if (captured) { await route.fulfill({ status: 200, body: 'ok' }); return; }
    try {
      const body = route.request().postDataJSON();
      emit({ locator: body.locator, tag: body.tag, text: body.text });
      captured = true;
    } catch (err) {
      process.stderr.write('[Spy] route parse error: ' + String(err) + '\n');
    }
    await route.fulfill({ status: 200, body: 'ok' });
    // Give stdout time to flush, then exit
    setTimeout(() => { browser.close().catch(() => {}); }, 400);
  });

  // ── Fallback: exposeFunction (belt-and-suspenders) ──────────────────────────
  await context.exposeFunction('__prabalaSendLocator', (locator, tag, text) => {
    if (captured) return;
    captured = true;
    emit({ locator, tag, text });
    setTimeout(() => { browser.close().catch(() => {}); }, 400);
  });

  // Inject locator strategy + spy UI before any page scripts
  await context.addInitScript(LOCATOR_STRATEGY + '\n' + SPY_UI);

  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') process.stderr.write('[Spy page] ' + msg.text() + '\n');
  });
  page.on('pageerror', (err) => process.stderr.write('[Spy page error] ' + err.message + '\n'));

  if (startUrl && startUrl !== 'about:blank') {
    try {
      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch (e) {
      process.stderr.write('[Spy] navigate warning: ' + String(e) + '\n');
    }
  }

  browser.on('disconnected', () => {
    emit({ __done: true });
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    browser.close().catch(() => {}).finally(() => { emit({ __done: true }); process.exit(0); });
  });
  process.on('SIGINT', () => {
    browser.close().catch(() => {}).finally(() => { emit({ __done: true }); process.exit(0); });
  });
}

run().catch((err) => {
  process.stderr.write('[Spy] fatal: ' + String(err) + '\n');
  process.exit(1);
});
