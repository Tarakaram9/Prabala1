// ─────────────────────────────────────────────────────────────────────────────
// Prabala Studio – Element Spy  v4
//
// Fixes over v3:
//  1. bypassCSP: true  — page CSP can no longer block our fetch()
//  2. addInitScript used ONLY for the locator-strategy (no DOM access)
//     The spy UI is injected via page.on('domcontentloaded') where body exists
//  3. context.route('http://prabala.spy/**') still captures the click
//  4. spy.cjs no longer closes the browser itself — parent kills via SIGTERM
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
window.__prabalaNormalizeSpyTarget = function(input) {
  if (!input) return null;
  var el = input.nodeType === 1 ? input : input.parentElement;
  if (!el || el === document.body || el === document.documentElement) return el;

  // Prefer semantic/interactive ancestor so nested spans/icons resolve correctly.
  var semantic = el.closest(
    'label,input,textarea,select,option,button,a,' +
    '[role="button"],[role="radio"],[role="textbox"],[role="combobox"],[role="listbox"],[role="option"],' +
    '[data-testid],[data-cy],[data-test],[contenteditable="true"]'
  );
  return semantic || el;
};

window.__prabalaGetLocator = function(inputEl) {
  var el = window.__prabalaNormalizeSpyTarget(inputEl);
  if (!el || el === document.body || el === document.documentElement) return null;

  function q(v) {
    return String(v || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function cssEsc(v) {
    var s = String(v || '');
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(s);
    return s.replace(/([^a-zA-Z0-9_-])/g, '\\\\$1');
  }

  function stableId(id) {
    return !!id && !/^\\d/.test(id) && !/^[a-f0-9-]{8,}$/i.test(id);
  }

  function norm(v) {
    return String(v || '').trim().replace(/\\s+/g, ' ');
  }

  function stableClassList(node) {
    return Array.from(node.classList || [])
      .filter(function(c) {
        return c && c.length < 40 && !/^ng-/.test(c) && !/\\d{3,}/.test(c);
      })
      .slice(0, 3);
  }

  function cssPath(node) {
    var parts = [];
    var cur = node;
    var hops = 0;
    while (cur && cur.nodeType === 1 && cur !== document.body && hops < 7) {
      if (stableId(cur.id)) {
        parts.unshift('#' + cssEsc(cur.id));
        return parts.join(' > ');
      }

      var tag = cur.tagName.toLowerCase();
      var cls = stableClassList(cur);
      var seg = tag;

      if (cls.length) {
        seg += '.' + cls.map(cssEsc).join('.');
      } else {
        var idx = 1;
        var sib = cur;
        while ((sib = sib.previousElementSibling)) {
          if (sib.tagName === cur.tagName) idx++;
        }
        seg += ':nth-of-type(' + idx + ')';
      }

      parts.unshift(seg);
      cur = cur.parentElement;
      hops++;
    }
    return parts.join(' > ');
  }

  var tag = el.tagName.toLowerCase();
  var role = (el.getAttribute('role') || '').toLowerCase();

  // Highest priority: id / test attributes
  if (stableId(el.id)) return '#' + cssEsc(el.id);

  var testid = el.getAttribute('data-testid') || el.getAttribute('data-cy') || el.getAttribute('data-test');
  if (testid) return '[data-testid="' + q(testid) + '"]';

  // Label-specific
  if (tag === 'label') {
    var htmlFor = el.getAttribute('for');
    if (htmlFor) return 'label[for="' + q(htmlFor) + '"]';
    var ltxt = norm(el.innerText || el.textContent);
    if (ltxt) return 'text=' + ltxt.slice(0, 80);
  }

  // Option inside native select
  if (tag === 'option') {
    var val = el.getAttribute('value');
    var txt = norm(el.innerText || el.textContent);
    var parentSelect = el.closest('select');
    var parentLoc = parentSelect ? window.__prabalaGetLocator(parentSelect) : null;
    if (parentLoc && val) return parentLoc + ' option[value="' + q(val) + '"]';
    if (parentLoc && txt) return parentLoc + ' option';
    if (val) return 'option[value="' + q(val) + '"]';
  }

  // Inputs / textboxes / radios
  if (tag === 'input') {
    var type = (el.getAttribute('type') || 'text').toLowerCase();
    var name = el.getAttribute('name');
    var value = el.getAttribute('value');
    var placeholder = el.getAttribute('placeholder');
    var ariaLabel = el.getAttribute('aria-label');

    if (type === 'radio') {
      if (name && value) return 'input[type="radio"][name="' + q(name) + '"][value="' + q(value) + '"]';
      if (name) return 'input[type="radio"][name="' + q(name) + '"]';
      return 'input[type="radio"]';
    }

    if (type === 'checkbox') {
      if (name) return 'input[type="checkbox"][name="' + q(name) + '"]';
      if (ariaLabel) return 'input[type="checkbox"][aria-label="' + q(ariaLabel) + '"]';
      return 'input[type="checkbox"]';
    }

    if (name) return 'input[name="' + q(name) + '"]';
    if (placeholder) return 'input[placeholder="' + q(placeholder) + '"]';
    if (ariaLabel) return 'input[aria-label="' + q(ariaLabel) + '"]';
  }

  if (tag === 'textarea') {
    var tn = el.getAttribute('name');
    var tph = el.getAttribute('placeholder');
    if (tn) return 'textarea[name="' + q(tn) + '"]';
    if (tph) return 'textarea[placeholder="' + q(tph) + '"]';
    return 'textarea';
  }

  if (tag === 'select') {
    var sn = el.getAttribute('name');
    var sa = el.getAttribute('aria-label');
    if (sn) return 'select[name="' + q(sn) + '"]';
    if (sa) return 'select[aria-label="' + q(sa) + '"]';
    return 'select';
  }

  // ARIA roles for custom controls
  if (role) {
    var roleLabel = el.getAttribute('aria-label');
    if (roleLabel) return '[role="' + q(role) + '"][aria-label="' + q(roleLabel) + '"]';
    if (role === 'listbox' || role === 'option' || role === 'radio' || role === 'textbox' || role === 'combobox') {
      return '[role="' + q(role) + '"]';
    }
  }

  // Generic aria/name/placeholder hooks
  var aria = el.getAttribute('aria-label');
  if (aria) return '[aria-label="' + q(aria) + '"]';
  var nm = el.getAttribute('name');
  if (nm && ['input', 'select', 'textarea'].indexOf(tag) !== -1) return tag + '[name="' + q(nm) + '"]';
  var ph = el.getAttribute('placeholder');
  if (ph) return tag + '[placeholder="' + q(ph) + '"]';

  // Text locator for non-form controls
  if (['input', 'textarea', 'select', 'option'].indexOf(tag) === -1) {
    var txt2 = norm(el.innerText || el.textContent);
    if (txt2 && txt2.length < 90) return 'text=' + txt2;
  }

  // Class-based fallback
  var cls2 = stableClassList(el);
  if (cls2.length) return tag + '.' + cls2.map(cssEsc).join('.');

  // Deep fallback for nested structures
  var path = cssPath(el);
  if (path) return path;

  return tag;
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
    ban.textContent = '\u{1F52E} Prabala Spy \u2014 hover to preview, left click or right click to capture';
  document.body.appendChild(ov);
  document.body.appendChild(tip);
  document.body.appendChild(ban);
  document.body.classList.add('__ps_on');

  var skip = [ov, tip, ban];
  var __psCaptured = false;

  function pickElementFromEvent(e) {
    var byPoint = null;
    if (typeof e.clientX === 'number' && typeof e.clientY === 'number') {
      byPoint = document.elementFromPoint(e.clientX, e.clientY);
    }
    var el = byPoint || e.target;
    if (el && el.nodeType !== 1) el = el.parentElement;
    if (window.__prabalaNormalizeSpyTarget) {
      el = window.__prabalaNormalizeSpyTarget(el);
    }
    if (!el || skip.indexOf(el) !== -1) return null;
    return el;
  }

  function captureElement(el) {
    if (!el || __psCaptured) return;
    __psCaptured = true;
    var loc = (window.__prabalaGetLocator && window.__prabalaGetLocator(el)) || el.tagName.toLowerCase();
    var tag = el.tagName.toLowerCase();
    var txt = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80);

    // ── Send via fetch — intercepted by Playwright context.route ─────────────
    // Fixed fake hostname works on any page, including about:blank
    fetch('https://prabala.spy/capture', {
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
    ban.textContent = '\u2705 Captured \u2014 you can close this window';
    tip.style.display = 'none';
  }

  document.addEventListener('mousemove', function(e) {
    var el = pickElementFromEvent(e);
    if (!el) return;
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

  // Primary capture path: mousedown + elementFromPoint works even for disabled controls.
  document.addEventListener('mousedown', function(e) {
    var el = pickElementFromEvent(e);
    if (!el) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    captureElement(el);
  }, true);

  // Fallback path for pages that block mousedown handling.
  document.addEventListener('click', function(e) {
    var el = pickElementFromEvent(e);
    if (!el) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    captureElement(el);
  }, true);

  // Secondary fallback: right-click capture is useful when left-click is swallowed.
  document.addEventListener('contextmenu', function(e) {
    var el = pickElementFromEvent(e);
    if (!el) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    captureElement(el);
  }, true);
})();
`;

const os = require('os');
const forceHeadless = process.env.PRABALA_HEADLESS === '1' ||
  (os.platform() === 'linux' && !process.env.DISPLAY);

async function run() {
  const launchArgs = [
    '--window-size=1280,820',
    '--window-position=80,80',
    '--disable-infobars',
    '--disable-web-security',
    '--disable-features=IsolateOrigins,site-per-process',
  ];
  if (os.platform() === 'linux') {
    launchArgs.push('--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage');
  }
  const browser = await playwright.chromium.launch({
    headless: forceHeadless,
    args: launchArgs,
  });

  // bypassCSP: true ensures page CSP headers cannot block our fetch() call
  const context = await browser.newContext({ viewport: null, bypassCSP: true });

  // ── Capture: route interception (network-level, no CDP binding) ─────────────
  // The spy UI calls fetch('https://prabala.spy/capture'). Playwright intercepts
  // it here before any DNS lookup — works regardless of page origin or CSP.
  // We intercept both http and https to handle all target page protocols.
  let captured = false;
  async function handleCapture(route) {
    if (captured) { await route.fulfill({ status: 200, body: 'ok' }); return; }
    try {
      const raw = route.request().postData();
      const body = JSON.parse(raw || '{}');
      emit({ locator: body.locator || '', tag: body.tag || '', text: body.text || '' });
      captured = true;
    } catch (err) {
      process.stderr.write('[Spy] route parse error: ' + String(err) + '\n');
    }
    await route.fulfill({ status: 200, body: 'ok' });
    // Parent process (server/electron main) will kill us via SIGTERM in ~300ms
  }
  await context.route('https://prabala.spy/**', handleCapture);
  await context.route('http://prabala.spy/**', handleCapture);

  // ── addInitScript: ONLY the locator strategy (pure JS, zero DOM access) ─────
  // SPY_UI is injected later via page.on('domcontentloaded') where body exists.
  await context.addInitScript(LOCATOR_STRATEGY);

  const page = await context.newPage();

  // ── Inject spy UI after every navigation, once body is available ─────────────
  async function injectSpyUI() {
    try {
      await page.evaluate(SPY_UI);
    } catch (e) {
      process.stderr.write('[Spy] inject error: ' + String(e) + '\n');
    }
  }
  page.on('domcontentloaded', injectSpyUI);

  page.on('console', (msg) => {
    if (msg.type() === 'error') process.stderr.write('[Spy page] ' + msg.text() + '\n');
  });
  page.on('pageerror', (err) => process.stderr.write('[Spy pageerror] ' + err.message + '\n'));

  if (startUrl && startUrl !== 'about:blank') {
    try {
      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch (e) {
      process.stderr.write('[Spy] navigate warning: ' + String(e) + '\n');
    }
  } else {
    // about:blank has body immediately — inject now
    await injectSpyUI();
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
