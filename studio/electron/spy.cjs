// ─────────────────────────────────────────────────────────────────────────────
// Prabala Studio – Element Spy
// Spawned as a child process. Opens a visible Chromium window and lets the
// user hover + click elements. On click it emits the best locator as JSON
// to stdout and exits.
//
// Output format (exactly one line then exit):
//   { "locator": "text=Submit", "tag": "button", "text": "Submit" }
//   { "__done": true }  ← if user closes window without picking
// ─────────────────────────────────────────────────────────────────────────────

const playwright = require('playwright');

const startUrl = process.argv[2] || 'about:blank';

function emit(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// ── Locator strategy (same as recorder.cjs) ──────────────────────────────────
const LOCATOR_STRATEGY = `
window.__prabalaGetLocator = function(el) {
  if (!el || el === document.body) return null;
  // 1. id
  if (el.id && !el.id.match(/^\\d/) && !el.id.match(/^[a-f0-9]{8,}$/i)) return '#' + el.id;
  // 2. data-testid / data-cy
  const testid = el.getAttribute('data-testid') || el.getAttribute('data-cy');
  if (testid) return '[data-testid="' + testid + '"]';
  // 3. aria-label
  const aria = el.getAttribute('aria-label');
  if (aria) return '[aria-label="' + aria + '"]';
  // 4. placeholder for inputs
  const ph = el.getAttribute('placeholder');
  if (ph) return '[placeholder="' + ph + '"]';
  // 5. name attr for form fields
  const name = el.getAttribute('name');
  if (name && ['INPUT','SELECT','TEXTAREA'].includes(el.tagName)) return '[name="' + name + '"]';
  // 6. visible text for non-inputs
  if (!['INPUT','TEXTAREA','SELECT','OPTION'].includes(el.tagName)) {
    const txt = (el.innerText || el.textContent || '').trim().replace(/\\s+/g,' ').slice(0, 60);
    if (txt && txt.length < 60) return 'text=' + txt;
  }
  // 7. role + text combo
  const role = el.getAttribute('role');
  if (role) return '[role="' + role + '"]';
  // 8. CSS fallback
  const tag = el.tagName.toLowerCase();
  const cls = [...el.classList].filter(c => !c.match(/\\d{3,}/)  && c.length < 30).slice(0, 2).join('.');
  return tag + (cls ? '.' + cls : '');
};
`;

// ── Overlay CSS injected into every page  ────────────────────────────────────
const OVERLAY_CSS = `
  #__prabala_spy_overlay {
    position: fixed !important;
    z-index: 2147483647 !important;
    pointer-events: none !important;
    border: 2.5px solid #7c3aed !important;
    background: rgba(124, 58, 237, 0.08) !important;
    border-radius: 3px !important;
    box-shadow: 0 0 0 1px rgba(124,58,237,0.3), inset 0 0 6px rgba(124,58,237,0.1) !important;
    transition: top 60ms, left 60ms, width 60ms, height 60ms !important;
  }
  #__prabala_spy_tooltip {
    position: fixed !important;
    z-index: 2147483648 !important;
    pointer-events: none !important;
    background: #1e1b4b !important;
    color: #c4b5fd !important;
    font: 12px/1.4 'SF Mono', 'Fira Code', monospace !important;
    padding: 5px 9px !important;
    border-radius: 5px !important;
    border: 1px solid #4c1d95 !important;
    box-shadow: 0 4px 14px rgba(0,0,0,0.5) !important;
    max-width: 380px !important;
    word-break: break-all !important;
    white-space: pre-wrap !important;
  }
  #__prabala_spy_banner {
    position: fixed !important;
    z-index: 2147483648 !important;
    pointer-events: none !important;
    top: 12px !important;
    left: 50% !important;
    transform: translateX(-50%) !important;
    background: #3b0764 !important;
    color: #e9d5ff !important;
    font: 13px/1 'SF Pro Display', system-ui, sans-serif !important;
    font-weight: 600 !important;
    padding: 8px 18px !important;
    border-radius: 20px !important;
    border: 1px solid #7c3aed !important;
    box-shadow: 0 4px 18px rgba(124,58,237,0.4) !important;
    letter-spacing: 0.02em !important;
  }
  body.__prabala_spy_active * { cursor: crosshair !important; }
`;

// ── Spy interaction script injected once ─────────────────────────────────────
const SPY_SCRIPT = `
(function() {
  if (window.__spyActive) return;
  window.__spyActive = true;

  // Inject CSS
  const style = document.createElement('style');
  style.textContent = ${JSON.stringify(OVERLAY_CSS)};
  document.head.appendChild(style);

  // Inject overlay div
  const overlay = document.createElement('div');
  overlay.id = '__prabala_spy_overlay';
  document.body.appendChild(overlay);

  // Inject tooltip div
  const tooltip = document.createElement('div');
  tooltip.id = '__prabala_spy_tooltip';
  tooltip.style.display = 'none';
  document.body.appendChild(tooltip);

  // Inject banner
  const banner = document.createElement('div');
  banner.id = '__prabala_spy_banner';
  banner.textContent = '🔮 Prabala Spy — click an element to capture its locator';
  document.body.appendChild(banner);

  document.body.classList.add('__prabala_spy_active');

  let current = null;

  document.addEventListener('mousemove', function(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === overlay || el === tooltip || el === banner) return;
    current = el;

    const rect = el.getBoundingClientRect();
    overlay.style.cssText = 'position:fixed!important;z-index:2147483647!important;pointer-events:none!important;'
      + 'border:2.5px solid #7c3aed!important;background:rgba(124,58,237,0.08)!important;'
      + 'border-radius:3px!important;box-shadow:0 0 0 1px rgba(124,58,237,0.3)!important;'
      + 'top:' + rect.top + 'px!important;left:' + rect.left + 'px!important;'
      + 'width:' + rect.width + 'px!important;height:' + rect.height + 'px!important;';

    const loc = window.__prabalaGetLocator(el) || el.tagName.toLowerCase();
    tooltip.textContent = loc + '\\n' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '');
    tooltip.style.display = 'block';
    let tx = e.clientX + 14, ty = e.clientY + 14;
    if (tx + 390 > window.innerWidth) tx = e.clientX - 395;
    if (ty + 80 > window.innerHeight) ty = e.clientY - 65;
    tooltip.style.cssText += 'position:fixed!important;z-index:2147483648!important;pointer-events:none!important;'
      + 'background:#1e1b4b!important;color:#c4b5fd!important;'
      + 'font:12px/1.4 monospace!important;padding:5px 9px!important;'
      + 'border-radius:5px!important;border:1px solid #4c1d95!important;'
      + 'max-width:380px!important;word-break:break-all!important;white-space:pre-wrap!important;'
      + 'top:' + ty + 'px!important;left:' + tx + 'px!important;';
  }, true);

  document.addEventListener('click', function(e) {
    if (!current || current === overlay || current === tooltip || current === banner) return;
    e.preventDefault();
    e.stopPropagation();
    const loc = window.__prabalaGetLocator(current) || current.tagName.toLowerCase();
    const tag = current.tagName.toLowerCase();
    const text = (current.innerText || current.textContent || '').trim().replace(/\\s+/g,' ').slice(0, 80);
    window.__prabalaSendLocator(loc, tag, text);
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
    ],
  });

  const context = await browser.newContext({ viewport: null });

  // Expose bridge: page JS → stdout
  await context.exposeFunction('__prabalaSendLocator', (locator, tag, text) => {
    emit({ locator, tag, text });
    browser.close().catch(() => {});
  });

  // Inject locator strategy + spy UI into every page/frame
  await context.addInitScript(LOCATOR_STRATEGY + '\n' + SPY_SCRIPT);

  const page = await context.newPage();

  // Navigate to start URL
  if (startUrl && startUrl !== 'about:blank') {
    try {
      await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (e) {
      process.stderr.write('[Spy] navigate error: ' + String(e) + '\n');
    }
  }

  // Also inject into the initial page (addInitScript only fires on navigations)
  try {
    await page.evaluate(LOCATOR_STRATEGY + '\n' + SPY_SCRIPT);
  } catch (e) {
    process.stderr.write('[Spy] inject error: ' + String(e) + '\n');
  }

  browser.on('disconnected', () => {
    emit({ __done: true });
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    browser.close().catch(() => {}).finally(() => {
      emit({ __done: true });
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    browser.close().catch(() => {}).finally(() => {
      emit({ __done: true });
      process.exit(0);
    });
  });
}

run().catch((err) => {
  process.stderr.write('[Spy] fatal: ' + String(err) + '\n');
  process.exit(1);
});
